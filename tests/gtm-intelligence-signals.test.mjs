import assert from "node:assert/strict";
import test from "node:test";
import { calculateGtmIntelligenceSignals } from "../src/lib/gtm-intelligence-signals.ts";

const now = new Date("2026-09-10T12:00:00.000Z");

function contact(id, overrides = {}) {
  return {
    id,
    companyId: "",
    createdAt: "2026-09-01T08:00:00.000Z",
    lastSalesActivityAt: "",
    nextActivityAt: "",
    firstEngagementMs: 2 * 60 * 60 * 1000,
    hasPhone: true,
    hasEmail: true,
    hasLinkedIn: true,
    ...overrides,
  };
}

function meeting(id, overrides = {}) {
  return {
    id,
    contactIds: [],
    createdAt: "2026-09-01T08:00:00.000Z",
    startAt: "2026-09-01T09:00:00.000Z",
    endAt: "2026-09-01T10:00:00.000Z",
    outcome: "COMPLETED",
    ...overrides,
  };
}

test("calculates conservative GTM risk, conversion, engagement, SLA, and data-completeness signals", () => {
  const result = calculateGtmIntelligenceSignals({
    now,
    from: "2026-09-01",
    to: "2026-09-30",
    contacts: [
      contact("c1", {
        companyId: "company-1",
        lastSalesActivityAt: "2026-08-01T08:00:00.000Z",
        firstEngagementMs: 25 * 60 * 60 * 1000,
        hasPhone: false,
        hasEmail: false,
        hasLinkedIn: false,
      }),
      contact("c2", {
        companyId: "company-1",
        lastSalesActivityAt: "2026-09-06T08:00:00.000Z",
        nextActivityAt: "2026-09-12T08:00:00.000Z",
      }),
      contact("c3", { companyId: "company-2", firstEngagementMs: null }),
    ],
    deals: [
      {
        id: "stale-deal",
        contactIds: ["c1"],
        createdAt: "2026-08-01T08:00:00.000Z",
        closeDate: "2026-08-31T00:00:00.000Z",
        nextActivityAt: "",
        isOpen: true,
      },
      {
        id: "progressed-deal",
        contactIds: ["c2"],
        createdAt: "2026-09-05T08:00:00.000Z",
        closeDate: "2026-09-30T00:00:00.000Z",
        nextActivityAt: "2026-09-12T08:00:00.000Z",
        isOpen: true,
      },
    ],
    meetings: [
      meeting("no-follow-up", { contactIds: ["c1"] }),
      meeting("no-show", { contactIds: ["c2"], outcome: "NO_SHOW", startAt: "2026-09-02T09:00:00.000Z", endAt: "2026-09-02T10:00:00.000Z", createdAt: "2026-09-02T08:00:00.000Z" }),
      meeting("progressed", { contactIds: ["c2"], startAt: "2026-09-03T09:00:00.000Z", endAt: "2026-09-03T10:00:00.000Z", createdAt: "2026-09-03T08:00:00.000Z" }),
    ],
    activities: [
      { id: "follow-up-email", contactIds: ["c2"], occurredAt: "2026-09-06T08:00:00.000Z", kind: "email", emailOpenCount: 1, emailClickCount: 0, emailReplyCount: 0 },
      { id: "connected-1", contactIds: ["c3"], occurredAt: "2026-09-04T08:00:00.000Z", kind: "call", connected: true },
      { id: "connected-2", contactIds: ["c3"], occurredAt: "2026-09-05T08:00:00.000Z", kind: "call", connected: true },
    ],
  });

  assert.deepEqual(result.staleDeals.ids, ["stale-deal"]);
  assert.deepEqual(result.dealsWithoutFutureActivity.ids, ["stale-deal"]);
  assert.deepEqual(result.dealsWithOverdueCloseDate.ids, ["stale-deal"]);
  assert.deepEqual(result.meetingsWithoutFollowUp.ids, ["no-follow-up"]);
  assert.deepEqual(result.completedMeetingsWithoutProgression.ids, ["no-follow-up"]);
  assert.deepEqual(result.noShowMeetings.ids, ["no-show"]);
  assert.deepEqual(result.highEngagementAccountsWithoutMeeting.ids, ["company-2"]);
  assert.deepEqual(result.contactsWithConnectedCallsWithoutMeeting.ids, ["c3"]);
  assert.deepEqual(result.meetingToDealConversion, { numerator: 1, denominator: 3, rate: 33.3 });
  assert.deepEqual(result.connectedCallToMeetingConversion, { numerator: 3, denominator: 2, rate: 150 });
  assert.deepEqual(result.accountEngagement.find((account) => account.companyId === "company-2"), {
    companyId: "company-2",
    score: 60,
    connectedCalls: 2,
    emailReplies: 0,
    emailClicks: 0,
    emailOpens: 0,
    hasMeeting: false,
  });
  assert.deepEqual(result.leadResponseSla, {
    eligible: 3,
    met: 1,
    missing: 1,
    rate: 33.3,
    overdueIds: ["c1", "c3"],
  });
  assert.deepEqual(result.missingContactInfo, {
    missingPhone: { count: 1, ids: ["c1"] },
    missingEmail: { count: 1, ids: ["c1"] },
    missingLinkedIn: { count: 1, ids: ["c1"] },
    missingAny: { count: 1, ids: ["c1"] },
  });
});

test("does not infer a future activity, an SLA result, or a conversion from missing data", () => {
  const result = calculateGtmIntelligenceSignals({
    now,
    from: "2026-09-01",
    to: "2026-09-30",
    contacts: [contact("c1", { createdAt: "2026-08-01T08:00:00.000Z", firstEngagementMs: null })],
    deals: [],
    meetings: [],
    activities: [],
  });

  assert.deepEqual(result.dealsWithoutFutureActivity, { count: 0, ids: [] });
  assert.deepEqual(result.meetingToDealConversion, { numerator: 0, denominator: 0, rate: 0 });
  assert.deepEqual(result.connectedCallToMeetingConversion, { numerator: 0, denominator: 0, rate: 0 });
  assert.deepEqual(result.leadResponseSla, { eligible: 0, met: 0, missing: 0, rate: 0, overdueIds: [] });
});
