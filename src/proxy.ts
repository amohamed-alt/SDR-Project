import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/api/health", "/api/google/callback"]);
const INTERNAL_POST_PATHS = new Set(["/api/hiring/refresh", "/api/career-intelligence/run"]);

// Emergency production fallback for environments where the documented Basic Auth
// variables were never provisioned. Only the SHA-256 digest is committed; the
// corresponding high-entropy password is not stored in the repository.
const FALLBACK_USERNAME = "abdullah";
const FALLBACK_PASSWORD_SHA256 = "0b6aa9ed6c71f6f72140df72b4c1a4a20b738ce68b19f2d6eb33de6e3c035148";

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
  // These names are reachable only inside Docker. Public Traefik routing requires
  // sdr.dashboardtalentera.tech and the dashboard port is loopback-bound on the VPS.
  return host === "sdr-dashboard:3000" || host === "sdr-dashboard";
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // Health is public for deploy verification. Google callback is protected by
  // its state cookie, and Maqsam POST has its own timing-safe ingest secret.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (pathname === "/api/maqsam/calls" && request.method === "POST") return NextResponse.next();
  if (isInternalWorkerRequest(request)) return NextResponse.next();
  if (process.env.DISABLE_AUTH === "true") return NextResponse.next();

  const configuredUsername = String(process.env.DASHBOARD_USERNAME || "").trim();
  const configuredPassword = String(process.env.DASHBOARD_PASSWORD || "");
  const expectedUsername = configuredUsername || FALLBACK_USERNAME;
  const expectedPasswordHash = configuredPassword
    ? await sha256Hex(configuredPassword)
    : FALLBACK_PASSWORD_SHA256;

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Basic ")) return unauthorized();

  try {
    const decoded = atob(authorization.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return unauthorized();
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    const suppliedHash = await sha256Hex(password);
    if (username !== expectedUsername || !constantTimeEqual(suppliedHash, expectedPasswordHash)) {
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
