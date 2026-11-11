import { NextRequest, NextResponse } from "next/server";
import { authError, authFetch, setSessionCookies, verifyAccessToken } from "@/lib/server/auth";
import { publicOrigin } from "@/lib/server/origins";

export const runtime = "nodejs";

const EXISTS = "An account with that email already exists. Sign in instead.";

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, company } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ success: false, error: "Please enter your email and password." }, { status: 400 });
    }

    const redirect = encodeURIComponent(`${publicOrigin(req)}/auth/callback`);
    const res = await authFetch(`/signup?redirect_to=${redirect}`, {
      method: "POST",
      body: JSON.stringify({ email: email.trim().toLowerCase(), password, data: { name, company } }),
    });
    const body = await res.json();

    if (!res.ok) {
      const error = body?.error_code === "user_already_exists" ? EXISTS : res.status === 429 ? "Too many sign-ups right now, so we couldn't send your confirmation email. Wait a while and try again." : authError(body, "We couldn't create your account. Try again.");
      return NextResponse.json({ success: false, error }, { status: res.status });
    }

    // With email confirmation on, Supabase hides duplicates by returning a user with no identities.
    if (!body.access_token && Array.isArray(body.identities) && body.identities.length === 0) {
      return NextResponse.json({ success: false, error: EXISTS }, { status: 409 });
    }

    if (!body.access_token) {
      return NextResponse.json({ success: true, needsConfirmation: true }, { status: 201 });
    }

    const response = NextResponse.json({ success: true, user: await verifyAccessToken(body.access_token) }, { status: 201 });
    setSessionCookies(response, body);
    return response;
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
