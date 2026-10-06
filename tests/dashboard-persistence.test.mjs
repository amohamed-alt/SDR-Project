import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";

process.env.DASHBOARD_CACHE_API_URL = "http://dashboard-cache.test";
const { writePersistedDashboardSnapshot, readPersistedDashboardSnapshot } = await import("../src/lib/dashboard-cache-api.ts");

test("persisted snapshots keep every record and signal ID through the compressed cache transport", async (t) => {
  const filters = { from: "2026-10-01", to: "2026-10-04", ownerId: "1" };
  const data = {
    meta: { generatedAt: "2026-10-06T12:00:00Z" },
    priorityContacts: Array.from({ length: 300 }, (_, i) => ({ id: String(i), name: `Full contact ${i}` })),
    recentActivities: Array.from({ length: 400 }, (_, i) => ({ id: String(i), type: "Task" })),
    companies: [], deals: [], intelligence: { missing: { ids: ["299"] } },
  };
  let saved;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options.method === "PUT") { saved = JSON.parse(options.body); return new Response("{}"); }
    return Response.json({ data: saved.data, refreshedAt: saved.refreshedAt, ageSeconds: 5 });
  });
  assert.equal(await writePersistedDashboardSnapshot(filters, data, 1000), true);
  assert.equal(saved.data.format, "gzip-v1");
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(saved.data.body, "base64"))), data);
  const restored = await readPersistedDashboardSnapshot(filters);
  assert.deepEqual(restored, { data, refreshedAt: 1000, ageSeconds: 5 });
});
