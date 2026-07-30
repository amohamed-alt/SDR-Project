import assert from "node:assert/strict";
import test from "node:test";
import {
  CALENDAR_ORGANIZER_IDS,
  calendarOrganizer,
  calendarOrganizerId,
} from "../src/lib/calendar-organizers.ts";

test("keeps Marita as the default calendar organizer", () => {
  assert.equal(calendarOrganizerId(undefined), "marita");
  assert.equal(calendarOrganizerId(null), "marita");
  assert.equal(calendarOrganizerId(""), "marita");
  assert.equal(calendarOrganizerId("unexpected"), "marita");
});

test("selects Abdullah only through his explicit organizer URL", () => {
  assert.equal(calendarOrganizerId("abdullah"), "abdullah");
});

test("maps both organizer accounts without changing Marita", () => {
  assert.deepEqual(CALENDAR_ORGANIZER_IDS, ["marita", "abdullah"]);
  assert.equal(calendarOrganizer("marita").email, "m.chedid@talentera.com");
  assert.equal(calendarOrganizer("abdullah").email, "a.mohamed@talentera.com");
});
