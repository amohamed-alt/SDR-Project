import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/api/health"]);

function unauthorized(message = "Authentication required") {
  return new NextResponse(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Talentera SDR Dashboard", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) return NextResponse.next();
  if (process.env.DISABLE_AUTH === "true") return NextResponse.next();

  const expectedUsername = String(process.env.DASHBOARD_USERNAME || "").trim();
  const expectedPassword = String(process.env.DASHBOARD_PASSWORD || "");

  // Production is documented as Basic-Auth protected. Fail closed rather than
  // exposing HubSpot-backed dashboard/API data if the credentials are missing.
  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("Dashboard authentication is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return unauthorized();
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (username !== expectedUsername || password !== expectedPassword) return unauthorized("Invalid credentials");
    return NextResponse.next();
  } catch {
    return unauthorized("Invalid credentials");
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
