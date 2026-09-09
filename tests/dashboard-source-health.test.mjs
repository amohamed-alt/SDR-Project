import assert from "node:assert/strict";
import test from "node:test";
import {
  LAST_KNOWN_GOOD_WARNING,
  createLastKnownGoodDashboard,
  criticalDashboardWarnings,
  dashboardSnapshotIsTrustworthy,
} from "../src/lib/dashboard-source-health.ts";

function dashboard(warnings, generatedAt = "2026-09-09T08:00:00.000Z") {
  return {
    meta: {
      generatedAt,
      warnings,
      ownerId: "31644369",
      ownerName: "Marita Chedid",
    },
    kpis: {
      calls: 91,
      openTasks: 48,
    },
    priorityContacts: [{ id: "1" }],
  };
}

test("critical dashboard data failures are not treated as trustworthy", () => {
  const data = dashboard([
    "Calls: HubSpot request failed: /crm/v4/objects/calls/search",
    "Open tasks (NOT_STARTED): HubSpot request failed: /crm/v4/objects/tasks/search",
  ]);

  assert.equal(dashboardSnapshotIsTrustworthy(data), false);
  assert.deepEqual(criticalDashboardWarnings(data), data.meta.warnings);
});

test("label-only warnings can still use the cached snapshot", () => {
  const data = dashboard([
    "Contact property labels: HubSpot request failed: /crm/v3/properties/contacts/gtm_icp_tier",
    "Deal stages: HubSpot request failed: /crm/v3/pipelines/deals",
  ]);

  assert.equal(dashboardSnapshotIsTrustworthy(data), true);
  assert.deepEqual(criticalDashboardWarnings(data), []);
});

test("last-known-good fallback preserves trusted values and their honest timestamp", () => {
  const previous = dashboard([], "2026-09-09T07:30:00.000Z");
  const failed = dashboard([
    "Calls: HubSpot request failed: /crm/v3/objects/calls/search",
    "Tasks due: HubSpot request failed: /crm/v3/objects/tasks/search",
  ], "2026-09-09T08:15:00.000Z");
  failed.kpis.calls = 0;
  failed.kpis.openTasks = 0;

  const fallback = createLastKnownGoodDashboard(previous, failed);

  assert.equal(fallback.kpis.calls, 91);
  assert.equal(fallback.kpis.openTasks, 48);
  assert.equal(fallback.meta.generatedAt, "2026-09-09T07:30:00.000Z");
  assert.deepEqual(fallback.meta.warnings, [
    ...failed.meta.warnings,
    LAST_KNOWN_GOOD_WARNING,
  ]);
  assert.equal(dashboardSnapshotIsTrustworthy(fallback), false);
});
