import test from "node:test";
import assert from "node:assert/strict";
import { calculateReputationPlan, isSafeTalenteraSender, reputationHealth } from "../src/lib/smartlead-reputation.ts";

function sender(overrides = {}) {
  return {
    email: "marita@talentera-mail.com",
    maxPerDay: 25,
    assigned: true,
    warmupEnabled: true,
    warmupKnown: true,
    brand: "talentera",
    ...overrides,
  };
}

test("only Talentera senders are eligible for the Talentera campaign", () => {
  assert.equal(isSafeTalenteraSender(sender()), true);
  assert.equal(isSafeTalenteraSender(sender({ brand: "evalify", email: "marita@evalify-mail.com" })), false);
  assert.equal(isSafeTalenteraSender(sender({ brand: "unknown" })), false);
});

test("explicitly disabled warmup blocks a sender while unknown warmup is fail-soft", () => {
  assert.equal(isSafeTalenteraSender(sender({ warmupEnabled: false, warmupKnown: true })), false);
  assert.equal(isSafeTalenteraSender(sender({ warmupEnabled: false, warmupKnown: false })), true);
});

test("new lead capacity reserves steady-state room for all three touches", () => {
  const senders = Array.from({ length: 6 }, (_, index) => sender({ email: `marita${index}@talentera-mail.com`, maxPerDay: 25 }));
  const plan = calculateReputationPlan(senders, 75, { maxCampaignEmailsPerMailbox: 20, touches: 3 });
  assert.equal(plan.assignedEligibleSenders, 6);
  assert.equal(plan.senderDailyCapacity, 120);
  assert.equal(plan.safeNewLeadCap, 40);
});

test("unassigned and Evalify inboxes do not increase Talentera capacity", () => {
  const plan = calculateReputationPlan([
    sender(),
    sender({ assigned: false }),
    sender({ brand: "evalify", email: "marita@evalify-mail.com" }),
  ], 75, { maxCampaignEmailsPerMailbox: 20, touches: 3 });
  assert.equal(plan.eligibleSenders, 2);
  assert.equal(plan.assignedEligibleSenders, 1);
  assert.equal(plan.safeNewLeadCap, 6);
});

test("bounce safety locks after meaningful volume reaches three percent", () => {
  assert.equal(reputationHealth(49, 10).healthy, true);
  assert.equal(reputationHealth(100, 2).healthy, true);
  assert.equal(reputationHealth(100, 3).healthy, false);
});
