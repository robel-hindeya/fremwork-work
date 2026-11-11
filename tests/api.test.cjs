// End-to-end tests for apps/api (the NestJS backend), run against the compiled build in production
// mode. Supabase (Auth + PostgREST with row level security) and Gemini are emulated in memory, so
// every request goes through the real guards, services, Supabase client and HTTP layer.
// Run: npm run build:api && node tests/api.test.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const SUPABASE = 'https://test-project.supabase.co';
Object.assign(process.env, {
  NODE_ENV: 'production',
  SUPABASE_URL: SUPABASE,
  SUPABASE_ANON_KEY: 'sb_publishable_test',
  GEMINI_API_KEY: 'test-gemini-key',
  GEMINI_MODEL: 'test-model',
  AI_DAILY_LIMIT: '3',
  CORS_ORIGINS: 'https://app.fremwork.com',
});
delete process.env.ANTHROPIC_API_KEY;

const dist = path.resolve(__dirname, '../apps/api/dist/apps/api/src');
const { NestFactory } = require(path.join(__dirname, '../node_modules/@nestjs/core'));
const { AppModule } = require(`${dist}/app.module.js`);
const { FremworkExceptionFilter } = require(`${dist}/common/filters/http-exception.filter.js`);
const { configErrors, isAllowedOrigin, loadConfig } = require(`${dist}/config/env.js`);
const { calculate } = require(`${dist}/modules/chat/calculate.js`);
const { parseAnswer, blocksToMarkdown } = require(`${dist}/modules/chat/blocks.js`);

// ---------- Emulated Supabase ----------
const USERS = {
  'alice-token': { id: '11111111-1111-1111-1111-111111111111', email: 'alice@example.invalid', email_confirmed_at: '2026-01-01', user_metadata: { company: 'Alice Co' } },
  'bob-token': { id: '22222222-2222-2222-2222-222222222222', email: 'bob@example.invalid', email_confirmed_at: '2026-01-01', user_metadata: {} },
  'unconfirmed-token': { id: '33333333-3333-3333-3333-333333333333', email: 'c@example.invalid', email_confirmed_at: null, user_metadata: {} },
};
const tables = {};
const usage = {};
const reset = () => {
  for (const t of ['ledger_transactions', 'ledger_budgets', 'ledger_goals', 'ledger_projects', 'ledger_tasks', 'ledger_conversations', 'ledger_messages']) tables[t] = [];
  for (const k of Object.keys(usage)) delete usage[k];
};
reset();

const likeRegex = (pattern, flags) => new RegExp(`^${pattern.replace(/\\([\\%_*])|([%*])|(_)|([.+?^${}()|[\]])/g, (m, esc, star, under, special) =>
  esc ? `\\${esc}`.replace('\\%', '%').replace('\\_', '_').replace('\\*', '\\*') : star ? '.*' : under ? '.' : `\\${special}`)}$`, flags);
const unquote = (v) => (v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v);
const cmp = (a, b) => (typeof a === 'number' || !isNaN(Number(a)) && !isNaN(Number(b)) && /^-?\d/.test(String(b)) ? Number(a) - Number(b) : String(a).localeCompare(String(b)));

function matches(row, col, expr) {
  const [op, ...rest] = expr.split('.');
  const val = unquote(rest.join('.'));
  const cell = row[col];
  switch (op) {
    case 'eq': return String(cell) === val;
    case 'neq': return String(cell) !== val;
    case 'gt': return cmp(cell, val) > 0;
    case 'lt': return cmp(cell, val) < 0;
    case 'gte': return cmp(cell, val) >= 0;
    case 'lte': return cmp(cell, val) <= 0;
    case 'like': return likeRegex(val, '').test(String(cell));
    case 'ilike': return likeRegex(val, 'i').test(String(cell));
    case 'is': return val === 'null' ? cell == null : String(cell) === val;
    case 'not': return !matches(row, col, rest.join('.'));
    default: throw new Error(`unsupported op ${op}`);
  }
}
function splitOr(s) {
  const parts = []; let cur = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { cur += c + s[++i]; continue; }
    if (c === '"') q = !q;
    if (c === ',' && !q) { parts.push(cur); cur = ''; } else cur += c;
  }
  return [...parts, cur];
}
function filterRows(list, params) {
  let out = list;
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'columns'].includes(k)) continue;
    if (k === 'or') {
      const alts = splitOr(v.slice(1, -1)).map((a) => { const i = a.indexOf('.'); return [a.slice(0, i), a.slice(i + 1)]; });
      out = out.filter((r) => alts.some(([c, e]) => matches(r, c, e)));
    } else out = out.filter((r) => matches(r, k, v));
  }
  return out;
}
const json = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let geminiScript = null;
const realFetch = global.fetch;
global.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined));
  const method = (init.method || 'GET').toUpperCase();
  const token = (headers.get('authorization') || '').replace(/^Bearer /, '');

  if (url.origin === 'https://generativelanguage.googleapis.com') {
    assert.equal(url.search, '', 'Gemini key must not be sent in the URL');
    assert.equal(headers.get('x-goog-api-key'), 'test-gemini-key');
    return geminiScript(JSON.parse(init.body));
  }
  if (url.origin !== SUPABASE) return realFetch(input, init);
  assert.equal(headers.get('apikey'), 'sb_publishable_test');

  if (url.pathname === '/auth/v1/health') return json(200, { name: 'GoTrue' });
  if (url.pathname === '/auth/v1/user') {
    const user = USERS[token];
    if (!user) return json(401, { msg: 'invalid JWT' });
    if (method === 'PUT') user.user_metadata = { ...user.user_metadata, ...JSON.parse(init.body).data };
    return json(200, user);
  }
  const m = url.pathname.match(/^\/rest\/v1\/(.+)$/);
  if (!m) return json(404, {});
  const user = USERS[token];
  const table = tables[m[1]];
  // Like PostgREST: an unknown table is 404 before permissions are considered.
  if (!table && m[1] !== 'rpc/bump_ai_usage') return json(404, { code: 'PGRST205', message: 'missing table' });
  if (!user) return json(401, { code: '42501', message: 'permission denied' }); // anon has no grants
  if (m[1] === 'rpc/bump_ai_usage') return json(200, (usage[user.id] = (usage[user.id] || 0) + 1));
  // Row level security: a user only ever sees their own rows.
  const mine = () => table.filter((r) => r.user_id === user.id);
  const params = [...url.searchParams.entries()];
  const single = (headers.get('accept') || '').includes('vnd.pgrst.object');
  const respond = (list) => {
    const sel = url.searchParams.get('select');
    const shaped = !sel || sel === '*' ? list : list.map((r) => Object.fromEntries(sel.split(',').map((c) => [c, r[c]])));
    if (single) return shaped.length === 1 ? json(200, shaped[0]) : json(406, { code: 'PGRST116', message: 'not one row' });
    return json(200, shaped);
  };

  if (method === 'GET') {
    let list = filterRows(mine(), params);
    const order = url.searchParams.get('order');
    if (order) {
      const keys = order.split(',').map((o) => o.split('.'));
      list = [...list].sort((a, b) => { for (const [c, d] of keys) { const x = cmp(a[c], b[c]); if (x) return d === 'desc' ? -x : x; } return 0; });
    }
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : Infinity;
    return respond(list.slice(offset, offset + limit));
  }
  if (method === 'POST') {
    const body = JSON.parse(init.body);
    const now = new Date(Date.now() + table.length).toISOString();
    const row = { created_at: now, ...(m[1] === 'ledger_conversations' ? { updated_at: now } : {}), ...body, user_id: user.id };
    if (row.amt !== undefined) row.amt = Number(row.amt);
    if (table.some((r) => r.user_id === user.id && r.id === row.id)) return json(409, { code: '23505', message: 'duplicate key' });
    if (m[1] === 'ledger_budgets' && table.some((r) => r.user_id === user.id && r.k === row.k)) return json(409, { code: '23505', message: 'duplicate k' });
    table.push(row);
    return respond([row]);
  }
  if (method === 'PATCH') {
    const hits = filterRows(mine(), params);
    for (const r of hits) Object.assign(r, JSON.parse(init.body));
    return respond(hits);
  }
  if (method === 'DELETE') {
    const hits = filterRows(mine(), params);
    for (const r of hits) {
      table.splice(table.indexOf(r), 1);
      if (m[1] === 'ledger_conversations') tables.ledger_messages = tables.ledger_messages.filter((x) => !(x.user_id === r.user_id && x.conversation_id === r.id));
    }
    return respond(hits);
  }
  return json(405, {});
};

// ---------- HTTP helpers ----------
let app;
let base;
function request(method, url, { token, body, origin, raw } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(base + url, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(data ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin, 'access-control-request-method': 'POST' } : {}) },
    }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, body: raw ? null : (() => { try { return JSON.parse(text); } catch { return null; } })() }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sse = (text) => text.split('\n\n').filter((c) => c.startsWith('event:')).map((c) => {
  const [e, d] = c.split('\n');
  return { event: e.slice(7), data: JSON.parse(d.slice(6)) };
});

before(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1', { exclude: ['/', 'v1', 'api/health', 'api/health/ready'] });
  app.enableCors({ origin: (o, cb) => cb(null, isAllowedOrigin(o, loadConfig())), credentials: true });
  app.useGlobalFilters(new FremworkExceptionFilter());
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
});
after(async () => { await app.close(); global.fetch = realFetch; });

// ---------- Tests ----------
test('production config: fails without Supabase, rejects secret keys and wildcard CORS', () => {
  const ok = loadConfig();
  assert.deepEqual(configErrors(ok), []);
  assert.ok(configErrors({ ...ok, supabaseUrl: '' }).some((e) => /SUPABASE_URL/.test(e)));
  assert.ok(configErrors({ ...ok, supabaseKey: 'sb_secret_abc' }).some((e) => /service-role/.test(e)));
  const serviceJwt = `x.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.y`;
  assert.ok(configErrors({ ...ok, supabaseKey: serviceJwt }).some((e) => /service-role/.test(e)));
  assert.ok(configErrors({ ...ok, corsOrigins: ['*'] }).length);
  assert.ok(configErrors({ ...ok, geminiModel: null }).some((e) => /GEMINI_MODEL/.test(e)));
});

test('CORS allows only configured origins in production', async () => {
  assert.equal(isAllowedOrigin('https://app.fremwork.com', { corsOrigins: ['https://app.fremwork.com'], production: true }), true);
  assert.equal(isAllowedOrigin('https://evil.example', { corsOrigins: ['https://app.fremwork.com'], production: true }), false);
  assert.equal(isAllowedOrigin('http://localhost:3000', { corsOrigins: [], production: true }), false);
  assert.equal(isAllowedOrigin('http://localhost:3000', { corsOrigins: [], production: false }), true);
  const good = await request('OPTIONS', '/v1/transactions', { origin: 'https://app.fremwork.com' });
  assert.equal(good.headers['access-control-allow-origin'], 'https://app.fremwork.com');
  const bad = await request('OPTIONS', '/v1/transactions', { origin: 'https://evil.example' });
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
});

test('health: liveness on /api/health and /v1/health, readiness checks Supabase and schema', async () => {
  for (const p of ['/api/health', '/v1/health']) {
    const r = await request('GET', p);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'ok');
  }
  const ready = await request('GET', '/api/health/ready');
  assert.equal(ready.status, 200);
  assert.deepEqual(ready.body.checks.supabaseAuth, 'ok');
  assert.deepEqual(ready.body.checks.ledgerSchema, 'ok');
  delete tables.ledger_transactions;
  const missing = await request('GET', '/v1/health/ready');
  assert.equal(missing.status, 503);
  assert.equal(missing.body.checks.ledgerSchema, 'missing');
  reset();
});

test('auth: missing, forged, demo and unconfirmed tokens are rejected', async () => {
  for (const token of [undefined, 'forged', 'mock-token', 'test', 'unconfirmed-token']) {
    const r = await request('GET', '/v1/transactions', { token });
    assert.equal(r.status, 401, `token ${token}`);
    assert.equal(r.body.error.code, 'unauthenticated');
  }
});

test('ledger: create, validate, filter, totals, update, delete — stored in Supabase as dollars', async () => {
  reset();
  const t = 'alice-token';
  const a = await request('POST', '/v1/transactions', { token: t, body: { payee: 'Acme Corp', amountMinor: 420000, categoryName: 'Services', date: '2026-11-02', memo: 'Invoice 7' } });
  assert.equal(a.status, 201);
  assert.equal(a.body.data.amountMinor, 420000);
  assert.equal(a.body.data.status, 'cleared');
  assert.equal(tables.ledger_transactions[0].amt, 4200, 'stored as dollars for the shared schema');
  await request('POST', '/v1/transactions', { token: t, body: { name: 'AWS', amt: -628.17, cat: 'Software', date: '2026-11-03', status: 'Pending' } });
  await request('POST', '/v1/transactions', { token: t, body: { payee: 'Figma', amount: -144, categoryName: 'Software', date: '2026-10-20' } });

  for (const bad of [{ payee: 'x' }, { payee: 'x', amountMinor: 1.5 }, { payee: 'x', amount: 1.234 }, { payee: 'x', amount: 0 }, { payee: 'x', amount: 5, date: '2026-02-30' }, { payee: 'x', amount: 5, status: 'stolen' }, { payee: '', amount: 5 }]) {
    const r = await request('POST', '/v1/transactions', { token: t, body: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.error.code, 'validation_failed');
  }

  const all = await request('GET', '/v1/transactions', { token: t });
  assert.equal(all.body.data.length, 3);
  assert.deepEqual(all.body.totals, { count: 3, moneyInMinor: 420000, moneyOutMinor: 77217, netMinor: 342783 });
  assert.equal(all.body.data[0].date, '2026-11-03', 'newest first');

  const software = await request('GET', '/v1/transactions?category=software&type=expense', { token: t });
  assert.equal(software.body.totals.count, 2);
  const search = await request('GET', '/v1/transactions?q=acme', { token: t });
  assert.deepEqual(search.body.data.map((x) => x.payee), ['Acme Corp']);
  const ranged = await request('GET', '/v1/transactions?from=2026-11-01&to=2026-11-30&limit=1', { token: t });
  assert.equal(ranged.body.totals.count, 2);
  assert.equal(ranged.body.data.length, 1);

  const id = a.body.data.id;
  const patched = await request('PATCH', `/v1/transactions/${id}`, { token: t, body: { status: 'flagged', note: 'Check PO' } });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.status, 'flagged');
  assert.equal(tables.ledger_transactions.find((r) => r.id === id).status, 'Flagged');
  const put = await request('PUT', `/v1/transactions/${id}`, { token: t, body: { amountMinor: 430000 } });
  assert.equal(put.body.data.amountMinor, 430000);
  assert.equal((await request('GET', `/v1/transactions/${id}`, { token: t })).body.data.note, 'Check PO');
  assert.equal((await request('DELETE', `/v1/transactions/${id}`, { token: t })).status, 200);
  assert.equal((await request('DELETE', `/v1/transactions/${id}`, { token: t })).status, 404);
});

test('tenant isolation: one user can never read, change or delete another user’s rows, whatever X-Workspace-Id says', async () => {
  reset();
  const created = await request('POST', '/v1/transactions', { token: 'alice-token', body: { payee: 'Secret', amount: 999, date: '2026-11-01' } });
  const id = created.body.data.id;
  const bobList = await request('GET', '/v1/transactions', { token: 'bob-token' });
  assert.deepEqual(bobList.body.data, []);
  assert.equal((await request('GET', `/v1/transactions/${id}`, { token: 'bob-token' })).status, 404);
  assert.equal((await request('PATCH', `/v1/transactions/${id}`, { token: 'bob-token', body: { amount: 1 } })).status, 404);
  assert.equal((await request('DELETE', `/v1/transactions/${id}`, { token: 'bob-token' })).status, 404);
  assert.equal(tables.ledger_transactions[0].amt, 999);
  assert.equal(created.body.data.workspaceId, USERS['alice-token'].id);
});

test('budgets: actual spend this month comes from the ledger; duplicate categories conflict', async () => {
  reset();
  const t = 'alice-token';
  const month = new Date().toISOString().slice(0, 7);
  await request('POST', '/v1/transactions', { token: t, body: { payee: 'Slack', amount: -300, categoryName: 'Software', date: `${month}-01` } });
  await request('POST', '/v1/transactions', { token: t, body: { payee: 'Bounced', amount: -5000, categoryName: 'Software', date: `${month}-02`, status: 'failed' } });
  const b = await request('POST', '/v1/budgets', { token: t, body: { categoryName: 'Software', amountMinor: 50000, alertAtPct: 80, ownerLabel: 'Ops' } });
  assert.equal(b.status, 201);
  assert.equal(b.body.data.spentMinor, 30000, 'failed payments do not count');
  assert.equal(b.body.data.alertAtPct, 80);
  assert.equal(b.body.data.period, month);
  assert.equal((await request('POST', '/v1/budgets', { token: t, body: { categoryName: 'Software', amount: 10 } })).status, 409);
  assert.equal((await request('POST', '/v1/budgets', { token: t, body: { categoryName: 'X', amount: -10 } })).status, 400);
  const patched = await request('PATCH', `/v1/budgets/${b.body.data.id}`, { token: t, body: { budget: 750 } });
  assert.equal(patched.body.data.amountMinor, 75000);
  assert.equal((await request('GET', '/v1/budgets', { token: t })).body.data.length, 1);
  assert.equal((await request('DELETE', `/v1/budgets/${b.body.data.id}`, { token: t })).status, 200);
});

test('goals and projects persist with validation', async () => {
  reset();
  const t = 'alice-token';
  const g = await request('POST', '/v1/goals', { token: t, body: { name: 'Cash reserve', type: 'Savings target', targetMinor: 10000000, currentMinor: 2500000, targetDate: '2027-06-30' } });
  assert.equal(g.status, 201);
  assert.equal(g.body.data.startMinor, 2500000);
  assert.equal(tables.ledger_goals[0].target, 100000);
  assert.equal((await request('POST', '/v1/goals', { token: t, body: { name: 'x', type: 'Lottery', target: 5, date: '2027-01-01' } })).status, 400);
  assert.equal((await request('PATCH', `/v1/goals/${g.body.data.id}`, { token: t, body: { status: 'Behind pace' } })).body.data.status, 'Behind pace');
  assert.equal((await request('GET', '/v1/goals', { token: 'bob-token' })).body.data.length, 0);

  const p = await request('POST', '/v1/projects', { token: t, body: { name: 'Q4 Board Pack', desc: 'Board materials' } });
  assert.equal(p.status, 201);
  assert.match(p.body.data.id, /^q4-board-pack-/);
  assert.equal(p.body.data.chatsCount, 0);
  const upd = await request('PUT', `/v1/projects/${p.body.data.id}`, { token: t, body: { chats: ['c-1', 'c-2'] } });
  assert.equal(upd.body.data.chatsCount, 2);
  assert.equal((await request('GET', `/v1/projects/${p.body.data.id}`, { token: t })).body.data.description, 'Board materials');
  assert.equal((await request('DELETE', `/v1/projects/${p.body.data.id}`, { token: t })).status, 200);
});

test('overview and analytics are computed from the user’s ledger', async () => {
  reset();
  const t = 'alice-token';
  const now = new Date();
  const m = (offset) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 5)).toISOString().slice(0, 10);
  for (const [payee, amount, cat, date, status] of [
    ['Client A', 10000, 'Services', m(0)], ['Client A', 8000, 'Services', m(1)], ['Payroll', -6000, 'Payroll', m(0)],
    ['Payroll', -6000, 'Payroll', m(1)], ['Flights', -900, 'Travel', m(0)], ['Flights', -300, 'Travel', m(1)], ['Late client', 500, 'Services', m(0), 'pending'],
  ]) await request('POST', '/v1/transactions', { token: t, body: { payee, amount, categoryName: cat, date, ...(status ? { status } : {}) } });

  const o = (await request('GET', '/v1/overview', { token: t })).body.data;
  assert.equal(o.hasData, true);
  assert.equal(o.cashMinor, 480000, 'pending is not cash yet');
  assert.equal(o.kpis.totalRevenueMinor, 1050000);
  assert.equal(o.kpis.totalExpensesMinor, 690000);
  assert.equal(o.kpis.netProfitMinor, 360000);
  assert.equal(o.kpis.operatingCashFlowMinor, 310000);
  assert.equal(o.monthlySeries.months.length, 6);
  assert.equal(o.pendingCount, 1);
  assert.ok(o.insights.some((i) => i.kind === 'unusual expense' && /Travel/.test(i.title)));
  assert.ok(o.insights.some((i) => i.kind === 'revenue change'));
  assert.equal((await request('GET', '/v1/overview?period=2026-13', { token: t })).status, 400);

  const a = (await request('GET', '/v1/analytics', { token: t })).body.data;
  assert.equal(a.totals.revenueMinor, 1850000);
  assert.equal(a.totals.expensesMinor, 1320000);
  assert.equal(a.expenseBreakdown[0].category, 'Payroll');
  assert.equal(a.expenseBreakdown.reduce((s, x) => s + x.amountMinor, 0), 1320000);

  const empty = (await request('GET', '/v1/overview', { token: 'bob-token' })).body.data;
  assert.equal(empty.hasData, false);
  assert.deepEqual(empty.insights, []);
});

test('chat: SSE answer uses ledger tools, is saved, and history is sent on the next turn', async () => {
  reset();
  const t = 'alice-token';
  await request('POST', '/v1/transactions', { token: t, body: { payee: 'AWS', amount: -628.17, categoryName: 'Software', date: '2026-11-03' } });
  const seen = [];
  geminiScript = (body) => {
    seen.push(body);
    const last = body.contents[body.contents.length - 1];
    if (last.role === 'user' && last.parts[0].text) {
      return json(200, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'query_transactions', args: { category: 'Software' } } }, { functionCall: { name: 'calculate', args: { expression: '628.17 * 12', label: 'Annualized' } } }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } });
    }
    const out = last.parts.map((p) => p.functionResponse.response.output);
    assert.equal(out[0].transactions[0].payee, 'AWS', 'tool reads the real ledger');
    assert.equal(out[1].result, 7538.04);
    return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: '```json\n[{"type":"text","text":"Software spend is **$628.17**."},{"type":"table","head":["Payee","Amount"],"rows":[["AWS",-628.17]]},{"type":"bogus"}]\n```' }] } }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8 } });
  };

  const convo = await request('POST', '/v1/conversations', { token: t, body: { title: 'New conversation' } });
  const id = convo.body.data.id;
  const r = await request('POST', `/v1/conversations/${id}/messages`, { token: t, body: { text: 'What do we spend on software?' }, raw: true });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-type'], /text\/event-stream/);
  const events = sse(r.text);
  assert.deepEqual(events.map((e) => e.event), ['meta', 'block', 'block', 'block', 'done']);
  assert.deepEqual(events.slice(1, 4).map((e) => e.data.type), ['calc', 'text', 'table'], 'unknown block types are dropped');
  assert.deepEqual(events[4].data, { status: 'done', tokensIn: 30, tokensOut: 13 });

  const saved = (await request('GET', `/v1/conversations/${id}`, { token: t })).body.data;
  assert.equal(saved.title, 'What do we spend on software?');
  assert.deepEqual(saved.messages.map((x) => x.role), ['user', 'assistant']);
  assert.match(saved.messages[1].blocks[0].text, /\| AWS \| -628.17 \|/);

  geminiScript = (body) => {
    assert.deepEqual(body.contents.slice(0, 3).map((c) => c.role), ['user', 'model', 'user'], 'prior turns are included');
    return json(200, { candidates: [{ content: { parts: [{ text: 'Plain answer.' }] } }] });
  };
  const second = sse((await request('POST', `/v1/conversations/${id}/messages`, { token: t, body: { message: 'And last month?' }, raw: true })).text);
  assert.deepEqual(second[1].data, { type: 'text', text: 'Plain answer.' });

  assert.equal((await request('POST', `/v1/conversations/${id}/messages`, { token: t, body: { text: '   ' } })).status, 400);
  assert.equal((await request('POST', `/v1/conversations/${id}/messages`, { token: t, body: { text: 'hi', mode: 'Turbo' } })).status, 400);
  assert.equal((await request('GET', `/v1/conversations/${id}`, { token: 'bob-token' })).status, 404);
  assert.equal((await request('GET', '/v1/conversations', { token: t })).body.data.length, 1);
});

test('chat: daily AI limit and provider errors become readable answers, not crashes', async () => {
  const t = 'bob-token';
  geminiScript = () => json(200, { candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
  for (let i = 0; i < 3; i++) sse((await request('POST', '/v1/conversations/c-limit/messages', { token: t, body: { text: `q${i}` }, raw: true })).text);
  const limited = sse((await request('POST', '/v1/conversations/c-limit/messages', { token: t, body: { text: 'one more' }, raw: true })).text);
  assert.match(limited[1].data.text, /today's limit of 3/);
  assert.equal(limited[2].data.status, 'error');
  assert.equal(tables.ledger_messages.at(-1).status, 'limit');

  for (const k of Object.keys(usage)) delete usage[k];
  geminiScript = () => json(404, { error: { message: 'model not found' } });
  const failed = sse((await request('POST', '/v1/conversations/c-limit/messages', { token: t, body: { text: 'hello' }, raw: true })).text);
  assert.match(failed[1].data.text, /configured AI model is unavailable/);
});

test('tasks: run sends the prompt to the AI, saves a chat and records the result', async () => {
  reset();
  const t = 'alice-token';
  geminiScript = () => json(200, { candidates: [{ content: { parts: [{ text: '[{"type":"text","text":"Weekly summary: quiet week."}]' }] } }] });
  const task = await request('POST', '/v1/tasks', { token: t, body: { name: 'Weekly summary', prompt: 'Summarize last week', cron: 'Every Monday' } });
  assert.equal(task.status, 201);
  assert.equal(task.body.data.lastRunStatus, undefined);
  const run = await request('POST', `/v1/scheduled/${task.body.data.id}/run`, { token: t });
  assert.equal(run.body.success, true);
  assert.equal(run.body.data.lastRunStatus, 'completed');
  const convo = (await request('GET', `/v1/conversations/${run.body.conversationId}`, { token: t })).body.data;
  assert.match(convo.title, /^Weekly summary · /);
  assert.equal(convo.messages[1].blocks[0].text, 'Weekly summary: quiet week.');

  geminiScript = () => json(500, {});
  const failed = await request('POST', `/v1/tasks/${task.body.data.id}`, { token: t });
  assert.equal(failed.body.success, false);
  assert.equal(failed.body.data.lastRunStatus, 'failed');
  const off = await request('PATCH', `/v1/tasks/${task.body.data.id}`, { token: t, body: { enabled: false } });
  assert.equal(off.body.data.enabled, false);
  assert.equal((await request('DELETE', `/v1/tasks/${task.body.data.id}`, { token: t })).status, 200);
});

test('workspaces are the caller’s own account; data sources report honestly', async () => {
  const t = 'alice-token';
  const me = await request('GET', '/v1/workspaces/me', { token: t });
  assert.equal(me.body.data.id, USERS[t].id);
  assert.equal(me.body.data.legalName, 'Alice Co');
  assert.equal((await request('GET', `/v1/workspaces/${USERS['bob-token'].id}`, { token: t })).status, 404);
  assert.equal((await request('PATCH', '/v1/workspaces/me', { token: t, body: { currency: 'dollars' } })).status, 400);
  const saved = await request('PATCH', `/v1/workspaces/${USERS[t].id}`, { token: t, body: { currency: 'ETB', reserveMonths: 4, legalName: 'Alice Holdings' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.currency, 'ETB');
  assert.equal((await request('GET', '/v1/workspaces/current', { token: t })).body.data.legalName, 'Alice Holdings');

  const sources = await request('GET', '/v1/data-sources', { token: t });
  assert.ok(sources.body.data.every((s) => s.status === 'disconnected'));
  const sync = await request('POST', '/v1/data-sources/qb/sync', { token: t });
  assert.equal(sync.status, 501);
  assert.equal(sync.body.error.code, 'not_implemented');
  assert.equal((await request('POST', '/v1/data-sources/nope', { token: t })).status, 404);
});

test('unexpected errors never leak internals; database outages answer 503', async () => {
  const saved = global.fetch;
  global.fetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (url.includes('/rest/v1/')) return json(500, { code: 'XX000', message: 'connection to 10.0.0.5 failed, password=hunter2' });
    return saved(input, init);
  };
  try {
    const r = await request('GET', '/v1/goals', { token: 'alice-token' });
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'unavailable');
    assert.doesNotMatch(r.text, /hunter2|10\.0\.0\.5/);
  } finally {
    global.fetch = saved;
  }
});

test('calculator and answer parsing are safe', () => {
  assert.equal(calculate('$1,200 / (3 + 1)'), 300);
  assert.equal(calculate('10%*50'), 5);
  for (const evil of ['process.exit(1)', '1;2', 'constructor', '2**3']) assert.throws(() => calculate(evil));
  const blocks = parseAnswer('Summary here.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n## Recommendations\n- Cut spend\n- Raise prices');
  assert.deepEqual(blocks.map((b) => b.type), ['text', 'table', 'recommendation']);
  assert.match(blocksToMarkdown(blocks), /- Cut spend/);
});
