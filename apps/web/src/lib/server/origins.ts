/** Fremwork landing sites that may hand a signed-in session to this workspace. Exact origins only. */
const LANDING_ORIGINS = ['https://www.fremwork.com', 'https://fremwork.com', 'https://fremwork-land.onrender.com'];

const clean = (origin: string) => origin.trim().replace(/\/+$/, '');

/** Exact origins only. Preview or extra handoffs must be explicitly configured in AUTH_HANDOFF_ORIGINS. */
export function trustedHandoffOrigin(origin: string | null, ownOrigin: string): boolean {
  if (!origin) return false;
  const origins = [ownOrigin, ...LANDING_ORIGINS, process.env.LANDING_URL || '',
    ...(process.env.AUTH_HANDOFF_ORIGINS || '').split(',')].map(clean).filter(Boolean);
  return origins.includes(origin);
}

const first = (value: string | null) => value?.split(',')[0]?.trim().toLowerCase() || '';
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/;

/**
 * The origin the browser used to reach this app. Behind a reverse proxy (Render, Docker) `next start`
 * sees its own listen address (e.g. http://localhost:10000) as `req.nextUrl.origin`, so the public
 * host comes from the forwarded headers the proxy sets. Falls back to `nextUrl.origin` when absent.
 */
export function publicOrigin(req: { headers: Headers; nextUrl: URL }): string {
  const host = first(req.headers.get('x-forwarded-host')) || first(req.headers.get('host'));
  if (!HOST.test(host)) return req.nextUrl.origin;
  const proto = first(req.headers.get('x-forwarded-proto')) || req.nextUrl.protocol.replace(':', '');
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

export function sameOriginRequest(origin: string | null, ownOrigin: string): boolean {
  return origin === ownOrigin;
}
