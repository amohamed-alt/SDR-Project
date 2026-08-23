import assert from "node:assert/strict";
import test from "node:test";
import { VISIBLE_SEQUENCE_LANES, laneFor, smartleadSequencePayload } from "../src/lib/smartlead-visible-sequences.ts";

const spamTriggers = [
  "free",
  "guaranteed",
  "no obligation",
  "act now",
  "limited time",
  "urgent",
  "winner",
  "click here",
  "buy now",
  "order now",
  "risk-free",
  "exclusive deal",
  "100% free",
];

test("visible sequences keep the conservative 3-touch cadence", () => {
  for (const lane of Object.values(VISIBLE_SEQUENCE_LANES)) {
    assert.equal(lane.touches.length, 3, lane.lane);
    assert.deepEqual(lane.touches.map((touch) => touch.delayDays), [0, 3, 4], lane.lane);
    assert.deepEqual(lane.touches.map((touch) => touch.framework), ["AIDA", "PAS", "Breakup"], lane.lane);
  }
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

test("routing selects product and language lane without changing product", () => {
  assert.equal(laneFor("talentera", "ar-SA"), "talentera_ar");
  assert.equal(laneFor("talentera", "ar-GCC"), "talentera_ar");
  assert.equal(laneFor("talentera", "en"), "talentera_en");
  assert.equal(laneFor("evalify", "ar-SA"), "evalufy_ar");
  assert.equal(laneFor("evalify", "en"), "evalufy_en");
});

test("Smartlead payload exposes actual subject and body instead of full-body custom-field placeholders", () => {
  for (const lane of Object.keys(VISIBLE_SEQUENCE_LANES)) {
    const payload = smartleadSequencePayload(lane);
    assert.equal(payload.sequences.length, 3);
    for (const sequence of payload.sequences) {
      assert.ok(sequence.subject.length > 0);
      assert.ok(sequence.email_body.length > 0);
      assert.ok(!sequence.email_body.includes("{{sl_touch_"));
      assert.ok(!sequence.subject.includes("{{sl_subject_"));
    }
  }
});
