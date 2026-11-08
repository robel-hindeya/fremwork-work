import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Same responses as the NestJS API, served straight from Supabase.
 * Used only when the API can't be reached. Admin writes are protected by
 * row-level security (owners/admins only); public actions use narrow DB functions.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (m: RegExpMatchArray, body: any, q: URLSearchParams) => Promise<unknown>;

const db = () => getSupabaseBrowserClient();
const must = (r: { data: any; error: { message: string } | null }): any => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\n');

const toEvent = (e: any) => ({
  id: e.id, type: e.type, title: e.title, description: e.description, length: e.length_label,
  whenLabel: e.when_label, startsAt: e.starts_at, location: e.location, capacity: e.capacity, published: e.published,
  registrations: e.event_registrations?.[0]?.count ?? 0,
});
const toEntry = (r: any) => ({ id: r.id, name: r.name, email: r.email, company: r.company, role: r.role, status: r.status, createdAt: r.created_at });
const toReg = (r: any) => ({
  id: r.id, eventId: r.event_id, name: r.name, email: r.email, company: r.company, role: r.role,
  companySize: r.company_size, heardFrom: r.heard_from, checkedIn: r.checked_in, createdAt: r.created_at,
});
const toVisitor = (r: any) => ({
  id: r.id, name: r.name, email: r.email, ip: r.ip, userAgent: r.user_agent, referrer: r.referrer, firstPath: r.first_path, lastPath: r.last_path,
  visits: r.visits, firstSeen: r.first_seen, lastSeen: r.last_seen,
  country: r.country, region: r.region, city: r.city, source: r.source,
});
const toSettings = (s: any) => ({
  acceptSignups: s.accept_signups, welcomeEmail: s.welcome_email, askCompany: s.ask_company, alertInstant: s.alert_instant,
  alertDigest: s.alert_digest, notifyEmail: s.notify_email, requiredFields: { ...s.required_fields, name: true, email: true },
});
const nameFromEmail = (em: string) => em.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

async function waitlist() {
  return must(await db().from('waitlist_entries').select('*').order('created_at', { ascending: false })).map(toEntry);
}
async function registrations(eventId?: string | null, q?: string | null) {
  let query = db().from('event_registrations').select('*').order('created_at', { ascending: false });
  if (eventId && eventId !== 'all') query = query.eq('event_id', eventId);
  const rows = must(await query).map(toReg);
  const n = (q ?? '').toLowerCase();
  return n ? rows.filter((r: any) => `${r.name} ${r.email} ${r.company ?? ''}`.toLowerCase().includes(n)) : rows;
}
async function events() {
  return must(await db().from('events').select('*, event_registrations(count)').order('sort_order').order('created_at', { ascending: false })).map(toEvent);
}

const routes: [string, RegExp, Handler][] = [
  // ---- Public ----
  ['GET', /^\/settings\/public$/, async () => must(await db().rpc('public_settings'))],
  ['GET', /^\/events$/, async () => must(await db().rpc('published_events'))],
  ['POST', /^\/waitlist$/, async (_m, b) => must(await db().rpc('join_waitlist', { p_name: b.name, p_email: b.email, p_company: b.company ?? null, p_role: b.role }))],
  ['POST', /^\/events\/([^/]+)\/registrations$/, async (m, b) => must(await db().rpc('register_for_event', { p_event_id: m[1], p_answers: b }))],
  ['DELETE', /^\/registrations\/(\d+)$/, async (m, _b, q) => must(await db().rpc('cancel_registration', { p_id: Number(m[1]), p_token: q.get('token') }))],

  // ---- Signed in ----
  ['GET', /^\/me$/, async () => {
    const { data } = await db().auth.getUser();
    if (!data.user) throw new Error('Log in to continue.');
    const p = must(await db().from('profiles').select('full_name, role').eq('id', data.user.id).maybeSingle()) as any;
    const role = p?.role ?? 'member';
    return { id: data.user.id, email: data.user.email, name: p?.full_name || data.user.user_metadata?.full_name || '', role, isAdmin: role === 'owner' || role === 'admin' };
  }],

  // ---- Admin ----
  ['GET', /^\/admin\/overview$/, async () => {
    const since = new Date(Date.now() - 56 * 864e5).toISOString();
    const [s, wl, regs, inv] = await Promise.all([
      db().from('waitlist_entries').select('created_at').gte('created_at', since),
      db().from('waitlist_entries').select('name, company, created_at').order('created_at', { ascending: false }).limit(5),
      db().from('event_registrations').select('name, created_at, events(title)').order('created_at', { ascending: false }).limit(5),
      db().from('waitlist_entries').select('name, invited_at').not('invited_at', 'is', null).order('invited_at', { ascending: false }).limit(5),
    ]);
    const weeks = Array(8).fill(0);
    for (const r of must(s) as any[]) {
      const ago = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (7 * 864e5));
      if (ago >= 0 && ago < 8) weeks[7 - ago]++;
    }
    const activity = [
      ...(must(wl) as any[]).map((r) => ({ kind: 'waitlist', at: r.created_at, text: `${r.name} joined the waitlist${r.company ? ` from ${r.company}` : ''}.` })),
      ...(must(regs) as any[]).map((r) => ({ kind: 'registration', at: r.created_at, text: `${r.name} registered for ${r.events?.title ?? 'an event'}.` })),
      ...(must(inv) as any[]).map((r) => ({ kind: 'invite', at: r.invited_at, text: `${r.name} was invited.` })),
    ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
    return { weeks, activity };
  }],
  ['GET', /^\/admin\/waitlist$/, async () => waitlist()],
  ['POST', /^\/admin\/waitlist\/invite$/, async (_m, b) => {
    const before = must(await db().from('waitlist_entries').select('id, status').in('id', b.ids)) as any[];
    const invited = before.filter((r) => r.status === 'waiting').length;
    const ids = before.filter((r) => r.status !== 'active').map((r) => r.id);
    if (ids.length) must(await db().from('waitlist_entries').update({ status: 'invited', invited_at: new Date().toISOString() }).in('id', ids));
    const entries = must(await db().from('waitlist_entries').select('*').in('id', b.ids)).map(toEntry);
    return { invited, entries };
  }],
  ['GET', /^\/admin\/waitlist\/export$/, async (_m, _b, q) => {
    const status = q.get('status'), n = (q.get('q') ?? '').toLowerCase();
    const rows = (await waitlist()).filter((r: any) => (!status || status === 'All' || r.status === status.toLowerCase())
      && (!n || `${r.name} ${r.email} ${r.company ?? ''} ${r.role ?? ''}`.toLowerCase().includes(n)));
    return toCsv([['Name', 'Email', 'Company', 'Role', 'Joined', 'Status'], ...rows.map((r: any) => [r.name, r.email, r.company, r.role, r.createdAt.slice(0, 10), r.status])]);
  }],
  ['GET', /^\/admin\/events$/, async () => events()],
  ['POST', /^\/admin\/events$/, async (_m, b) => toEvent(must(await db().from('events').insert({
    title: String(b.title).trim(), type: b.type, description: b.description ?? '', length_label: b.length ?? '60 min',
    starts_at: b.startsAt ?? null, when_label: b.startsAt ? null : '[DATE] · [TIME]',
    location: b.location || 'Online', capacity: b.capacity ?? 100, published: false,
  }).select('*, event_registrations(count)').single()))],
  ['PATCH', /^\/admin\/events\/([^/]+)$/, async (m, b) => {
    const patch: Record<string, unknown> = {};
    if (b.published !== undefined) patch.published = b.published;
    if (b.title !== undefined) patch.title = b.title;
    if (b.type !== undefined) patch.type = b.type;
    if (b.description !== undefined) patch.description = b.description;
    if (b.length !== undefined) patch.length_label = b.length || '60 min';
    if (b.startsAt !== undefined) { patch.starts_at = b.startsAt; patch.when_label = null; }
    if (b.location !== undefined) patch.location = b.location;
    if (b.capacity !== undefined) patch.capacity = b.capacity;
    return toEvent(must(await db().from('events').update(patch).eq('id', m[1]).select('*, event_registrations(count)').single()));
  }],
  ['DELETE', /^\/admin\/events\/([^/]+)$/, async (m) => {
    must(await db().from('events').delete().eq('id', m[1]));
    return { ok: true };
  }],
  ['GET', /^\/admin\/registrations$/, async (_m, _b, q) => registrations(q.get('eventId'), q.get('q'))],
  ['GET', /^\/admin\/registrations\/export$/, async (_m, _b, q) => {
    const [regs, evs] = await Promise.all([registrations(q.get('eventId'), q.get('q')), events()]);
    const title = Object.fromEntries(evs.map((e: any) => [e.id, e.title]));
    return toCsv([['Name', 'Email', 'Company', 'Role', 'Company size', 'Heard from', 'Event', 'Checked in'],
      ...regs.map((r: any) => [r.name, r.email, r.company, r.role, r.companySize, r.heardFrom, title[r.eventId], r.checkedIn ? 'Yes' : 'No'])]);
  }],
  ['PATCH', /^\/admin\/registrations\/(\d+)$/, async (m, b) => toReg(must(await db().from('event_registrations').update({ checked_in: b.checkedIn }).eq('id', Number(m[1])).select('*').single()))],
  ['GET', /^\/admin\/visitors$/, async () => must(await db().from('site_visitors').select('*').eq('is_team', false).order('last_seen', { ascending: false }).limit(2000)).map(toVisitor)],
  ['GET', /^\/admin\/settings$/, async () => toSettings(must(await db().from('app_settings').select('*').eq('id', 1).single()))],
  ['PUT', /^\/admin\/settings$/, async (_m, b) => {
    const keys = ['name', 'email', 'company', 'role', 'size', 'heard'];
    const patch = {
      accept_signups: b.acceptSignups, welcome_email: b.welcomeEmail, ask_company: b.askCompany,
      alert_instant: b.alertInstant, alert_digest: b.alertDigest, notify_email: b.notifyEmail ?? '',
      required_fields: Object.fromEntries(keys.map((k) => [k, k === 'name' || k === 'email' ? true : !!b.requiredFields?.[k]])),
      updated_at: new Date().toISOString(),
    };
    return toSettings(must(await db().from('app_settings').update(patch).eq('id', 1).select('*').single()));
  }],
  ['GET', /^\/admin\/team$/, async () => {
    const admins = must(await db().from('profiles').select('email, full_name, role').in('role', ['owner', 'admin'])) as any[];
    const invites = must(await db().from('team_invites').select('email').is('accepted_at', null)) as any[];
    const have = new Set(admins.map((a) => a.email.toLowerCase()));
    return [
      ...admins.sort((a) => (a.role === 'owner' ? -1 : 1)).map((a) => ({ name: a.full_name || nameFromEmail(a.email), email: a.email, role: a.role })),
      ...invites.filter((i) => !have.has(i.email.toLowerCase())).map((i) => ({ name: nameFromEmail(i.email), email: i.email, role: 'invited' })),
    ];
  }],
  ['POST', /^\/admin\/team\/invite$/, async (_m, b) => {
    const em = String(b.email).trim();
    const { error } = await db().from('team_invites').insert({ email: em, role: 'admin' });
    if (error && error.code !== '23505') throw new Error(error.message);
    return { name: nameFromEmail(em), email: em, role: 'invited' };
  }],
];

export async function direct<T>(method: string, path: string, body: unknown): Promise<T> {
  const [p, qs] = path.split('?');
  for (const [m, re, h] of routes) {
    const match = m === method && p.match(re);
    if (match) return (await h(match, body, new URLSearchParams(qs))) as T;
  }
  throw new Error('We could not reach Fremwork right now. Try again in a minute.');
}
