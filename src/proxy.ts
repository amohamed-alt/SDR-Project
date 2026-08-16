import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/api/health", "/api/google/callback"]);
const INTERNAL_POST_PATHS = new Set(["/api/hiring/refresh", "/api/career-intelligence/run"]);

function unauthorized(message = "Authentication required") {
  return new NextResponse(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Talentera SDR Dashboard", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

function isInternalWorkerRequest(request: NextRequest) {
  if (request.method !== "POST" || !INTERNAL_POST_PATHS.has(request.nextUrl.pathname)) return false;
  const host = (request.headers.get("host") || "").toLowerCase();
  return host === "sdr-dashboard:3000" || host === "sdr-dashboard";
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (pathname === "/api/maqsam/calls" && request.method === "POST") return NextResponse.next();
  if (isInternalWorkerRequest(request)) return NextResponse.next();

  // The SDR Dashboard is intentionally open by default. Basic Auth is opt-in only.
  // This prevents deployments with a temporarily unavailable runtime env from
  // unexpectedly showing a browser username/password prompt.
  if (process.env.DISABLE_AUTH !== "false") return NextResponse.next();

  const expectedUsername = String(process.env.DASHBOARD_USERNAME || "").trim();
  const expectedPassword = String(process.env.DASHBOARD_PASSWORD || "");

  if (!expectedUsername || !expectedPassword) {
    return new NextResponse("Dashboard authentication is enabled but credentials are not configured", {
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
    if (username !== expectedUsername || password !== expectedPassword) {
      return unauthorized("Invalid credentials");
    }
    return NextResponse.next();
  } catch {
    return unauthorized("Invalid credentials");
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
