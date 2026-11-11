import { NextRequest, NextResponse } from "next/server";
import { authFetch } from "@/lib/server/auth";
import { publicOrigin } from "@/lib/server/origins";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ success: false, error: "Enter your email." }, { status: 400 });

  const redirect = encodeURIComponent(`${publicOrigin(req)}/auth/callback`);
  const res = await authFetch(`/recover?redirect_to=${redirect}`, { method: "POST", body: JSON.stringify({ email: email.trim().toLowerCase() }) });

  if (res.status === 429) {
    return NextResponse.json({ success: false, error: "Too many emails sent. Wait a few minutes and try again." }, { status: 429 });
  }
  // Same answer whether or not the account exists, so this can't be used to discover emails.
  return NextResponse.json({ success: true });
}
