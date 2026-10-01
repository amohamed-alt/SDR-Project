import assert from "node:assert/strict";
import test from "node:test";
import { createCoverageReader } from "../src/lib/saudi-coverage-reader.ts";

function fixture(responses) {
  let now = 0;
  const starts = [];
  const read = createCoverageReader({ now: () => now, sleep: async (ms) => { now += ms; }, fetch: async () => {
    starts.push(now);
    const [status, headers = {}] = responses.shift() || [200];
    return new Response(JSON.stringify({ results: [] }), { status, headers });
  } });
  return { read, starts };
}
test("concurrent coverage reads share pacing", async () => {
  const f = fixture([]);
  await Promise.all([f.read("/a", "test"), f.read("/b", "test"), f.read("/c", "test")]);
  assert.deepEqual(f.starts, [0, 500, 1000]);
});
test("429 retry honors Retry-After and delays other queued reads", async () => {
  const f = fixture([[429, { "retry-after": "12" }], [200], [200]]);
  await Promise.all([f.read("/a", "test"), f.read("/b", "test")]);
  assert.deepEqual(f.starts, [0, 12000, 12500]);
});
test("retry remains bounded and a rejected read does not poison the queue", async () => {
  const f = fixture([[429], [429], [429], [200]]);
  await assert.rejects(f.read("/a", "test"), /429/);
  await f.read("/b", "test");
  assert.deepEqual(f.starts, [0, 10000, 30000, 30500]);
});
test("long or daily rate limits and authorization failures do not retry", async () => {
  for (const response of [[429, { "retry-after": "120" }], [429, { "x-hubspot-ratelimit-daily-remaining": "0" }], [401]]) {
    const f = fixture([response]);
    await assert.rejects(f.read("/a", "test"));
    assert.equal(f.starts.length, 1);
  }
});
