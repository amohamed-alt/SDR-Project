import assert from "node:assert/strict";
import test from "node:test";
import { dashboardAuthConfig, parseBasicAuthorization } from "../src/lib/dashboard-auth.ts";

test("dashboard auth prefers its own password and supports owner-token migration", () => {
  assert.deepEqual(dashboardAuthConfig({ DASHBOARD_USERNAME: "ops", DASHBOARD_PASSWORD: "secret", ACQUISITION_OWNER_TOKEN: "owner" }), {
    mode: "basic", username: "ops", password: "secret",
  });
  assert.deepEqual(dashboardAuthConfig({ ACQUISITION_OWNER_TOKEN: "owner" }), {
    mode: "basic", username: "talentera", password: "owner",
  });
});

test("dashboard auth fails closed when production credentials are absent", () => {
  assert.equal(dashboardAuthConfig({}).mode, "missing");
  assert.equal(dashboardAuthConfig({ DISABLE_AUTH: "true" }).mode, "disabled");
});

test("basic auth parser preserves colons in passwords", () => {
  const value = Buffer.from("ops:one:two").toString("base64");
  assert.deepEqual(parseBasicAuthorization(`Basic ${value}`), { username: "ops", password: "one:two" });
});
