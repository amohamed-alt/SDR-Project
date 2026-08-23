import assert from "node:assert/strict";
import test from "node:test";
import { verifiedActiveJobCount } from "../src/lib/acquisition-job-count.ts";

test("missing Apollo job data never fabricates five active jobs", () => {
  assert.equal(verifiedActiveJobCount({}), 0);
  assert.equal(verifiedActiveJobCount({ num_current_jobs: null }), 0);
});

test("Apollo job data is normalized without a false minimum", () => {
  assert.equal(verifiedActiveJobCount({ num_current_jobs: 2 }), 2);
  assert.equal(verifiedActiveJobCount({ num_current_jobs: -4 }), 0);
  assert.equal(verifiedActiveJobCount({ num_current_jobs: "7.6" }), 8);
});
