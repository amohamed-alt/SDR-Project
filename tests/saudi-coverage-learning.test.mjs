import assert from "node:assert/strict";
import test from "node:test";
import { chooseInventorySdr, employeeBand, learnedPriority, learnCoverage, outcomeWithinWindow, personaFamily, productPersonas } from "../src/lib/saudi-coverage-learning.ts";
const now = Date.parse("2026-10-01T00:00:00Z");
const observation = (domain, extra = {}) => ({ domain, contactId: domain, product: "Talentera", industry: "Retail", employeeCount: 250, title: "Recruitment Manager", ownerId: "31644369", firstAttemptAt: "2026-08-01T00:00:00Z", connectedAt: "2026-08-02T00:00:00Z", meetingAt: "2026-08-07T00:00:00Z", ...extra });

test("model does not label untouched or immature leads as failures", () => {
  const result = learnCoverage([observation("a", { firstAttemptAt: "" }), observation("b", { firstAttemptAt: "2026-09-25T00:00:00Z" })], now);
  assert.equal(result.matureCompanies, 0); assert.equal(result.mode, "collecting");
});
test("repeated contacts do not inflate independent company evidence", () => {
  const result = learnCoverage(Array.from({ length: 30 }, (_, i) => observation("same", { contactId: String(i) })), now);
  assert.equal(result.segments[0].companies, 1); assert.equal(result.mode, "collecting");
});
test("learning starts only at minimum companies and isolates products", () => {
  const rows = Array.from({ length: 20 }, (_, i) => observation(`a${i}`));
  rows.push(observation("eval", { product: "Evalufy", title: "Admissions Director" }));
  const result = learnCoverage(rows, now);
  assert.equal(result.mode, "learning");
  assert.equal(result.segments.find((s) => s.product === "Evalufy").usable, false);
  assert.ok(learnedPriority(60, "Talentera", "Retail", 250, "Recruitment Manager", result).lift > 0);
  assert.equal(learnedPriority(60, "Evalufy", "Retail", 250, "Recruitment Manager", result).lift, 0);
});
test("old, late or invalid outcomes are not successful 30-day conversions", () => {
  assert.equal(outcomeWithinWindow("2026-08-01", "2026-07-31"), false);
  assert.equal(outcomeWithinWindow("2026-08-01", "2026-09-02"), false);
  assert.equal(outcomeWithinWindow("2026-08-01", null), false);
});
test("unknown exact size stays unknown and boundary 250 is included", () => {
  assert.equal(employeeBand(0), "Unknown"); assert.equal(employeeBand(249), "200–249"); assert.equal(employeeBand(250), "250–1,000");
  const result = learnCoverage([observation("a", { employeeCount: 0 })], now);
  assert.equal(result.segments.some((s) => s.dimension === "size"), false);
});
test("Evalufy education and corporate assessment use different personas", () => {
  assert.match(productPersonas("Evalufy", "University").primary, /Admissions/);
  assert.match(productPersonas("Evalufy", "Retail").primary, /Talent Acquisition/);
  assert.equal(personaFamily("Assessment Manager"), "Assessment / selection");
});
test("SDR routing respects products, preserves assignments, and never selects an RM", () => {
  assert.equal(chooseInventorySdr({ "31644369": 8, "37624223": 2 }, "Talentera"), "31644369");
  assert.equal(chooseInventorySdr({ "31644369": 1, "37624223": 20 }, "Evalufy"), "37624223");
  assert.equal(chooseInventorySdr({ "31644369": 8, "37624223": 2 }, "Evalufy", "31644369"), "31644369");
  assert.throws(() => chooseInventorySdr({ "31644369": 1 }, "Talentera"));
  assert.throws(() => chooseInventorySdr({}, "Talentera", "76369997"));
});
