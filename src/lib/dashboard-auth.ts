import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export type DashboardAuthConfig = {
  mode: "basic" | "disabled" | "missing";
  username: string;
  password: string;
};

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function dashboardAuthConfig(env: NodeJS.ProcessEnv = process.env): DashboardAuthConfig {
  if (clean(env.DISABLE_AUTH, 20).toLowerCase() === "true") {
    return { mode: "disabled", username: "", password: "" };
  }

  const username = clean(env.DASHBOARD_USERNAME, 200) || "talentera";
  const password = clean(env.DASHBOARD_PASSWORD, 1_000) || clean(env.ACQUISITION_OWNER_TOKEN, 1_000);
  return password
    ? { mode: "basic", username, password }
    : { mode: "missing", username, password: "" };
}

export function parseBasicAuthorization(value: string | null) {
  if (!value?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(value.slice(6).trim(), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

function normalizedHost(value: string | null) {
  return clean(value?.split(",")[0], 500).toLowerCase().replace(/:\d+$/, "");
}

function internalRequest(request: NextRequest) {
  // Do not use request.nextUrl here: behind Traefik it can contain the internal
  // container hostname even when the original request is public. The proxy's
  // forwarded Host preserves the public hostname and prevents an auth bypass.
  const host = normalizedHost(request.headers.get("x-forwarded-host"))
    || normalizedHost(request.headers.get("host"));
  return host === "sdr-dashboard" || host === "127.0.0.1" || host === "localhost";
}

function trustedMachineRoute(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const authorization = request.headers.get("authorization") || "";

  if (/^Bearer\s+\S+/i.test(authorization)) {
    return [
      "/api/smartlead/autopilot",
      "/api/smartlead/campaign-parity",
      "/api/smartlead/orchestrator",
      "/api/smartlead/orchestrator-compat",
      "/api/smartlead/orchestrator-v3",
      "/api/smartlead/sender-reconcile",
    ].includes(path)
      || path === "/api/maqsam/calls"
      || path === "/api/prospecting/salesnav/companion";
  }

  if (request.headers.get("x-maqsam-ingest-secret")) {
    return request.method === "POST" && path === "/api/maqsam/calls";
  }

  if (request.headers.get("x-acquisition-worker-key")) {
    return request.method === "POST" && [
      "/api/acquisition/autorun",
      "/api/acquisition/bootstrap-once",
      "/api/acquisition/people-scan",
      "/api/acquisition/recovery-v2",
    ].includes(path);
  }

  if (request.headers.get("x-acquisition-owner-token")) {
    return request.method === "POST" && (path === "/api/acquisition" || path === "/api/prospecting/push");
  }

  return false;
}

export function dashboardAuthResponse(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/health" || internalRequest(request) || trustedMachineRoute(request)) return null;

  const config = dashboardAuthConfig();
  if (config.mode === "disabled") return null;
  if (config.mode === "missing") {
    if (process.env.NODE_ENV !== "production") return null;
    return Response.json(
      { error: "Dashboard authentication is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const supplied = parseBasicAuthorization(request.headers.get("authorization"));
  if (supplied && safeEqual(supplied.username, config.username) && safeEqual(supplied.password, config.password)) return null;

  return new Response("Authentication required", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Talentera SDR", charset="UTF-8"',
    },
  });
}
