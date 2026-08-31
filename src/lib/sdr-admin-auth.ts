import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const ADMIN_COOKIE = "sdr_admin_access";
const ADMIN_PURPOSE = "sdr-admin-access:v1";

function clean(value: unknown, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sdrAdminSecret() {
  return clean(process.env.DASHBOARD_PASSWORD || process.env.SDR_ADMIN_PASSWORD, 500);
}

export function sdrAdminConfigured() {
  return Boolean(sdrAdminSecret());
}

export function sdrAdminCookieName() {
  return ADMIN_COOKIE;
}

// Browser admin access is represented only by a signed HttpOnly cookie token.
export function sdrAdminCookieToken() {
  const secret = sdrAdminSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(ADMIN_PURPOSE).digest("hex");
}

export function validateSdrAdminPassword(password: string) {
  const configured = sdrAdminSecret();
  const supplied = clean(password, 500);
  return Boolean(configured && supplied && safeEqual(supplied, configured));
}

export function sdrAdminAuthorized(request: NextRequest) {
  const cookie = clean(request.cookies.get(ADMIN_COOKIE)?.value, 500);
  const expectedCookie = sdrAdminCookieToken();
  if (cookie && expectedCookie && safeEqual(cookie, expectedCookie)) return true;

  // Keep trusted automation calls working without exposing a browser key field.
  const suppliedAutomationToken = clean(request.headers.get("x-acquisition-owner-token"), 500);
  const configuredAutomationToken = clean(process.env.ACQUISITION_OWNER_TOKEN || sdrAdminSecret(), 500);
  return Boolean(
    suppliedAutomationToken
      && configuredAutomationToken
      && safeEqual(suppliedAutomationToken, configuredAutomationToken),
  );
}
