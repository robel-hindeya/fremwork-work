import { createHash, randomBytes } from "node:crypto";
import type { NextResponse } from "next/server";

/**
 * PKCE for Supabase Auth flows that leave this site (Google sign-in, confirmation and password-reset
 * emails). Supabase returns to /auth/callback with a one-time `?code`, which only this browser can
 * exchange because the matching verifier sits in an HttpOnly cookie here. No tokens ever travel in a
 * URL or between sites.
 */
export const PKCE_COOKIE = "fremwork_pkce";
export type PkcePurpose = "signin" | "signup" | "recovery";
const PURPOSES: PkcePurpose[] = ["signin", "signup", "recovery"];
const MAX_AGE = 60 * 60; // email links can take a while to arrive

const b64url = (buf: Buffer) => buf.toString("base64url");

export interface Pkce {
  /** Send these two to Supabase. */
  challenge: { code_challenge: string; code_challenge_method: "s256" };
  /** Store this on the response with `storePkce` once the request to Supabase succeeded. */
  cookie: string;
}

/** Starts a flow: a fresh verifier and the challenge derived from it. */
export function newPkce(purpose: PkcePurpose): Pkce {
  const verifier = b64url(randomBytes(48));
  return {
    challenge: { code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "s256" },
    cookie: `${purpose}.${verifier}`,
  };
}

export function storePkce(res: NextResponse, pkce: Pkce) {
  res.cookies.set(PKCE_COOKIE, pkce.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // sent on the top-level redirect back from Supabase/Google
    path: "/auth/callback",
    maxAge: MAX_AGE,
  });
}

/** Reads the stored verifier and what the flow was for, or null if missing or malformed. */
export function readPkce(cookie: string | undefined): { purpose: PkcePurpose; verifier: string } | null {
  const [purpose, verifier] = (cookie ?? "").split(".");
  if (!PURPOSES.includes(purpose as PkcePurpose) || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier ?? "")) return null;
  return { purpose: purpose as PkcePurpose, verifier };
}

export function clearPkce(res: NextResponse) {
  res.cookies.set(PKCE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/auth/callback", maxAge: 0 });
}
