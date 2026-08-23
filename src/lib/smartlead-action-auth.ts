import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { originMatchesRequestHosts } from "@/lib/request-origin";

const OWNER_PIN_SHA256 = "e0f05da93a0f5a86a3be5fc0e301606513c9f7e59dac2357348aa0f2f47db984";
const OWNER_PIN_WINDOW_MS = 10 * 60 * 1000;
const OWNER_PIN_MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function pinMatches(value: string) {
  return createHash("sha256").update(value).digest("hex") === OWNER_PIN_SHA256;
}

function rateKey(request: NextRequest) {
  return clean(
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0] ||
    request.headers.get("x-real-ip") ||
    "unknown",
    120,
  );
}

export function smartleadSameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  return originMatchesRequestHosts({
    origin: request.headers.get("origin"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    requestHost: request.nextUrl.host,
    extraHosts: ["sdr.dashboardtalentera.tech"],
  });
}

export function smartleadActionAuthorized(request: NextRequest) {
  // Server-to-server automation may authenticate with the existing Smartlead
  // secret. The browser never receives this value.
  const authorization = clean(request.headers.get("authorization"), 3_000);
  const serviceToken = authorization.toLowerCase().startsWith("bearer ") ? clean(authorization.slice(7), 2_000) : "";
  const smartleadSecret = clean(process.env.SMARTLEAD_API_KEY, 2_000);
  if (serviceToken && smartleadSecret && safeEqual(serviceToken, smartleadSecret)) return { ok: true as const, mode: "service" as const };

  const supplied = clean(request.headers.get("x-acquisition-owner-token"), 500);
  if (!supplied) return { ok: false as const, status: 401, error: "Owner PIN is required for this action." };

  const configured = clean(process.env.ACQUISITION_OWNER_TOKEN, 500);
  if (configured && safeEqual(supplied, configured)) return { ok: true as const, mode: "owner" as const };

  const key = rateKey(request);
  const now = Date.now();
  const state = attempts.get(key);
  if (state && state.resetAt > now && state.count >= OWNER_PIN_MAX_ATTEMPTS) {
    return { ok: false as const, status: 429, error: "Too many Owner PIN attempts. Try again in a few minutes." };
  }

  if (pinMatches(supplied)) {
    attempts.delete(key);
    return { ok: true as const, mode: "owner" as const };
  }

  attempts.set(key, {
    count: state && state.resetAt > now ? state.count + 1 : 1,
    resetAt: state && state.resetAt > now ? state.resetAt : now + OWNER_PIN_WINDOW_MS,
  });
  return { ok: false as const, status: 401, error: "Invalid Owner PIN." };
}

export function smartleadActionAuthConfigured() {
  // Owner PIN fallback is always available; ACQUISITION_OWNER_TOKEN remains an
  // optional override and SMARTLEAD_API_KEY supports trusted scheduled jobs.
  return true;
}
