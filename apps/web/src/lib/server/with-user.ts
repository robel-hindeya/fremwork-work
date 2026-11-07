import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, verifyAccessToken } from "./auth";
import { userScope } from "./db";

/** Wraps a route handler so it only runs for a signed-in user, with that user's access to the database. */
export function authed<A extends unknown[]>(handler: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    const user = await verifyAccessToken(token);
    if (!user || !token) return NextResponse.json({ success: false, error: "Please sign in." }, { status: 401 });
    return userScope.run({ userId: user.id, token }, () => handler(...args));
  };
}
