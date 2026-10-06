import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { queryDashboardRecords, selectDashboardRecords, dashboardRecordsCsv } from "../src/lib/dashboard-records.ts";
import { projectDashboardSummary } from "../src/lib/dashboard-payload.ts";
import { DashboardSnapshotHistory } from "../src/lib/dashboard-snapshot-history.ts";
import { responseMilliseconds, dashboardToday } from "../src/lib/dashboard-values.ts";
import { calculateGtmIntelligenceSignals } from "../src/lib/gtm-intelligence-signals.ts";
import { parseDashboardFilters } from "../src/lib/dashboard-query.ts";
import { readDashboardView } from "../src/lib/dashboard-url-state.ts";

function fixture() {
  const priorityContacts = Array.from({ length: 151 }, (_, i) => ({ id: String(i), name: `Contact ${i}`, email: `${i}@example.test`, priorityScore: i, createdAt: i === 150 ? "2026-09-30T22:00:00Z" : "2026-09-01T12:00:00Z", lastContacted: "", nextActivity: "", qualityIssues: [], leadResponseTimeHours: null }));
  const intelligence = calculateGtmIntelligenceSignals({ contacts: [], deals: [], meetings: [], activities: [], from: "2026-10-01", to: "2026-10-04" });
  intelligence.missingContactInfo.missingAny = { count: 151, ids: priorityContacts.map(row => row.id) };
  return { meta: { generatedAt: "2026-10-06T10:00:00Z", from: "2026-10-01", to: "2026-10-04", timezone: "Asia/Riyadh" }, kpis: { portfolioContacts: 151 }, priorityContacts, recentActivities: [], companies: [], deals: [], intelligence, dailyActivities: [] };
}

test("portfolio pages, global search and CSV cover records beyond the old 120-row payload", () => {
  const data = fixture();
  const first = queryDashboardRecords(data, { kind: "contacts" }, { limit: 50, sort: "priorityScore", direction: "desc" });
  assert.equal(first.total, data.kpis.portfolioContacts);
  assert.equal(first.rows.length, 50);
  assert.equal(first.rows[0].id, "150");
  const last = queryDashboardRecords(data, { kind: "contacts" }, { offset: 150, limit: 50, sort: "priorityScore", direction: "desc" });
  assert.deepEqual(last.rows.map(row => row.id), ["0"]);
  const found = queryDashboardRecords(data, { kind: "contacts" }, { q: "150@example.test" });
  assert.deepEqual(found.rows.map(row => row.id), ["150"]);
  const csv = dashboardRecordsCsv(queryDashboardRecords(data, { kind: "contacts" }, { limit: Number.MAX_SAFE_INTEGER }).rows);
  assert.equal(csv.split("\r\n").length, 152);
  assert.match(csv, /150@example.test/);
});

test("source scope uses reporting timezone and falls back only when there are no new contacts", () => {
  const data = fixture();
  assert.deepEqual(selectDashboardRecords(data, { kind: "contacts", scope: "source" }).map(row => row.id), ["150"]);
  data.meta.from = "2026-10-02";
  assert.equal(selectDashboardRecords(data, { kind: "contacts", scope: "source" }).length, 151);
  assert.equal(selectDashboardRecords(data, { kind: "contacts", scope: "created" }).length, 0);
});

test("task completion excludes out-of-period completed tasks while open workload stays current", () => {
  const data = fixture();
  data.recentActivities = [
    { id: "done-in", type: "Task", isOpen: false, metricAt: "2026-10-01T01:00:00Z" },
    { id: "done-out", type: "Task", isOpen: false, metricAt: "2026-09-01T01:00:00Z" },
    { id: "open", type: "Task", isOpen: true, metricAt: "2026-11-01T01:00:00Z", dueAt: "2026-11-01T01:00:00Z" },
    { id: "call", type: "Call", isOpen: false, metricAt: "2026-10-01T01:00:00Z", status: "No answer" },
  ];
  assert.deepEqual(selectDashboardRecords(data, { kind: "activities", scope: "activity-period", where: [{ field: "type", value: "Task" }, { field: "isOpen", value: false }] }).map(row => row.id), ["done-in"]);
  assert.deepEqual(selectDashboardRecords(data, { kind: "activities", scope: "task-status", where: [{ field: "type", value: "Task" }] }).map(row => row.id), ["done-in", "open"]);
  assert.equal(selectDashboardRecords(data, { kind: "activities", where: [{ field: "type", value: "Call" }, { field: "status", value: "Connected" }] }).length, 0);
});

test("summary retains aggregate truth while removing all evidence arrays without mutating the snapshot", () => {
  const data = fixture();
  const summary = projectDashboardSummary(data);
  assert.equal(summary.kpis.portfolioContacts, 151);
  assert.equal(summary.priorityContacts.length, 0);
  assert.equal(summary.intelligence.missingContactInfo.missingAny.count, 151);
  assert.equal(summary.intelligence.missingContactInfo.missingAny.ids.length, 0);
  assert.equal(data.intelligence.missingContactInfo.missingAny.ids.length, 151);
  assert.equal(selectDashboardRecords(data, { kind: "contacts", signal: "missing-contact-info" }).length, 151);
  assert.ok(gzipSync(JSON.stringify(summary)).length < gzipSync(JSON.stringify(data)).length / 2);
});

test("call outcome evidence distinguishes custom dispositions, missing outcomes and call execution status", () => {
  const data = fixture();
  const custom = "2e7360c1 6b71 40e9 Ab2b 30ae98a4678c";
  data.recentActivities = [
    { id: "custom", type: "Call", status: "Unknown", detail: custom },
    { id: "missing", type: "Call", status: "Completed", detail: "No disposition" },
    { id: "connected", type: "Call", status: "Connected", detail: "Connected" },
    { id: "meeting", type: "Meeting", status: "Unknown", detail: "Meetings Public" },
  ];
  const calls = outcome => selectDashboardRecords(data, { kind: "activities", outcome, where: [{ field: "type", value: "Call" }] }).map(row => row.id);
  assert.deepEqual(calls(custom), ["custom"]);
  assert.deepEqual(calls("Unknown"), ["missing"]);
  assert.deepEqual(calls("Connected"), ["connected"]);
  assert.deepEqual(selectDashboardRecords(data, { kind: "activities", outcome: "Unknown", where: [{ field: "type", value: "Meeting" }] }).map(row => row.id), ["meeting"]);
});

test("blank response timing remains missing, including a date at the reporting timezone boundary", () => {
  for (const value of [null, undefined, "", "   ", "NaN", "-1", "Infinity"]) assert.equal(responseMilliseconds(value), null);
  assert.equal(responseMilliseconds("0"), 0);
  const contacts = ["", "0", "3600000", "90000000"].map((raw, i) => ({ id: String(i), companyId: "", createdAt: "2026-09-30T22:00:00Z", firstEngagementMs: responseMilliseconds(raw), lastSalesActivityAt: "", nextActivityAt: "", hasPhone: true, hasEmail: true, hasLinkedIn: true }));
  const signals = calculateGtmIntelligenceSignals({ contacts, deals: [], meetings: [], activities: [], from: "2026-10-01", to: "2026-10-04" });
  assert.deepEqual(signals.leadResponseSla, { eligible: 4, met: 2, missing: 1, rate: 50, overdueIds: ["0", "3"] });
});

test("snapshot history isolates owner/filter keys, preserves exact versions and expires with bounded memory", () => {
  const history = new DashboardSnapshotHistory(2, 100);
  const first = fixture();
  history.remember("marita:oct", first, 0);
  assert.equal(history.get("marita:oct", first.meta.generatedAt, 10), first);
  assert.equal(history.get("zein:oct", first.meta.generatedAt, 10), undefined);
  assert.equal(history.get("marita:sep", first.meta.generatedAt, 10), undefined);
  const next = { ...first, meta: { ...first.meta, generatedAt: "2026-10-06T11:00:00Z" } };
  history.remember("marita:oct", next, 20);
  assert.equal(history.get("marita:oct", first.meta.generatedAt, 25), first);
  history.remember("zein:oct", first, 30);
  assert.equal(history.get("marita:oct", first.meta.generatedAt, 35), undefined);
  assert.equal(history.get("marita:oct", next.meta.generatedAt, 121), undefined);
});

test("shared URL parsing preserves the cohort while selecting each owner's isolated view", () => {
  const search = "?from=2026-10-01&to=2026-10-04&country=Saudi+Arabia&tier=Tier+1&persona=Recruiter";
  const defaults = { from: "2026-10-01", to: "2026-10-06", ownerId: "1" };
  for (const ownerId of ["1", "2", "3", "4"]) {
    const view = readDashboardView(search, { ...defaults, ownerId });
    assert.deepEqual(view.filters, { ...defaults, to: "2026-10-04", ownerId, country: "Saudi Arabia", tier: "Tier 1", persona: "Recruiter" });
    assert.deepEqual(parseDashboardFilters(new URLSearchParams(search), ownerId).data, { ...view.filters, originalSource: undefined, latestSource: undefined });
  }
  assert.equal(parseDashboardFilters(new URLSearchParams("from=2026-02-30&to=2026-03-01"), "1").success, false);
  assert.equal(parseDashboardFilters(new URLSearchParams("from=2026-10-05&to=2026-10-04"), "1").success, false);
  assert.equal(dashboardToday(new Date("2026-10-06T22:00:00Z")), "2026-10-07");
});

test("CSV escapes embedded quotes and formula-like CRM values", () => {
  const csv = dashboardRecordsCsv([{ id: "1", name: '=HYPERLINK("https://example.test")', phone: "+966123" }]);
  assert.match(csv, /'=HYPERLINK\(""https:\/\/example.test""\)/);
  assert.match(csv, /'\+966123/);
});
