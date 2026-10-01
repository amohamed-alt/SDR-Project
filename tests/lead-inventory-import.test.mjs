import assert from "node:assert/strict";
import test from "node:test";
import { inventoryDomain, inventoryImportSchema, parseInventoryFile } from "../src/lib/lead-inventory-import.ts";

test("inventory CSV preserves quoted company names and multiline evidence", () => {
  const rows = parseInventoryFile('name,domain,evidence\r\n"Acme, LLC",WWW.ACME.COM,"Hiring\nnew team"');
  assert.equal(rows[0].name, "Acme, LLC");
  assert.equal(rows[0].evidence, "Hiring\nnew team");
  assert.equal(inventoryDomain(rows[0].domain), "acme.com");
});

test("inventory rejects unsafe or non-company domain identities", () => {
  for (const value of ["localhost", "127.0.0.1", "user:password@example.com", "https://example.com:8080", "javascript://example.com", "example.invalid"]) {
    assert.throws(() => inventoryDomain(value), value);
  }
  assert.equal(inventoryDomain("https://www.acme.com/careers"), "acme.com");
});

test("inventory validation never accepts executable source links or client qualification fields", () => {
  const base = { source: "Clay", companies: [{ name: "Acme", domain: "acme.com" }] };
  assert.equal(inventoryImportSchema.parse(base).execute, false);
  assert.equal(inventoryImportSchema.parse(base).companies[0].businessLine, "Talentera");
  assert.equal(inventoryImportSchema.safeParse({ ...base, companies: [{ ...base.companies[0], sourceUrl: "javascript:alert(1)" }] }).success, false);
  assert.equal(inventoryImportSchema.safeParse({ ...base, companies: [{ ...base.companies[0], exclusionStatus: "eligible" }] }).success, false);
  assert.equal(inventoryImportSchema.safeParse({ ...base, companies: Array.from({ length: 101 }, () => base.companies[0]) }).success, false);
});

test("inventory rejects malformed CSV and duplicate headers instead of shifting identities", () => {
  assert.throws(() => parseInventoryFile('name,domain\n"Acme,acme.com'));
  assert.throws(() => parseInventoryFile('name,domain,domain\nAcme,a.com,b.com'));
  assert.throws(() => parseInventoryFile('name,domain\nAcme,a.com,unexpected'));
});
