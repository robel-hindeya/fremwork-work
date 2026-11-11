import { publicOrigin, sameOriginRequest } from "@/lib/server/origins";
import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, REFRESH_COOKIE, refreshSession, setSessionCookies, verifyAccessToken } from "@/lib/server/auth";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/auth/callback", "/api/health"];
const isPublic = (path: string) => path.startsWith("/api/auth/") || PUBLIC_PATHS.includes(path);

/** Keeps sessions fresh and sends anyone who isn't signed in to the sign-in page. */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && pathname !== '/api/auth/session'
    && !sameOriginRequest(req.headers.get('origin'), publicOrigin(req))) {
    return NextResponse.json({ success: false, error: 'Untrusted request origin.' }, { status: 403 });
  }
  // A cross-site handoff must reach its handler before existing sessions are refreshed.
  if (pathname === '/api/auth/session') return NextResponse.next();

  if (await verifyAccessToken(req.cookies.get(ACCESS_COOKIE)?.value)) return NextResponse.next();

  const session = await refreshSession(req.cookies.get(REFRESH_COOKIE)?.value);
  if (session) {
    req.cookies.set(ACCESS_COOKIE, session.access_token);
    req.cookies.set(REFRESH_COOKIE, session.refresh_token);
    const headers = new Headers(req.headers);
    headers.set("cookie", req.cookies.toString());
    const res = NextResponse.next({ request: { headers } });
    setSessionCookies(res, session);
    return res;
  }

  if (isPublic(pathname)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ success: false, error: "Please sign in." }, { status: 401 });
  return NextResponse.redirect(new URL("/sign-in", publicOrigin(req)));
}

export const config = {
  matcher: ["/((?!_next/|brand/|icon.svg|favicon.ico).*)"],
};
