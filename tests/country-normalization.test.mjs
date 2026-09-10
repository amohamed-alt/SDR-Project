import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCountry } from "../src/lib/country-normalization.ts";

test("normalizes Saudi country aliases and misplaced city values", () => {
  for (const value of ["KSA", "Sa", "Saudi Arabia", "Saudia Arabia", "Kingdom of Saudi Arabia", "Riyadh", "Jeddah"]) {
    assert.equal(normalizeCountry(value), "Saudi Arabia");
  }
});

test("normalizes UAE aliases", () => {
  for (const value of ["UAE", "United Arab Emirate", "United Arab Emirates", "Dubai", "Abu Dhabi"]) {
    assert.equal(normalizeCountry(value), "United Arab Emirates");
  }
});

test("preserves unknown countries for review", () => {
  assert.equal(normalizeCountry("Qatar"), "Qatar");
  assert.equal(normalizeCountry("G"), "G");
  assert.equal(normalizeCountry(""), "");
});
