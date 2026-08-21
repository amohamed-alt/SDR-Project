import assert from "node:assert/strict";
import test from "node:test";
import { dashboardCacheKey } from "../src/lib/dashboard-cache-api.ts";

const base = {
  from: "2026-07-01",
  to: "2026-08-21",
  ownerId: "31644369",
};

test("dashboard cache keys are deterministic for identical filters", () => {
  assert.equal(dashboardCacheKey(base), dashboardCacheKey({ ...base }));
  assert.match(dashboardCacheKey(base), /^[a-f0-9]{64}$/);
});

test("dashboard cache keys isolate owners and filter combinations", () => {
  assert.notEqual(dashboardCacheKey(base), dashboardCacheKey({ ...base, ownerId: "31558980" }));
  assert.notEqual(dashboardCacheKey(base), dashboardCacheKey({ ...base, country: "Saudi Arabia" }));
  assert.notEqual(dashboardCacheKey(base), dashboardCacheKey({ ...base, tier: "Tier 1" }));
});

test("missing optional filters normalize to the same cache key as empty filters", () => {
  assert.equal(
    dashboardCacheKey(base),
    dashboardCacheKey({
      ...base,
      country: "",
      originalSource: "",
      latestSource: "",
      tier: "",
      persona: "",
    }),
  );
});
