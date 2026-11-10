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

export function sameOriginRequest(origin: string | null, ownOrigin: string): boolean {
  return origin === ownOrigin;
}
