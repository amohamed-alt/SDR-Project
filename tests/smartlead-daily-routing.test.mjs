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

test("15 inbox capacity resolves to the explicit 15/15/10/10 daily lane plan", () => {
  assert.deepEqual(buildDailyLaneTargets(50, { talentera: 30, evalify: 20 }), DAILY_LANE_NEW_CAPS);
});

test("lower global capacity is reduced proportionally without exceeding a lane", () => {
  assert.deepEqual(buildDailyLaneTargets(40, { talentera: 30, evalify: 20 }), {
    talentera_ar: 12,
    talentera_en: 12,
    evalufy_ar: 8,
    evalufy_en: 8,
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
    globalLimit: 50,
    productLimits: { talentera: 30, evalify: 20 },
  });
  assert.equal(result.selected.length, 50);
  assert.deepEqual(result.laneCounts, DAILY_LANE_NEW_CAPS);
  assert.deepEqual(result.productCounts, { talentera: 30, evalify: 20 });
});

test("verification candidates are isolated by lane and exclude sales or duplicate blocks", () => {
  const queue = [
    lead(1, "talentera", "ar-SA"),
    { ...lead(2, "talentera", "ar-SA"), blockReason: "Recent Sales activity at company" },
    lead(3, "talentera", "en"),
  ];
  assert.deepEqual(verificationCandidatesForLane(queue, "talentera_ar").map((item) => item.email), ["lead-1@example.com"]);
});
