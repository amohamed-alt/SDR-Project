import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { sdrAdminAuthorized } from "./sdr-admin-auth.ts";

const API_PREFIXES = ["/api/usage", "/api/acquisition", "/api/prospecting", "/api/lead-inventory", "/api/account-intelligence", "/api/best-accounts", "/api/target-account-pool", "/api/company-enrichment", "/api/maqsam", "/api/marita-priority", "/api/daniel-evalufy", "/api/daniel-transfer-plan", "/api/system-health", "/api/hubspot", "/api/ai", "/api/dashboard/sales-handoff"];
const PAGES = new Set(["/best-accounts", "/ai-sdr-agent", "/salesnav-prospecting", "/salesnav-full-run", "/signalhire-companion", "/signalhire-queue", "/lead-import", "/prospecting", "/system-health", "/marita-calls", "/account-intelligence", "/net-new-accounts", "/lead-inventory", "/company-enrichment"]);
export function normalizedToolPath(path: string) {
  try { return decodeURIComponent(path).replace(/\/$/, "") || "/"; } catch { return path; }
}
export function isProtectedToolApi(path: string, method: string) {
  path = normalizedToolPath(path);
  // Presence/event ingestion remains public; the user-level usage report does not.
  if (path === "/api/hubspot/task-countries") return false;
  if (path === "/api/usage") return method !== "POST";
  return API_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}
export function isProtectedToolPage(path: string, params: URLSearchParams) {
  path = normalizedToolPath(path);
  return PAGES.has(path) || (path === "/" && (Boolean(params.get("view") && params.get("view") !== "core") || params.get("studio") === "tools"));
}
function equalSecret(value: string | null, expected: string | undefined) {
  if (!value || !expected?.trim()) return false;
  const a = Buffer.from(value.trim()), b = Buffer.from(expected.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}
function machineRoute(request: NextRequest, path: string) {
  if (request.method === "POST" && path === "/api/maqsam/calls") {
    const secret = request.headers.get("x-maqsam-ingest-secret") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null;
    return [process.env.MAQSAM_INGEST_SECRET, process.env.HUBSPOT_PRIVATE_APP_TOKEN].some(expected => equalSecret(secret, expected));
  }
  if (request.method === "POST" && ["/api/acquisition/autorun", "/api/acquisition/bootstrap-once", "/api/acquisition/people-scan", "/api/acquisition/recovery-v2"].includes(path)) {
    return equalSecret(request.headers.get("x-acquisition-worker-key"), process.env.SIGNALHIRE_API_KEY);
  }
  // Only these handlers verify pairing tokens themselves before returning data.
  const salesCompanion = path === "/api/prospecting/salesnav/companion";
  const signalCompanion = path === "/api/prospecting/signalhire/companion";
  if ((salesCompanion || signalCompanion) && request.method === "OPTIONS") return true;
  return Boolean(/^Bearer\s+\S+/i.test(request.headers.get("authorization") || "") && ((salesCompanion && ["GET", "POST"].includes(request.method)) || (signalCompanion && request.method === "POST")));
}
export function toolAccessResponse(request: NextRequest) {
  const path = normalizedToolPath(request.nextUrl.pathname);
  const api = isProtectedToolApi(path, request.method);
  const page = isProtectedToolPage(path, request.nextUrl.searchParams);
  if (!api && !page) return null;
  if (sdrAdminAuthorized(request) || (api && machineRoute(request, path))) return null;
  const headers = { "Cache-Control": "private, no-store" };
  if (api) return Response.json({ error: "Unlock SDR tools to continue.", code: "TOOLS_LOCKED" }, { status: 401, headers });
  // Next's proxy adapter requires an absolute Location. Pin production to the
  // public host instead of the internal container URL supplied by Traefik.
  const requestHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || request.nextUrl.host;
  const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestHost);
  const origin = loopback ? `${request.nextUrl.protocol}//${requestHost}` : "https://sdr.dashboardtalentera.tech";
  const target = new URL("/tools-unlock", origin);
  target.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
  return new Response(null, { status: 307, headers: { ...headers, Location: target.href } });
}
