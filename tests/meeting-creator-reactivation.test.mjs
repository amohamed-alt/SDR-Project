import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReactivation } from "../src/lib/meeting-creator-reactivation.ts";

const base = {
  attemptedCalls: 2, connectedCalls: 0, bookedMeetings: 0, openDeals: 0,
  openFollowUpTasks: 0, positiveReplies: 0, completeCallHistory: true,
  newContactId: "new-hr-director", previouslyCalledContactIds: ["old-hr-manager"],
  newContactCurrentEmployerVerified: true, newContactDecisionMakerFit: true,
  newContactBusinessPhoneAvailable: true,
};

test("unconnected calls can reactivate with a different verified HR decision maker", () => {
  assert.equal(evaluateReactivation(base).status, "eligible");
});
test("connected call anywhere on account protects it", () => {
  assert.equal(evaluateReactivation({...base, connectedCalls: 1}).status, "protected");
});
test("meeting, open deal or positive reply protect the account", () => {
  for (const field of ["bookedMeetings","openDeals","positiveReplies"]) {
    assert.equal(evaluateReactivation({...base, [field]: 1}).status, "protected");
  }
});
test("existing follow-up task preserves owner workflow", () => {
  assert.equal(evaluateReactivation({...base, openFollowUpTasks: 1}).status, "protected");
});
test("same previously called person is not a reactivation", () => {
  assert.equal(evaluateReactivation({...base, newContactId:"old-hr-manager"}).status, "needs_review");
});
test("no phone, unverified employer or missing history must be reviewed", () => {
  assert.equal(evaluateReactivation({...base, newContactBusinessPhoneAvailable:false}).status, "needs_review");
  assert.equal(evaluateReactivation({...base, newContactCurrentEmployerVerified:false}).status, "needs_review");
  assert.equal(evaluateReactivation({...base, completeCallHistory:false}).status, "needs_review");
});
