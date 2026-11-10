import { NextRequest, NextResponse } from "next/server";
import { refreshSession, setSessionCookies, verifyAccessToken } from "@/lib/server/auth";
import { trustedHandoffOrigin } from "@/lib/server/origins";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!trustedHandoffOrigin(req.headers.get('origin'), req.nextUrl.origin)) {
    return NextResponse.json({ success: false, error: 'Untrusted sign-in origin.' }, { status: 403 });
  }
  try {
    const form = await req.formData();
    const access = form.get('access_token');
    const refresh = form.get('refresh_token');
    if (typeof access !== 'string' || typeof refresh !== 'string') throw new Error('Missing session');
    const user = await verifyAccessToken(access);
    if (!user) throw new Error('Invalid session');
    const session = await refreshSession(refresh);
    const refreshedUser = session && await verifyAccessToken(session.access_token);
    if (!session || refreshedUser?.id !== user.id) throw new Error('Invalid session pair');
    // Relative Location: behind Render's proxy req.url is the internal https://localhost:10000.
    const response = new NextResponse(null, { status: 303, headers: { Location: '/chat' } });
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    setSessionCookies(response, session);
    return response;
  } catch {
    return new NextResponse(null, { status: 303, headers: { Location: '/sign-in?error=session_expired', 'Cache-Control': 'no-store' } });
  }
}
