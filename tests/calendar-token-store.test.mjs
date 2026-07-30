import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCalendarTokenStore } from "../src/lib/calendar-token-store.ts";

const maritaConnection = {
  email: "m.chedid@talentera.com",
  encryptedRefreshToken: "encrypted-marita-token",
  connectedAt: "2026-07-29T10:00:00.000Z",
  updatedAt: "2026-07-30T10:00:00.000Z",
};

const abdullahConnection = {
  email: "a.mohamed@talentera.com",
  encryptedRefreshToken: "encrypted-abdullah-token",
  connectedAt: "2026-07-30T11:00:00.000Z",
  updatedAt: "2026-07-30T11:00:00.000Z",
};

test("migrates the legacy single connection to Marita without changing it", () => {
  assert.deepEqual(
    normalizeCalendarTokenStore({ version: 1, connection: maritaConnection }),
    {
      version: 2,
      connections: { marita: maritaConnection },
    },
  );
});

test("keeps Marita and Abdullah connections separate in version 2", () => {
  assert.deepEqual(
    normalizeCalendarTokenStore({
      version: 2,
      connections: {
        marita: maritaConnection,
        abdullah: abdullahConnection,
      },
    }),
    {
      version: 2,
      connections: {
        marita: maritaConnection,
        abdullah: abdullahConnection,
      },
    },
  );
});

test("rejects unsupported or malformed credential stores", () => {
  assert.equal(normalizeCalendarTokenStore(null), null);
  assert.equal(normalizeCalendarTokenStore({ version: 3 }), null);
});
