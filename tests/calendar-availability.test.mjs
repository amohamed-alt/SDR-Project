import assert from "node:assert/strict";
import test from "node:test";
import {
  bookingAvailabilityIssue,
  classifyFreeBusyResponse,
  isFreeBusyAuthorizationErrorText,
  isStaleGoogleCredentialText,
} from "../src/lib/calendar-availability.ts";

const calendarId = "rep@talentera.com";
const checkedAt = "2026-07-30T10:00:00.000Z";

test("classifies a calendar with no conflicts as available", () => {
  const result = classifyFreeBusyResponse(
    calendarId,
    { calendars: { [calendarId]: { busy: [] } } },
    checkedAt,
  );

  assert.equal(result.status, "available");
  assert.deepEqual(result.busy, []);
  assert.equal(bookingAvailabilityIssue(result, "Sales Rep"), null);
});

test("returns conflict intervals and blocks booking when the rep is busy", () => {
  const busy = [{ start: "2026-07-30T11:00:00Z", end: "2026-07-30T11:30:00Z" }];
  const result = classifyFreeBusyResponse(
    calendarId,
    { calendars: { [calendarId]: { busy } } },
    checkedAt,
  );

  assert.equal(result.status, "busy");
  assert.deepEqual(result.busy, busy);
  assert.equal(bookingAvailabilityIssue(result, "Zein Fares")?.errorCode, "sales_rep_busy");
});

test("never treats a calendar permission error as free time", () => {
  const result = classifyFreeBusyResponse(
    calendarId,
    {
      calendars: {
        [calendarId]: {
          errors: [{ domain: "calendar", reason: "notFound" }],
        },
      },
    },
    checkedAt,
  );

  assert.equal(result.status, "unavailable");
  assert.match(result.reason ?? "", /notFound/);
  assert.equal(
    bookingAvailabilityIssue(result, "Ursula Waked")?.errorCode,
    "sales_rep_availability_unavailable",
  );
});

test("treats a missing Free/Busy calendar response as unavailable", () => {
  const result = classifyFreeBusyResponse(calendarId, { calendars: {} }, checkedAt);
  assert.equal(result.status, "unavailable");
});

test("detects expired credentials and missing Free/Busy OAuth scope", () => {
  assert.equal(isStaleGoogleCredentialText("invalid_grant: Token has been expired or revoked"), true);
  assert.equal(
    isFreeBusyAuthorizationErrorText("Request had insufficient authentication scopes."),
    true,
  );
});

test("a conflict found during the confirmation recheck prevents creation", () => {
  const previewResult = classifyFreeBusyResponse(
    calendarId,
    { calendars: { [calendarId]: { busy: [] } } },
    "2026-07-30T10:00:00.000Z",
  );
  const confirmationResult = classifyFreeBusyResponse(
    calendarId,
    {
      calendars: {
        [calendarId]: {
          busy: [{ start: "2026-07-30T11:00:00Z", end: "2026-07-30T11:30:00Z" }],
        },
      },
    },
    "2026-07-30T10:01:00.000Z",
  );

  assert.equal(bookingAvailabilityIssue(previewResult, "Sales Rep"), null);
  assert.equal(
    bookingAvailabilityIssue(confirmationResult, "Sales Rep")?.errorCode,
    "sales_rep_busy",
  );
});
