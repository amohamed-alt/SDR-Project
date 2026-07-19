import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function proxy(request: NextRequest) {
  if (
    process.env.DISABLE_AUTH === "true"
    || request.nextUrl.pathname === "/api/health"
    || request.nextUrl.pathname === "/api/google/callback"
  ) return NextResponse.next();

  const expectedUsername = process.env.DASHBOARD_USERNAME;
  const expectedPassword = process.env.DASHBOARD_PASSWORD;
  if (!expectedUsername || !expectedPassword) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Dashboard authentication is not configured.", { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Basic ")) {
    try {
      const [username, password] = Buffer.from(authorization.slice(6), "base64").toString("utf8").split(":", 2);
      if (secureEqual(username ?? "", expectedUsername) && secureEqual(password ?? "", expectedPassword)) return NextResponse.next();
    } catch {
      // Fall through to authentication challenge.
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="SDR Command Center", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
