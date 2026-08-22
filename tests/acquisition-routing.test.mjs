import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseAcquisitionOwner,
  rankAcquisitionCandidates,
  signalHirePersonaQuery,
} from "../src/lib/acquisition-routing.ts";

test("builds a focused TA SignalHire query", () => {
  const query = signalHirePersonaQuery("Head / Director of Talent Acquisition", "Recruitment Manager");
  assert.match(query, /Talent Acquisition/);
  assert.match(query, /Director/);
});

test("ranks current-company senior TA candidates first", () => {
  const ranked = rankAcquisitionCandidates([
    { uid: "1", fullName: "A", title: "HR Coordinator", currentCompany: "Example Group", location: "Riyadh" },
    { uid: "2", fullName: "B", title: "Director of Talent Acquisition", currentCompany: "Example Group", location: "Riyadh" },
    { uid: "3", fullName: "C", title: "Head of Talent Acquisition", currentCompany: "Other Company", location: "Dubai" },
  ], {
    accountName: "Example Group",
    country: "Saudi Arabia",
    primaryPersona: "Head / Director of Talent Acquisition",
    secondaryPersona: "Recruitment Manager / Talent Operations",
  });
  assert.equal(ranked[0].uid, "2");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("smart routing preserves configured existing owner and otherwise picks lower load", () => {
  const preserved = chooseAcquisitionOwner("example.com", { "31644369": 100 }, "31644369");
  assert.equal(preserved.id, "31644369");

  const selected = chooseAcquisitionOwner("example.com", {
    "31644369": 20,
    "76369997": 2,
    "31558980": 15,
    "76370000": 12,
    "76369995": 11,
    "76369998": 9,
  });
  assert.equal(selected.id, "76369997");
});
