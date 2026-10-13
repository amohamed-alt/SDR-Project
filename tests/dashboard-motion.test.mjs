import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildDashboardMotion } from "../src/lib/dashboard-motion.ts";
import { queryDashboardRecords } from "../src/lib/dashboard-records.ts";

function fixture() {
  return {
    meta: { generatedAt: "2026-10-14T08:00:00Z", from: "2026-10-01", to: "2026-10-14", timezone: "Asia/Riyadh" },
    priorityContacts: Array.from({ length: 300 }, (_, i) => ({ id: String(i), name: `Person ${i}`, contactSource: i < 150 ? "Inbound Marketing" : "SDR Outbound", leadSource: "", originalSource: "Unknown", hasDeal: i === 299, hasOpenDeal: i === 299 })),
    recentActivities: Array.from({ length: 250 }, (_, i) => ({ id: `call-${i}`, type: "Call", status: "Connected", relatedContactId: "299", metricAt: "2026-10-02T08:00:00Z", isOpen: false })),
    companies: [], deals: [],
  };
}

test("motion uses all contacts and calls beyond both browser preview limits; evidence reconciles", () => {
  const data = fixture();
  const model = buildDashboardMotion(data);
  assert.equal(model.inboundMetrics.contacts, 150);
  assert.equal(model.outboundMetrics.contacts, 150);
  assert.equal(model.outboundMetrics.calls, 250);
  assert.equal(model.outboundMetrics.connected, 250);
  assert.equal(model.classificationCoverage, 100);
  assert.equal(model.daily.find(row => row.date === "2026-10-02").outboundCalls, 250);
  const page = queryDashboardRecords(data, { kind: "activities", motion: "Outbound", where: [{ field: "type", value: "Call" }] }, { limit: 50, offset: 200 });
  assert.equal(page.total, model.outboundMetrics.calls);
  assert.equal(page.rows.length, 50);
  assert.equal(page.version, data.meta.generatedAt);
  const contacts = queryDashboardRecords(data, { kind: "contacts", motion: "Outbound", funnel: "Open Deal" });
  assert.deepEqual(contacts.rows.map(row => row.id), ["299"]);
  assert.equal(contacts.total, model.outboundMetrics.openDealContacts);
  assert.ok(JSON.stringify(model).length < 8000, "summary stays bounded without person records or activity IDs");
  assert.equal(JSON.stringify(model).includes("Person 299"), false);
});

test("unknown execution excludes future open tasks and out-of-period completions, using reporting timezone", () => {
  const data = fixture();
  data.recentActivities = [
    { id: "future", type: "Task", isOpen: true, metricAt: "2027-01-01T08:00:00Z" },
    { id: "open-in-period", type: "Task", isOpen: true, metricAt: "2026-10-02T08:00:00Z" },
    { id: "old-complete", type: "Task", isOpen: false, metricAt: "2026-09-20T08:00:00Z" },
    { id: "done", type: "Task", isOpen: false, metricAt: "2026-09-30T22:00:00Z" },
    { id: "next-day", type: "Call", metricAt: "2026-10-14T22:00:00Z" },
    { id: "invalid", type: "Call", metricAt: "invalid" },
    { id: "unbooked", type: "Meeting", bookedInPeriod: false, metricAt: "2026-10-03T08:00:00Z" },
  ];
  const model = buildDashboardMotion(data);
  assert.equal(model.unknownActivities, 1);
  assert.equal(model.unknownMetrics.completedTasks, 1);
  assert.deepEqual(queryDashboardRecords(data, { kind: "activities", motion: "Unknown" }).rows.map(row => row.id), ["done"]);
});

test("tracker meetings retain their explicit motion without fabricating contact associations", () => {
  const data = fixture();
  data.meetingSheet = { status: "ready", rows: [{ id: "sheet-1", motion: "Inbound" }] };
  data.recentActivities = [{ id: "sheet-1", type: "Meeting", bookedInPeriod: true, metricAt: "2026-10-03T09:00:00Z", isOpen: true }];
  const model = buildDashboardMotion(data);
  assert.equal(model.inboundMetrics.meetings, 1);
  assert.equal(model.unknownActivities, 0);
  assert.equal(model.daily.find(row => row.date === "2026-10-03").inboundActivities, 1);
  assert.equal(queryDashboardRecords(data, { kind: "activities", motion: "Inbound", day: "2026-10-03" }).total, 1);
  data.priorityContacts = [];
  assert.equal(buildDashboardMotion(data).classificationCoverage, null);
});

test("motion client requests aggregate profile and uses snapshot-pinned server evidence", () => {
  const client = readFileSync(new URL("../src/components/DashboardMotion.tsx", import.meta.url), "utf8");
  assert.match(client, /profile: "motion"/);
  assert.match(client, /version: data\.meta\.generatedAt, selection/);
  assert.match(client, /from: data\.meta\.from, to: data\.meta\.to, ownerId: data\.meta\.ownerId/);
  assert.doesNotMatch(client, /data\.priorityContacts|data\.recentActivities/);
  const shell = readFileSync(new URL("../src/components/DashboardShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<MotionDashboard sdr=\{sdr\} initialSearch=\{viewSearch\}/);
});
