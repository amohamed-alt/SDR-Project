import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const page = fs.readFileSync('src/app/signalhire-queue/page.tsx', 'utf8');
const pipeline = fs.readFileSync('src/components/SalesNavPipelineV2.tsx', 'utf8');
const gate = fs.readFileSync('src/app/api/prospecting/salesnav/precheck-v2/route.ts', 'utf8');
const reveal = fs.readFileSync('src/app/api/prospecting/salesnav/reveal-fast/route.ts', 'utf8');
const push = fs.readFileSync('src/app/api/prospecting/salesnav/push-ready-v2/route.ts', 'utf8');

test('signalhire queue uses the net-new Sales Nav pipeline', () => {
  assert.match(page, /SalesNavPipelineV2/);
  assert.match(pipeline, /Ready to Push = NEW person only/);
  assert.match(pipeline, /Ready NEW/);
  assert.match(pipeline, /isExistingPerson\(row\)/);
});

test('both saved Sales Nav entrypoints use the same canonical net-new pipeline', () => {
  const fullRunPage = fs.readFileSync('src/app/salesnav-full-run/page.tsx', 'utf8');
  for (const source of [page, fullRunPage]) {
    assert.match(source, /import \{ SalesNavPipelineV2 \} from "@\/components\/SalesNavPipelineV2"/);
    assert.match(source, /<SalesNavPipelineV2\/>/);
    assert.doesNotMatch(source, /<SalesNavPipeline\/>/);
  }
});

test('Ready gate blocks existing people, Retention, meetings and connected calls', () => {
  assert.match(gate, /Existing HubSpot person/);
  assert.match(gate, /Retention account/);
  assert.match(gate, /meetingCount > 0/);
  assert.match(gate, /connectedCallCount > 0/);
  assert.match(gate, /Connected conversation blocked/);
  assert.match(gate, /connectedCallWithoutMeeting: "blocked"/);
  assert.doesNotMatch(gate, /Connected call allowed · no meeting/);
  assert.doesNotMatch(gate, /recentConnectedCall\).*protected/);
});

test('manual SignalHire reveal is parallel and no longer waits for ATS intelligence', () => {
  assert.match(pipeline, /Math\.min\(4, pending\.length\)/);
  assert.match(pipeline, /\/api\/prospecting\/salesnav\/reveal-fast/);
  assert.match(reveal, /ATS\/career research no longer blocks reveal speed/);
  assert.doesNotMatch(reveal, /enrichIntelligence/);
  assert.match(reveal, /lookupSalesNavLead/);
});

test('Ready push requires a phone and rechecks that the person is still net-new', () => {
  assert.match(push, /safety\.contact\.inHubSpot/);
  assert.match(push, /Ready to Push is net-new people only/);
  assert.match(push, /if \(!phones\.length\)/);
  assert.match(push, /safety\.company\.protected/);
});
