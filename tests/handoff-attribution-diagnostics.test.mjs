import assert from "node:assert/strict";
import test from "node:test";
import { bookingEvidenceIndex, handoffAttributionDiagnostics, handoffAttributionMessage } from "../src/lib/handoff-attribution.ts";

test("RM-created records without SDR evidence remain excluded but visible in coverage", () => {
  const groups = Array.from({ length: 26 }, () => ({ sdrCreated: bookingEvidenceIndex([{ notes: "", creatorId: "rm-user" }], "marita", "marita-user") >= 0 }));
  const evidence = handoffAttributionDiagnostics(groups, true);
  assert.deepEqual(evidence, { meetingGroupsInPeriod: 26, attributedToSelectedSdr: 0, excludedFromSelectedSdr: 26, creatorMappingAvailable: true });
  assert.match(handoffAttributionMessage(evidence), /0 of 26/);
  assert.match(handoffAttributionMessage(evidence), /does not establish that the SDR booked no meetings/);
});

test("missing creator mapping is explicit and does not override valid booking markers", () => {
  const groups = [{ sdrCreated: bookingEvidenceIndex([{ notes: "Booked by Marita", creatorId: "integration-user" }], "marita") >= 0 }, { sdrCreated: false }];
  assert.deepEqual(handoffAttributionDiagnostics(groups, false), { meetingGroupsInPeriod: 2, attributedToSelectedSdr: 1, excludedFromSelectedSdr: 1, creatorMappingAvailable: false });
});

test("empty RM cohort is distinguishable from records excluded by attribution", () => {
  const evidence = handoffAttributionDiagnostics([], true);
  assert.equal(evidence.meetingGroupsInPeriod, 0);
  assert.match(handoffAttributionMessage(evidence), /No RM-owned HubSpot meeting groups/);
  assert.match(handoffAttributionMessage(evidence), /Google Sheet booking totals are a separate source/);
});
