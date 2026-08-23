import assert from "node:assert/strict";
import test from "node:test";
import { VISIBLE_SEQUENCE_LANES, laneFor, smartleadSequencePayload } from "../src/lib/smartlead-visible-sequences.ts";

const spamTriggers = [
  "free", "guaranteed", "no obligation", "act now", "limited time", "urgent", "winner", "click here", "buy now", "order now", "risk-free", "exclusive deal", "100% free",
];
const mixedArabicTerms = ["assessments", "screening", "scoring", "shortlisting", "workflow", "ats"];

test("visible sequences keep the conservative 3-touch cadence", () => {
  for (const lane of Object.values(VISIBLE_SEQUENCE_LANES)) {
    assert.equal(lane.touches.length, 3, lane.lane);
    assert.deepEqual(lane.touches.map((touch) => touch.delayDays), [0, 4, 6], lane.lane);
    assert.deepEqual(lane.touches.map((touch) => touch.framework), ["AIDA", "PAS", "Breakup"], lane.lane);
  }
});

test("all four campaigns use the same thread structure", () => {
  for (const lane of Object.values(VISIBLE_SEQUENCE_LANES)) {
    assert.ok(lane.touches[0].subject.length > 0, `${lane.lane} needs a first-touch subject`);
    assert.equal(lane.touches[1].subject, "", `${lane.lane} touch 2 must stay in the original thread`);
    assert.equal(lane.touches[2].subject, "", `${lane.lane} touch 3 must stay in the original thread`);
  }
  assert.equal(VISIBLE_SEQUENCE_LANES.talentera_ar.touches[0].subject, VISIBLE_SEQUENCE_LANES.evalufy_ar.touches[0].subject);
  assert.equal(VISIBLE_SEQUENCE_LANES.talentera_en.touches[0].subject, VISIBLE_SEQUENCE_LANES.evalufy_en.touches[0].subject);
});

test("sequence copy stays plain, short and free of common spam patterns", () => {
  for (const lane of Object.values(VISIBLE_SEQUENCE_LANES)) {
    for (const touch of lane.touches) {
      assert.ok(touch.subject.length <= 50, `${lane.lane} subject too long: ${touch.subject}`);
      assert.ok(!/^re:/i.test(touch.subject), `${lane.lane} must not fake a reply thread`);
      assert.ok(!/https?:\/\/|www\./i.test(touch.body), `${lane.lane} contains a link`);
      assert.ok(!/[!?]{2,}/.test(touch.subject + touch.body), `${lane.lane} has excessive punctuation`);
      assert.ok(touch.body.includes("{{first_name}}"), `${lane.lane} is missing first-name personalization`);
      assert.ok(touch.body.split(/\s+/).filter(Boolean).length <= 125, `${lane.lane} body is too long`);
      const lower = `${touch.subject} ${touch.body}`.toLowerCase();
      for (const trigger of spamTriggers) assert.ok(!lower.includes(trigger), `${lane.lane} contains spam trigger: ${trigger}`);
    }
  }
});

test("Arabic visible sequences contain no untranslated operational terms", () => {
  for (const lane of [VISIBLE_SEQUENCE_LANES.talentera_ar, VISIBLE_SEQUENCE_LANES.evalufy_ar]) {
    const copy = lane.touches.map((touch) => `${touch.subject} ${touch.body}`).join(" ").toLowerCase();
    for (const term of mixedArabicTerms) assert.ok(!copy.includes(term), `${lane.lane} contains untranslated term: ${term}`);
  }
});

test("routing selects product and language lane without changing product", () => {
  assert.equal(laneFor("talentera", "ar-SA"), "talentera_ar");
  assert.equal(laneFor("talentera", "ar-GCC"), "talentera_ar");
  assert.equal(laneFor("talentera", "en"), "talentera_en");
  assert.equal(laneFor("evalify", "ar-SA"), "evalufy_ar");
  assert.equal(laneFor("evalify", "en"), "evalufy_en");
});

test("Smartlead payload exposes actual copy and threaded follow-ups", () => {
  for (const lane of Object.keys(VISIBLE_SEQUENCE_LANES)) {
    const payload = smartleadSequencePayload(lane);
    assert.equal(payload.sequences.length, 3);
    assert.ok(payload.sequences[0].subject.length > 0);
    assert.equal(payload.sequences[1].subject, "");
    assert.equal(payload.sequences[2].subject, "");
    for (const sequence of payload.sequences) {
      assert.ok(sequence.email_body.length > 0);
      assert.ok(!sequence.email_body.includes("{{sl_touch_"));
      assert.ok(!sequence.subject.includes("{{sl_subject_"));
    }
  }
});
