import type { NextResponse } from "next/server";
import type { User } from "@/lib/data";

// The URL and publishable key are public by design; they only identify the Supabase project.
export const SUPABASE_URL = process.env.FREMWORK_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://gwdrtfcqqnvhwolbjkab.supabase.co";
export const SUPABASE_KEY = process.env.FREMWORK_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_jzmf0N9Uo3Q2ZYAfAIbWCg_xBzWttHY";

export const ACCESS_COOKIE = "fremwork_access";
export const REFRESH_COOKIE = "fremwork_refresh";


export type Session = { access_token: string; refresh_token: string; expires_in: number };

/** Calls the Supabase Auth API. */
export function authFetch(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  return fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    ...rest,
    cache: "no-store",
    signal: rest.signal || AbortSignal.timeout(10000),
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

/** Returns the user for a signed access token, or null if it is missing, forged or expired. */
export async function verifyAccessToken(token?: string): Promise<User | null> {
  if (typeof token !== "string" || !token || token.length > 16384) return null;
  try {
    // Supabase verifies signatures and revocation, supporting both legacy HS256 and JWKS projects.
    const response = await authFetch('/user', { token });
    if (!response.ok) return null;
    const payload = await response.json();
    if (typeof payload.id !== 'string' || !payload.email_confirmed_at) return null;
    const meta = payload.user_metadata ?? {};
    const email = String(payload.email ?? '');
    return { id: payload.id, email, name: meta.name || meta.full_name || email.split('@')[0], company: meta.company || '', role: 'member' };
  } catch {
    return null;
  }
}

export async function refreshSession(refreshToken?: string): Promise<Session | null> {
  if (typeof refreshToken !== "string" || !refreshToken || refreshToken.length > 16384) return null;
  try {
    const res = await authFetch("/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
    return res.ok ? ((await res.json()) as Session) : null;
  } catch {
    return null;
  }
}

const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export function setSessionCookies(res: NextResponse, session: Session) {
  res.cookies.set(ACCESS_COOKIE, session.access_token, { ...cookieOptions, maxAge: session.expires_in });
  res.cookies.set(REFRESH_COOKIE, session.refresh_token, { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
}

/** Supabase reports errors under a few different field names. */
export function authError(body: any, fallback: string): string {
  return body?.msg || body?.error_description || body?.message || fallback;
}
