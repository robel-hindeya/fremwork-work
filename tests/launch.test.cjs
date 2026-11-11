require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const auth = require('../apps/web/src/lib/server/auth.ts');
const { db, userScope } = require('../apps/web/src/lib/server/db.ts');
const { sameOriginRequest, publicOrigin } = require('../apps/web/src/lib/server/origins.ts');
const { POST: handoff } = require('../apps/web/src/app/api/auth/session/route.ts');
const { GET: googleStart } = require('../apps/web/src/app/api/auth/google/route.ts');
const { GET: callback } = require('../apps/web/src/app/auth/callback/route.ts');
const { POST: forgot } = require('../apps/web/src/app/api/auth/forgot/route.ts');
const { createHash } = require('node:crypto');
const { proxy } = require('../apps/web/src/proxy.ts');
const { FINANCIAL_AGENT_TOOLS } = require('../apps/web/src/lib/server/agent/tools.ts');
const { runFinancialAgent } = require('../apps/web/src/lib/server/agent/engine.ts');
const { AdminGuard } = require('../apps/site-api/src/auth/admin.guard.ts');
const { SupabaseAuthGuard } = require('../apps/site-api/src/auth/supabase-auth.guard.ts');
const { MeController } = require('../apps/site-api/src/auth/me.controller.ts');
const { getPostLoginRedirect, checkIsAdmin } = require('../apps/site/lib/auth-dest.ts');
const context = (req) => ({ switchToHttp: () => ({ getRequest: () => req }) });
const profileClient = (role, error = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null, error }) }) }) }) });
const json = (data, status = 200) => Response.json(data, { status });
const oldFetch = global.fetch;
const mockFetch = async (fn, body) => { global.fetch = fn; try { await body(); } finally { global.fetch = oldFetch; } };

test('admin guards deny email-only privileges, preserve database roles, and fail closed', async () => {
  const member = { id: 'member-id', email: 'edomiyastesfaye321@gmail.com', role: 'member' };
  assert.throws(() => new AdminGuard().canActivate(context({ user: member })));
  for (const role of ['owner', 'admin']) assert.equal(new AdminGuard().canActivate(context({ user: { ...member, role } })), true);
  assert.equal(new MeController().me(member).isAdmin, false);
  const service = { db: { ...profileClient('member'), auth: { getUser: async () => ({ data: { user: member }, error: null }) } } };
  const req = { headers: { authorization: 'Bearer test-token' } };
  await new SupabaseAuthGuard(service).canActivate(context(req));
  assert.equal(req.user.role, 'member');
  assert.equal(await checkIsAdmin(profileClient(null, { message: 'unavailable' }), member), false);
});

test('routing uses explicit admin intent and rejects external or malformed destinations', async () => {
  const user = { id: 'u1' };
  assert.equal(await getPostLoginRedirect(profileClient('owner'), user), '/open-app');
  assert.equal(await getPostLoginRedirect(profileClient('owner'), user, '/open-app'), '/open-app');
  assert.equal(await getPostLoginRedirect(profileClient('owner'), user, '/admin'), '/admin');
  assert.equal(await getPostLoginRedirect(profileClient('member'), user, '/admin'), '/open-app');
  for (const next of ['//evil.example', '/\\evil.example', '/admin/../admin', 'https://evil.example']) {
    assert.equal(await getPostLoginRedirect(profileClient('owner'), user, next), '/open-app');
  }
});

test('same-origin checks reject missing and foreign origins', () => {
  assert.equal(sameOriginRequest('https://app.fremwork.com', 'https://app.fremwork.com'), true);
  for (const origin of [null, 'null', 'https://fremwork.com', 'https://fremwork-land.onrender.com', 'https://app.fremwork.com.evil.example']) {
    assert.equal(sameOriginRequest(origin, 'https://app.fremwork.com'), false);
  }
});

test('tenant requests bind both the bearer token and user filter, including hostile filters', async () => {
  const calls = [];
  await mockFetch(async (url, init) => { calls.push({ url: new URL(url), init }); return json([]); }, async () => {
    await assert.rejects(db.select('ledger_transactions'), /No signed-in/);
    await Promise.all(['alice', 'bob'].map((userId) => userScope.run({ userId, token: `${userId}-token` }, () => db.select('ledger_transactions', { user_id: 'eq.victim' }))));
  });
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    const user = init.headers.Authorization.split(' ')[1].split('-')[0];
    assert.equal(url.searchParams.get('user_id'), `eq.${user}`);
  }
});

test('the retired cross-site handoff ignores posted tokens: no Supabase call, no cookies, just sign in', async () => {
  let calls = 0;
  await mockFetch(async () => { calls++; return json({}); }, async () => {
    for (const origin of ['https://fremwork-land.onrender.com', 'https://fremwork.com', 'https://evil.example']) {
      const req = new NextRequest('https://fremwork-app.onrender.com/api/auth/session', { method: 'POST', headers: { origin, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ access_token: 'a', refresh_token: 'r' }) });
      const res = await handoff(req);
      assert.equal(res.status, 303);
      assert.equal(res.headers.get('location'), '/sign-in');
      assert.equal(res.headers.get('set-cookie'), null);
    }
  });
  assert.equal(calls, 0);
});

const pkceCookie = (res) => /fremwork_pkce=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1];

test('Google sign-in starts on this site with PKCE; the verifier stays in an HttpOnly cookie', async () => {
  const req = new NextRequest('http://localhost:10000/api/auth/google', { headers: { host: 'fremwork-app.onrender.com', 'x-forwarded-proto': 'https' } });
  const res = await googleStart(req);
  assert.equal(res.status, 303);
  const to = new URL(res.headers.get('location'));
  assert.equal(to.pathname, '/auth/v1/authorize');
  assert.equal(to.searchParams.get('provider'), 'google');
  assert.equal(to.searchParams.get('redirect_to'), 'https://fremwork-app.onrender.com/auth/callback');
  assert.equal(to.searchParams.get('code_challenge_method'), 's256');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Path=\/auth\/callback/i);
  const [purpose, verifier] = decodeURIComponent(pkceCookie(res)).split('.');
  assert.equal(purpose, 'signin');
  assert.equal(to.searchParams.get('code_challenge'), createHash('sha256').update(verifier).digest('base64url'));
  assert.ok(!to.toString().includes(verifier), 'the verifier never leaves this site');
});

test('callback exchanges the one-time code with the stored verifier, then sets the session', async () => {
  const verifier = 'v'.repeat(64);
  const seen = [];
  await mockFetch(async (url, init) => {
    seen.push({ url: String(url), body: init && init.body });
    return String(url).includes('grant_type=pkce')
      ? json({ access_token: 'acc', refresh_token: 'ref', expires_in: 3600 })
      : json({ id: 'u1', email: 'test@example.invalid', email_confirmed_at: '2026-01-01' });
  }, async () => {
    const ok = await callback(new NextRequest('https://fremwork-app.onrender.com/auth/callback?code=abc', { headers: { cookie: 'fremwork_pkce=signin.' + verifier } }));
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/chat');
    assert.match(ok.headers.get('set-cookie'), /fremwork_access=acc/);
    assert.deepEqual(JSON.parse(seen[0].body), { auth_code: 'abc', code_verifier: verifier });

    const recovery = await callback(new NextRequest('https://fremwork-app.onrender.com/auth/callback?code=abc', { headers: { cookie: 'fremwork_pkce=recovery.' + verifier } }));
    assert.equal(recovery.headers.get('location'), '/reset-password');
  });

  // Without this browser's verifier (another browser, or a forged link) no session is created.
  for (const cookie of ['', 'fremwork_pkce=signin.short', 'fremwork_pkce=admin.' + verifier]) {
    const res = await callback(new NextRequest('https://fremwork-app.onrender.com/auth/callback?code=abc', { headers: cookie ? { cookie } : {} }));
    assert.equal(res.headers.get('location'), '/sign-in?error=expired');
    assert.doesNotMatch(res.headers.get('set-cookie') || '', /fremwork_access=/);
  }
  const denied = await callback(new NextRequest('https://fremwork-app.onrender.com/auth/callback?error=access_denied'));
  assert.equal(denied.headers.get('location'), '/sign-in?error=provider');
  const legacy = await callback(new NextRequest('https://fremwork-app.onrender.com/auth/callback'));
  assert.equal(legacy.status, 200);
  assert.match(await legacy.text(), /location\.replace\("\/sign-in\?notice=confirmed"\)/);
});

test('password reset emails use PKCE back to this site', async () => {
  let sent;
  await mockFetch(async (url, init) => { sent = { url: String(url), body: JSON.parse(init.body) }; return json({}); }, async () => {
    const res = await forgot(new NextRequest('http://localhost:10000/api/auth/forgot', { method: 'POST', headers: { host: 'fremwork-app.onrender.com', 'x-forwarded-proto': 'https' }, body: JSON.stringify({ email: 'A@Example.invalid' }) }));
    assert.equal(res.status, 200);
    assert.match(decodeURIComponent(pkceCookie(res)), /^recovery\./);
  });
  assert.match(sent.url, /redirect_to=https%3A%2F%2Ffremwork-app\.onrender\.com%2Fauth%2Fcallback/);
  assert.equal(sent.body.email, 'a@example.invalid');
  assert.equal(sent.body.code_challenge_method, 's256');
  assert.match(sent.body.code_challenge, /^[A-Za-z0-9_-]{43}$/);
});

test('expired and forged sessions cannot open private pages or APIs; cross-site writes are rejected', async () => {
  await mockFetch(async () => json({ error: 'expired' }, 401), async () => {
    const page = await proxy(new NextRequest('https://app.fremwork.com/chat', { headers: { cookie: 'fremwork_access=forged; fremwork_refresh=expired' } }));
    assert.match(page.headers.get('location'), /\/sign-in$/);
    assert.equal((await proxy(new NextRequest('https://app.fremwork.com/api/chat'))).status, 401);
    assert.equal((await proxy(new NextRequest('https://app.fremwork.com/api/transactions', { method: 'POST', headers: { origin: 'https://evil.example' } }))).status, 403);
  });
});

test('behind a reverse proxy (Render) same-origin writes and redirects use the public host, not the listen address', async () => {
  const host = 'fremwork-app.onrender.com';
  const proxied = (path, init = {}) => new NextRequest(`http://localhost:10000${path}`, { ...init, headers: { host, 'x-forwarded-proto': 'https', ...init.headers } });
  assert.equal(publicOrigin(proxied('/')), `https://${host}`);
  assert.equal(publicOrigin(new NextRequest('http://localhost:3000/', { headers: { host: 'bad host/evil' } })), 'http://localhost:3000');
  await mockFetch(async () => json({ error: 'expired' }, 401), async () => {
    // A same-origin write from the public site reaches its handler (401 = not signed in, not a 403 origin rejection).
    assert.equal((await proxy(proxied('/api/chat', { method: 'POST', headers: { origin: `https://${host}` } }))).status, 401);
    assert.equal((await proxy(proxied('/api/chat', { method: 'POST', headers: { origin: 'https://evil.example' } }))).status, 403);
    assert.equal((await proxy(proxied('/chat'))).headers.get('location'), `https://${host}/sign-in`);
  });
});

test('agent is read-only, processes bounded tools, and never executes a provider-requested mutation', async () => {
  for (const name of ['addTransaction', 'createBudget', 'createGoal']) assert.equal(FINANCIAL_AGENT_TOOLS[name], undefined);
  const previous = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
  process.env.GEMINI_API_KEY = 'test-provider-key'; process.env.GEMINI_MODEL = 'test-model';
  let providerCalls = 0;
  try {
    await mockFetch(async (url, init) => {
      if (String(url).includes('/rpc/')) return json(1);
      assert.match(String(url), /generativelanguage.googleapis.com/);
      const request = JSON.parse(init.body);
      assert.equal(request.tools[0].functionDeclarations.some((t) => /add_transaction|create_budget|create_goal/.test(t.name)), false);
      return ++providerCalls === 1 ? json({ candidates: [{ content: { parts: [{ functionCall: { name: 'add_transaction', args: { amount: 100 } } }] } }] })
        : json({ candidates: [{ content: { parts: [{ text: 'Use the ledger form to record this.' }] } }] });
    }, async () => {
      const result = await userScope.run({ userId: 'test-user', token: 'test-token' }, () => runFinancialAgent([{ role: 'user', text: 'Record income' }]));
      assert.equal(result.actionsTaken.length, 0);
      assert.match(result.toolCalls[0].result.error, /Unknown tool/);
    });
  } finally {
    for (const [name, val] of [['GEMINI_API_KEY', previous.key], ['GEMINI_MODEL', previous.model]]) if (val === undefined) delete process.env[name]; else process.env[name] = val;
  }
});

const { transactionError } = require('../apps/web/src/lib/server/validation.ts');
test('manual ledger validation rejects nonfinite, coerced, fractional-cent and invalid-date records', () => {
  const valid = { name: 'Test only', amt: -12.34, date: '2026-11-08' };
  assert.equal(transactionError(valid), null);
  for (const patch of [{ amt: NaN }, { amt: Infinity }, { amt: '12.00' }, { amt: 0.001 }, { amt: 1e15 }, { date: '2026-02-30' }, { name: {} }, { status: 'invented' }]) {
    assert.ok(transactionError({ ...valid, ...patch }));
  }
  assert.equal(transactionError({ amt: 14.5 }, true), null);
});

test('session refresh is forwarded to the current request and persisted; logout clears both cookies', async () => {
  const { POST: logout } = require('../apps/web/src/app/api/auth/me/route.ts');
  await mockFetch(async (url) => String(url).includes('/token?')
    ? json({ access_token: 'fresh-test', refresh_token: 'rotated-test', expires_in: 3600 })
    : json({}), async () => {
    const response = await proxy(new NextRequest('https://app.fremwork.com/chat', { headers: { cookie: 'fremwork_refresh=valid-test' } }));
    assert.match(response.headers.get('set-cookie'), /fremwork_access=fresh-test/);
    assert.match(response.headers.get('x-middleware-request-cookie'), /fremwork_access=fresh-test/);
    const signedOut = await logout(new NextRequest('https://app.fremwork.com/api/auth/me', { method: 'POST', headers: { cookie: 'fremwork_access=fresh-test' } }));
    assert.equal(signedOut.status, 200);
    assert.equal(signedOut.cookies.get('fremwork_access').value, '');
    assert.equal(signedOut.cookies.get('fremwork_refresh').value, '');
  });
});

test('workspace uses the supplied project and canonical public settings override stale server aliases', () => {
  const names = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'FREMWORK_SUPABASE_URL', 'FREMWORK_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const file = require.resolve('../apps/web/src/lib/server/auth.ts');
  try {
    names.forEach((name) => delete process.env[name]); delete require.cache[file];
    assert.equal(require(file).SUPABASE_URL, 'https://jwznteirgsnebvtswppu.supabase.co');
    process.env.FREMWORK_SUPABASE_URL = 'https://stale.example';
    process.env.FREMWORK_SUPABASE_PUBLISHABLE_KEY = 'stale-test-key';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://canonical.example';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'canonical-test-key';
    delete require.cache[file];
    assert.equal(require(file).SUPABASE_URL, 'https://canonical.example');
    assert.equal(require(file).SUPABASE_KEY, 'canonical-test-key');
  } finally {
    for (const [name, value] of Object.entries(before)) if (value === undefined) delete process.env[name]; else process.env[name] = value;
    delete require.cache[file];
  }
});
