import assert from "node:assert/strict";
import test from "node:test";
import { decideRecipientLanguage } from "../src/lib/recipient-language-routing.ts";
import { VISIBLE_SEQUENCE_LANES, laneFor } from "../src/lib/smartlead-visible-sequences.ts";

const ARABIC = /[\u0600-\u06FF]/;

test("obvious English recipients can never route to an Arabic Smartlead lane", () => {
  for (const firstName of ["John", "Priya", "Sarah", "Adam", "Sam", "Maya", "George"]) {
    const decision = decideRecipientLanguage({ firstName, country: "Saudi Arabia" });
    assert.equal(decision.locale, "en", firstName);
    assert.equal(laneFor("talentera", decision.locale), "talentera_en", firstName);
    assert.equal(laneFor("evalify", decision.locale), "evalufy_en", firstName);
    assert.equal(ARABIC.test(decision.greetingName), false, firstName);
  }
});

test("high-confidence GCC Arabic names use an Arabic greeting and Arabic lane", () => {
  const examples = [
    ["Abdullah", "عبدالله"],
    ["Maher", "ماهر"],
    ["Hattan", "هتان"],
    ["Tamim", "تميم"],
    ["Hisham", "هشام"],
    ["Ammar", "عمار"],
    ["Mohamed", "محمد"],
  ];
  for (const [firstName, greeting] of examples) {
    const decision = decideRecipientLanguage({ firstName, country: "Saudi Arabia" });
    assert.equal(decision.locale, "ar-SA", firstName);
    assert.equal(decision.greetingName, greeting, firstName);
    assert.equal(laneFor("talentera", decision.locale), "talentera_ar", firstName);
    assert.equal(laneFor("evalify", decision.locale), "evalufy_ar", firstName);
  }
});

test("Arabic and English campaign bodies stay in their intended script", () => {
  for (const lane of [VISIBLE_SEQUENCE_LANES.talentera_ar, VISIBLE_SEQUENCE_LANES.evalufy_ar]) {
    for (const touch of lane.touches) {
      assert.ok(ARABIC.test(touch.body), `${lane.lane} must contain Arabic copy`);
      assert.ok(!/^Hi\b/m.test(touch.body), `${lane.lane} must not start in English`);
    }
  }
  for (const lane of [VISIBLE_SEQUENCE_LANES.talentera_en, VISIBLE_SEQUENCE_LANES.evalufy_en]) {
    for (const touch of lane.touches) {
      assert.equal(ARABIC.test(touch.body), false, `${lane.lane} must not contain Arabic copy`);
      assert.ok(/^Hi \{\{first_name\}\},/m.test(touch.body), `${lane.lane} must use the English greeting`);
    }
  }
});

test("all four lanes keep the same threaded Day 1, Day 5, Day 11 structure", () => {
  for (const lane of Object.values(VISIBLE_SEQUENCE_LANES)) {
    assert.deepEqual(lane.touches.map((touch) => touch.delayDays), [0, 4, 6], lane.lane);
    assert.ok(lane.touches[0].subject.length > 0, lane.lane);
    assert.equal(lane.touches[1].subject, "", lane.lane);
    assert.equal(lane.touches[2].subject, "", lane.lane);
  }
});
