/** Exact origins only. Preview handoffs must be explicitly configured. */
export function trustedHandoffOrigin(origin: string | null, ownOrigin: string): boolean {
  if (!origin) return false;
  const origins = [ownOrigin, process.env.LANDING_URL || 'https://fremwork.com',
    ...(process.env.AUTH_HANDOFF_ORIGINS || '').split(',')].map((s) => s.trim()).filter(Boolean);
  return origins.includes(origin);
}

export function sameOriginRequest(origin: string | null, ownOrigin: string): boolean {
  return origin === ownOrigin;
}
