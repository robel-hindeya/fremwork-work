import { NextRequest, NextResponse } from "next/server";
import { authFetch, setSessionCookies, verifyAccessToken, type Session } from "@/lib/server/auth";
import { clearPkce, PKCE_COOKIE, readPkce } from "@/lib/server/pkce";

export const runtime = "nodejs";

/** Relative redirects keep users on the host they came from (behind Render's proxy too). */
function redirect(path: string) {
  const res = new NextResponse(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  clearPkce(res);
  return res;
}

/**
 * Where Supabase sends users back after Google sign-in or an email link. It exchanges the one-time
 * `code` for a session with the verifier this browser stored when the flow started, sets the session
 * cookies, and continues to the app (or to choosing a new password after a reset link).
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.get("error")) return redirect("/sign-in?error=provider");

  const code = params.get("code");
  if (!code) {
    // Old-style links carry tokens in the URL fragment, which servers never see. Leave the fragment
    // behind with a client-side replace, then sign in normally (the email is already confirmed).
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Fremwork</title><script>location.replace("/sign-in?notice=confirmed")</script><noscript><a href="/sign-in">Continue to sign in</a></noscript>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
    );
  }

  const pkce = readPkce(req.cookies.get(PKCE_COOKIE)?.value);
  if (!pkce || code.length > 512) return redirect("/sign-in?error=expired");

  const res = await authFetch("/token?grant_type=pkce", {
    method: "POST",
    body: JSON.stringify({ auth_code: code, code_verifier: pkce.verifier }),
  }).catch(() => null);
  const session = res?.ok ? ((await res.json()) as Session) : null;
  if (!session?.access_token || !(await verifyAccessToken(session.access_token))) return redirect("/sign-in?error=expired");

  const out = redirect(pkce.purpose === "recovery" ? "/reset-password" : "/chat");
  setSessionCookies(out, session);
  return out;
}
