import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { compressedJsonResponse } from "../src/lib/compressed-json.ts";

test("large dashboard payloads are gzip encoded for browsers", async () => {
  const payload = { rows: Array.from({ length: 500 }, (_, index) => ({ id: index, label: "Talentera dashboard row" })) };
  const response = await compressedJsonResponse(new Request("https://example.test/api/dashboard", {
    headers: { "Accept-Encoding": "gzip, deflate" },
  }), payload);
  assert.equal(response.headers.get("content-encoding"), "gzip");
  const decoded = gunzipSync(Buffer.from(await response.arrayBuffer())).toString("utf8");
  assert.deepEqual(JSON.parse(decoded), payload);
});
