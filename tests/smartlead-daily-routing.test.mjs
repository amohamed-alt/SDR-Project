import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyLaneTargets,
  DAILY_LANE_NEW_CAPS,
  selectVerifiedDailyBatch,
  verificationCandidatesForLane,
} from "../src/lib/smartlead-daily-routing.ts";

function lead(index, product, locale, eligible = true) {
  return { email: `lead-${index}@example.com`, product, locale, eligible, blockReason: eligible ? "" : "Invalid or unsafe email" };
}

test("15 inbox safe-ramp capacity resolves to about five new leads per inbox", () => {
  assert.deepEqual(buildDailyLaneTargets(75, { talentera: 45, evalify: 30 }), DAILY_LANE_NEW_CAPS);
});

test("lower global capacity is reduced proportionally without exceeding a lane", () => {
  assert.deepEqual(buildDailyLaneTargets(50, { talentera: 45, evalify: 30 }), {
    talentera_ar: 15,
    talentera_en: 15,
    evalufy_ar: 10,
    evalufy_en: 10,
  });
});

test("verified selection enforces every lane cap even when the queue is language-skewed", () => {
  const queue = [
    ...Array.from({ length: 40 }, (_, index) => lead(index, "talentera", "ar-SA")),
    ...Array.from({ length: 25 }, (_, index) => lead(100 + index, "talentera", "en")),
    ...Array.from({ length: 20 }, (_, index) => lead(200 + index, "evalify", "ar-GCC")),
    ...Array.from({ length: 20 }, (_, index) => lead(300 + index, "evalify", "en")),
  ];
  const verified = new Set(queue.map((item) => item.email));
  const result = selectVerifiedDailyBatch(queue, verified, {
    globalLimit: 75,
    productLimits: { talentera: 45, evalify: 30 },
  });
  assert.equal(result.selected.length, 75);
  assert.deepEqual(result.laneCounts, DAILY_LANE_NEW_CAPS);
  assert.deepEqual(result.productCounts, { talentera: 45, evalify: 30 });
});

test("verification candidates are isolated by lane and exclude sales or duplicate blocks", () => {
  const queue = [
    lead(1, "talentera", "ar-SA"),
    { ...lead(2, "talentera", "ar-SA"), blockReason: "Recent Sales activity at company" },
    lead(3, "talentera", "en"),
  ];
  assert.deepEqual(verificationCandidatesForLane(queue, "talentera_ar").map((item) => item.email), ["lead-1@example.com"]);
});

test("valid personal email addresses cannot enter verification or the final send batch", () => {
  const personal = { ...lead(5, "talentera", "en"), email: "person@hotmail.com" };
  assert.deepEqual(verificationCandidatesForLane([personal], "talentera_en"), []);
  assert.deepEqual(selectVerifiedDailyBatch([personal], new Set([personal.email]), {
    globalLimit: 1,
    productLimits: { talentera: 1, evalify: 0 },
  }).selected, []);
});

test("a missing current email can still reach the LinkedIn recovery gate", () => {
  const candidate = { ...lead(4, "evalify", "en", false), email: "", linkedinUrl: "https://www.linkedin.com/in/example-person", blockReason: "Invalid or unsafe email" };
  assert.deepEqual(verificationCandidatesForLane([candidate], "evalufy_en"), [candidate]);
});
