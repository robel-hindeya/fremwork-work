import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Retired. Other sites used to POST a user's Supabase tokens here to hand over a session. A page on
 * one domain auto-submitting credentials to another is what phishing kits do, and Google Safe Browsing
 * flagged this URL for it. Sessions are now only created on this site (password sign-in, or Google and
 * email links via /auth/callback). Anything posted here is ignored and the visitor is sent to sign in.
 */
export async function POST() {
  return new NextResponse(null, { status: 303, headers: { Location: "/sign-in", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
