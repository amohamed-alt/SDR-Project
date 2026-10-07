import test from "node:test";
import assert from "node:assert/strict";
import { toolAccessResponse, isProtectedToolPage } from "../src/lib/tool-access.ts";
import { sdrAdminCookieToken, validateSdrAdminPassword } from "../src/lib/sdr-admin-auth.ts";
const request = (path, method = "GET", headers = {}, cookie = "") => ({ nextUrl: new URL(path, "https://sdr.dashboardtalentera.tech"), method, headers: new Headers(headers), cookies: { get: () => ({ value: cookie }) } });
test("tool reads and mutations fail closed while public dashboard and tracking remain available", () => {
  for (const path of ["/api/usage", "/api/%75sage", "/api/maqsam/calls", "/api/acquisition", "/api/lead-inventory/engine", "/api/prospecting/signalhire/companion", "/api/company-enrichment", "/api/dashboard/sales-handoff"]) {
    assert.equal(toolAccessResponse(request(path))?.status, 401, path);
    assert.equal(toolAccessResponse(request(path, "GET", { "authorization": "Bearer fake", "x-acquisition-owner-token": "fake", "x-acquisition-worker-key": "fake" }))?.status, 401, path);
  }
  for (const path of ["/api/health", "/api/dashboard", "/api/dashboard/insights", "/api/dashboard/team", "/api/sdr-admin", "/api/hubspot/task-countries"]) assert.equal(toolAccessResponse(request(path)), null);
  assert.equal(toolAccessResponse(request("/api/usage", "POST")), null);
  assert.equal(toolAccessResponse(request("/api/company-enrichment", "POST"))?.status, 401);
});
test("direct tool URLs redirect before rendering and retain filters without trusting forwarded origins", () => {
  const path = "/?view=team-activity&from=2026-07-15&to=2026-10-07";
  const response = toolAccessResponse(request(path));
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("Location"), `/tools-unlock?returnTo=${encodeURIComponent(path)}`);
  for (const path of ["/lead-inventory", "/system-health", "/salesnav-prospecting", "/company-enrichment"]) assert.equal(toolAccessResponse(request(path))?.status, 307);
  assert.equal(isProtectedToolPage("/", new URLSearchParams("acq=intelligence&studio=tools")), true);
  assert.equal(isProtectedToolPage("/", new URLSearchParams("acq=marita")), false);
});
test("server cookie and verified machine secrets unlock only intended paths", () => {
  process.env.SDR_ADMIN_PASSWORD = "test-only-admin";
  process.env.DASHBOARD_PASSWORD = "different-dashboard-password";
  process.env.MAQSAM_INGEST_SECRET = "test-only-ingest";
  process.env.SIGNALHIRE_API_KEY = "test-only-worker";
  try {
    assert.equal(validateSdrAdminPassword("test-only-admin"), true);
    assert.equal(validateSdrAdminPassword("different-dashboard-password"), false);
    assert.equal(toolAccessResponse(request("/api/usage", "GET", {}, sdrAdminCookieToken())), null);
    assert.equal(toolAccessResponse(request("/api/usage", "GET", {}, "forged"))?.status, 401);
    assert.equal(toolAccessResponse(request("/api/maqsam/calls", "POST", { "x-maqsam-ingest-secret": "test-only-ingest" })), null);
    assert.equal(toolAccessResponse(request("/api/maqsam/calls", "GET", { "x-maqsam-ingest-secret": "test-only-ingest" }))?.status, 401);
    assert.equal(toolAccessResponse(request("/api/acquisition/autorun", "POST", { "x-acquisition-worker-key": "test-only-worker" })), null);
    assert.equal(toolAccessResponse(request("/api/usage", "GET", { "x-acquisition-worker-key": "test-only-worker" }))?.status, 401);
  } finally {
    for (const key of ["SDR_ADMIN_PASSWORD", "DASHBOARD_PASSWORD", "MAQSAM_INGEST_SECRET", "SIGNALHIRE_API_KEY"]) delete process.env[key];
  }
});
