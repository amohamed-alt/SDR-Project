import assert from "node:assert/strict";
import test from "node:test";
import { originMatchesRequestHosts } from "../src/lib/request-origin.ts";

test("accepts the public origin when Next.js is behind a reverse proxy", () => {
  const allowed = originMatchesRequestHosts({
    origin: "https://sdr.dashboardtalentera.tech",
    forwardedHost: "sdr.dashboardtalentera.tech",
    host: "dashboard:3000",
    requestHost: "dashboard:3000",
  });
  assert.equal(allowed, true);
});

test("accepts a direct same-host request", () => {
  const allowed = originMatchesRequestHosts({
    origin: "http://localhost:3000",
    host: "localhost:3000",
    requestHost: "localhost:3000",
  });
  assert.equal(allowed, true);
});

test("rejects an unrelated browser origin", () => {
  const allowed = originMatchesRequestHosts({
    origin: "https://evil.example",
    forwardedHost: "sdr.dashboardtalentera.tech",
    host: "dashboard:3000",
    requestHost: "dashboard:3000",
  });
  assert.equal(allowed, false);
});

test("uses the first forwarded host in a proxy chain", () => {
  const allowed = originMatchesRequestHosts({
    origin: "https://sdr.dashboardtalentera.tech",
    forwardedHost: "sdr.dashboardtalentera.tech, internal-proxy:443",
    requestHost: "dashboard:3000",
  });
  assert.equal(allowed, true);
});

test("allows requests without an Origin header", () => {
  assert.equal(originMatchesRequestHosts({ requestHost: "dashboard:3000" }), true);
});
