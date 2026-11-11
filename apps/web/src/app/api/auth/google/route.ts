import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_URL } from "@/lib/server/auth";
import { publicOrigin } from "@/lib/server/origins";
import { newPkce, storePkce } from "@/lib/server/pkce";

export const runtime = "nodejs";

/** Starts "Continue with Google": Supabase → Google → Supabase → this site's /auth/callback?code=… */
export async function GET(req: NextRequest) {
  const res = new NextResponse(null, { status: 303 });
  const pkce = newPkce("signin");
  storePkce(res, pkce);
  const { code_challenge, code_challenge_method } = pkce.challenge;
  const url = new URL(`${SUPABASE_URL}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", `${publicOrigin(req)}/auth/callback`);
  url.searchParams.set("code_challenge", code_challenge);
  url.searchParams.set("code_challenge_method", code_challenge_method);
  res.headers.set("Location", url.toString());
  res.headers.set("Cache-Control", "no-store");
  return res;
}
