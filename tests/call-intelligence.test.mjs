import test from "node:test";
import assert from "node:assert/strict";
import { buildCallIntelligence } from "../src/lib/call-intelligence.ts";
import { selectDashboardRecords } from "../src/lib/dashboard-records.ts";
import { isTalentNews } from "../src/lib/market-news.ts";
const fixture = () => ({ meta: { from: "2026-10-02", to: "2026-10-02", timezone: "Asia/Riyadh" }, priorityContacts: [
  { id: "1", name: "Person One", title: "HR Director", company: "Alpha", country: "Saudi Arabia", hasMeeting: true },
  { id: "2", name: "Person Two", title: "HR Director", company: "Beta", country: "Egypt", hasMeeting: false },
], recentActivities: [
  { id: "a", type: "Call", metricAt: "2026-10-01T21:30:00Z", relatedContactId: "1", detail: "Connected" },
  { id: "b", type: "Call", metricAt: "2026-10-02T08:00:00Z", relatedContactId: "1", detail: "No answer" },
  { id: "c", type: "Call", metricAt: "2026-10-02T08:20:00Z", relatedContactId: "2", detail: "No answer" },
  { id: "d", type: "Call", metricAt: "2026-10-02T09:00:00Z", relatedContactId: "outside", detail: "Custom disposition" },
  { id: "e", type: "Call", metricAt: "2026-10-02T09:00:00Z", detail: "Connected" },
  { id: "before", type: "Call", metricAt: "2026-10-01T20:59:59Z", relatedContactId: "1", detail: "Connected" },
  { id: "after", type: "Call", metricAt: "2026-10-02T21:00:00Z", relatedContactId: "1", detail: "Connected" },
  { id: "meeting", type: "Meeting", metricAt: "2026-10-02T08:00:00Z", relatedContactId: "1", detail: "Connected" },
  { id: "invalid", type: "Call", metricAt: "", detail: "Connected" },
] });
test("call audience counts attempts, distinct people and known titles within local date boundaries", () => {
  const insight = buildCallIntelligence(fixture());
  assert.equal(insight.calls, 5);
  assert.equal(insight.connected, 2);
  assert.equal(insight.people, 3);
  assert.equal(insight.matchedCalls, 3);
  assert.equal(insight.titleKnownCalls, 3);
  assert.equal(insight.repeatedPeople, 1);
  const title = insight.titles.find(row => row.name === "HR Director");
  assert.deepEqual([title.calls, title.people, title.connected, title.meetingContacts, title.rate], [3, 2, 1, 1, 33.3]);
  assert.equal(insight.hours.find(row => row.value === "00").calls, 1);
  assert.equal(insight.hours.find(row => row.value === "11").calls, 2);
  assert.equal(insight.titles.find(row => row.name === "Unknown").calls, 2);
});
test("every audience and time chart opens exactly the counted call records", () => {
  const data = fixture(); const insight = buildCallIntelligence(data);
  for (const key of ["titles", "companies", "markets", "contacts", "hours"]) {
    assert.equal(insight[key].reduce((sum, row) => sum + row.calls, 0), 5);
    for (const row of insight[key]) {
      const records = selectDashboardRecords(data, row.selection);
      assert.equal(records.length, row.calls, `${key}/${row.name}`);
      assert.ok(records.every(call => call.type === "Call"));
    }
  }
});
test("talent feeds exclude unrelated business and out-of-region recruitment coverage", () => {
  assert.equal(isTalentNews({ title: "Saudi Arabia recruitment and workforce outlook" }, "saudi"), true);
  assert.equal(isTalentNews({ title: "UAE HR technology hiring demand" }, "uae"), true);
  assert.equal(isTalentNews({ title: "Egypt talent acquisition jobs" }, "egypt"), true);
  assert.equal(isTalentNews({ title: "Dubai payments funding expansion" }, "mena"), false);
  assert.equal(isTalentNews({ title: "US recruitment hiring jobs" }, "mena"), false);
  assert.equal(isTalentNews({ title: "Egypt jobs" }, "saudi"), false);
});
