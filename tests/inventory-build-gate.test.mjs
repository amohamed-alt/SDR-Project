import test from "node:test";
import assert from "node:assert/strict";
import { inventoryBuildReady } from "../scripts/inventory-build-gate.mjs";
const expected = "a".repeat(40), actual = "b".repeat(40);
test("inventory accepts the exact build without an API call", async () => {
  assert.equal(await inventoryBuildReady(expected, expected, "org/repo", () => { throw Error("unexpected call"); }), true);
});
test("inventory accepts only a verified newer descendant", async () => {
  const fetcher = async () => ({ ok: true, json: async () => ({ status: "ahead", merge_base_commit: { sha: expected } }) });
  assert.equal(await inventoryBuildReady(expected, actual, "org/repo", fetcher), true);
  for (const [status, sha] of [["behind", actual], ["diverged", expected], ["ahead", actual]]) {
    assert.equal(await inventoryBuildReady(expected, actual, "org/repo", async () => ({ ok: true, json: async () => ({ status, merge_base_commit: { sha } }) })), false);
  }
});
test("inventory never accepts an unverifiable deployment", async () => {
  assert.equal(await inventoryBuildReady(expected, "unknown", "org/repo"), false);
  assert.equal(await inventoryBuildReady(expected, actual, ""), false);
  assert.equal(await inventoryBuildReady(expected, actual, "org/repo", async () => ({ ok: false })), false);
});
