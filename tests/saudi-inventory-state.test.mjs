import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SaudiInventoryState } from "../src/lib/saudi-inventory-state.ts";

test("paid page claims are atomic and uncertain attempts cannot be repurchased", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "saudi-inventory-"));
  try {
    const state = new SaudiInventoryState(directory);
    const results = await Promise.allSettled([state.claim(1), state.claim(1)]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.deepEqual((await state.summary()).uncertainPages, [1]);
    await assert.rejects(state.claim(1), /already attempted/);
    await state.write(1, "raw", { organizations: [{ name: "Company" }], total: 101 });
    assert.deepEqual((await state.summary()).uncertainPages, []);
    await state.write(1, "result", { stored: 1, parserVersion: 2 });
    assert.equal((await state.summary()).nextPage, 2);
    await state.claim(2);
    await state.write(2, "raw", { organizations: [{ name: "Next" }], total: 101 });
    await state.write(2, "result", { stored: 1, parserVersion: 2 });
    const resumed = await new SaudiInventoryState(directory).summary();
    assert.equal(resumed.complete, true);
    assert.equal(resumed.nextPage, null);
    assert.equal(resumed.providerCallsAttempted, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("raw response alone is not a completed CRM comparison; invalid page keys are rejected", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "saudi-inventory-"));
  try {
    const state = new SaudiInventoryState(directory);
    await state.write(1, "raw", { organizations: [], total: 0 });
    assert.equal((await state.summary()).complete, false);
    assert.equal((await state.summary()).nextPage, 1);
    await state.write(1, "result", { stored: 0, parserVersion: 2 });
    assert.equal((await state.summary()).complete, true);
    await assert.rejects(state.claim(501), /Invalid/);
    await assert.rejects(state.read(0, "raw"), /Invalid/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("legacy recovery cannot report complete before saved accounts reconcile", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "saudi-recovery-"));
  try {
    const state = new SaudiInventoryState(directory);
    await state.write(1, "raw", { organizations: [], total: 2, legacyRepair: true });
    await state.write(1, "result", { parserVersion: 2, providerIds: ["organization-one"] });
    assert.equal((await state.summary()).complete, false);
    await state.write(1, "saved-raw", { organizations: [], total: 1 });
    await state.write(1, "saved-result", { parserVersion: 2, providerIds: ["organization-one"] });
    assert.equal((await state.summary()).complete, false);
    await state.write(1, "saved-result", { parserVersion: 2, providerIds: ["organization-two"] });
    assert.equal((await state.summary()).complete, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
