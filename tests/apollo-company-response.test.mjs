import assert from "node:assert/strict";
import test from "node:test";
import { apolloCompanyRecords, apolloSaudiScopeEcho } from "../src/lib/apollo-company-response.ts";

test("an empty organizations bucket does not hide saved Apollo accounts", () => {
  const rows = apolloCompanyRecords({ organizations: [], accounts: [{ id: "account-id", organization_id: "org-id", name: "Saved company" }] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].organization_id, "org-id");
  assert.equal(rows[0].id, "account-id");
});

test("both company buckets are retained and nested saved-company metadata is recovered", () => {
  const rows = apolloCompanyRecords({ organizations: [{ id: "new", name: "New company" }], accounts: [{ id: "saved", organization: { id: "known-org", country: "Saudi Arabia", estimated_num_employees: 200, primary_domain: "example.com" } }] });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].country, "Saudi Arabia");
  assert.equal(rows[1].estimated_num_employees, 200);
  assert.equal(rows[1].organization_id, "known-org");
  assert.throws(() => apolloCompanyRecords({ pagination: {} }), /no result buckets/);
});

test("a saved-account response must echo both discovery filters before unknown sizes inherit source qualification", () => {
  assert.equal(apolloSaudiScopeEcho([{ signal_field_name: "organization_locations", value: "Saudi Arabia" }]), false);
  assert.equal(apolloSaudiScopeEcho([{ signal_field_name: "organization_locations", value: "Saudi Arabia" }, { signal_field_name: "organization_num_employees_ranges", value: "200,1000000000" }]), true);
});
