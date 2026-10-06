import assert from "node:assert/strict";
import test from "node:test";
import { buildDecisionInsights, agentEvidence, wilsonLowerBound } from "../src/lib/decision-insights.ts";
import { normalizeNewsItems } from "../src/lib/market-news.ts";
import { bookedBySdr } from "../src/lib/handoff-attribution.ts";
import { sdrEvidenceAnswer } from "../src/lib/sdr-evidence-answer.ts";

function fixture() {
  const rows = (country, count, meetings, persona = "HR Leader", tier = "Tier A") => Array.from({ length: count }, (_, i) => ({ id: `${country}-${i}`, name: "Confidential name", email: "private@example.test", phone: "private phone", country, persona, tier, hasMeeting: i < meetings, hasConnectedCall: i < meetings + 1 }));
  return { meta: { from: "2026-10-01", to: "2026-10-04", warnings: [] }, kpis: { calls: 15, connectedCalls: 10, bookedMeetings: 8, completedMeetings: 4, leadResponseCoverage: 80 }, priorityContacts: [...rows("Saudi Arabia", 200, 60), ...rows("Tiny sample", 1, 1), ...rows("Unknown", 100, 100, "Unknown", "Unknown")], intelligence: { meetingsWithoutFollowUp: { count: 2 }, contactsWithConnectedCallsWithoutMeeting: { count: 3 }, staleDeals: { count: 0 } } };
}
test("market ranking uses complete distinct-contact samples and discounts tiny samples", () => {
  const insights = buildDecisionInsights(fixture());
  assert.equal(insights.quality.total, 301);
  assert.equal(insights.bestMarket.name, "Saudi Arabia");
  assert.equal(insights.bestMarket.meetings, 60);
  assert.equal(insights.bestMarket.meetingReach, 30);
  assert.ok(wilsonLowerBound(60, 200) > wilsonLowerBound(1, 1));
  assert.equal(insights.markets.find(row => row.name === "Tiny sample").evidence, "Insufficient evidence");
  assert.equal(insights.markets.find(row => row.name === "Unknown").rankScore, 0);
  assert.deepEqual(insights.bestMarket.selection, { kind: "contacts", where: [{ field: "country", value: "Saudi Arabia" }] });
});
test("unknown ICPs and empty cohorts cannot become recommendations", () => {
  const data = fixture();
  data.priorityContacts = data.priorityContacts.map(row => ({ ...row, persona: "Unknown", tier: "—" }));
  assert.equal(buildDecisionInsights(data).bestIcp, null);
  data.priorityContacts = [];
  const empty = buildDecisionInsights(data);
  assert.equal(empty.bestMarket, null);
  assert.equal(empty.quality.total, 0);
  assert.deepEqual(empty.markets, []);
  assert.equal(wilsonLowerBound(0, 0), 0);
});
test("AI context contains aggregates and no contact details or record selections", () => {
  const data = fixture();
  const evidence = JSON.stringify(agentEvidence(data, buildDecisionInsights(data)));
  for (const prohibited of ["Confidential", "private@example", "private phone", "selection", "Saudi Arabia-0"]) assert.equal(evidence.includes(prohibited), false);
  assert.ok(evidence.includes("Saudi Arabia"));
});
test("without a model the assistant answers from computed evidence and labels its mode", () => {
  const data = fixture();
  const insights = buildDecisionInsights(data);
  const english = sdrEvidenceAnswer("Which market should we test?", data, insights);
  assert.equal(english.mode, "evidence");
  assert.match(english.answer, /Saudi Arabia/);
  assert.match(english.answer, /60.*200/);
  const arabic = sdrEvidenceAnswer("إيه أقوى سوق؟", data, insights);
  assert.match(arabic.answer, /العينة الحالية/);
  assert.equal(arabic.model, "Calculated evidence");
});
test("SDR attribution requires explicit source evidence and isolates Marita and Daniel", () => {
  assert.equal(bookedBySdr("Booked by Daniel Beaini through SDR Command Center", "", undefined, "daniel"), true);
  assert.equal(bookedBySdr("Booked by Daniel Beaini", "", undefined, "marita"), false);
  assert.equal(bookedBySdr("Booked by MaritaX", "", undefined, "marita"), false);
  assert.equal(bookedBySdr("", "123", "123", "marita"), true);
  assert.equal(bookedBySdr("Owner Ursula", "", undefined, "marita"), false);
});
test("news retains source/date evidence and rejects unsafe links, duplicates and stale/future items", () => {
  const now = Date.parse("2026-10-07T00:00:00Z");
  const items = normalizeNewsItems([
    { title: "Hiring expansion", url: "https://example.com/a", published_date: "2026-10-06", content: "Company reports new jobs." },
    { title: "Duplicate", url: "https://example.com/a#fragment" },
    { title: "Unsafe", url: "javascript:alert(1)" },
    { title: "Unsafe", url: "https://127.0.0.1/private" },
    { title: "Stale", url: "https://example.com/old", published_date: "2026-08-01" },
    { title: "Future", url: "https://example.com/future", published_date: "2027-01-01" },
    { title: "Undated", url: "https://example.com/undated" },
  ], now);
  assert.equal(items.length, 2);
  assert.equal(items[0].source, "example.com");
  assert.equal(items[0].publishedAt, "2026-10-06T00:00:00.000Z");
  assert.equal(items[1].publishedAt, null);
  assert.equal(items[0].signal, "Hiring signal to validate");
});
