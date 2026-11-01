import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const next = require('next/server');
const code = ts.transpileModule(fs.readFileSync('src/app/api/prospecting/salesnav/precheck-v2/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

async function check(payload, status = 200) {
  const exports = {};
  let forwarded;
  vm.runInNewContext(code, { exports, URL, console: { error() {} }, require: id => id === 'next/server' ? next : { POST: async request => { forwarded = await request.json(); return next.NextResponse.json(payload, { status }); } } });
  const response = await exports.POST(new next.NextRequest('https://example.test/precheck', { method: 'POST', body: JSON.stringify({ name: 'Buyer', strictNetNewCompany: false }) }));
  return { status: response.status, body: await response.json(), forwarded };
}
const fresh = { contact: { inHubSpot: false }, company: { inHubSpot: false, domain: 'example.sa' } };

test('existing CRM company cannot be revealed even without calls, meetings or retention', async () => {
  const result = await check({ ...fresh, company: { inHubSpot: true, engagementChecked: true, meetingCount: 0, connectedCallCount: 0 } });
  assert.equal(result.forwarded.strictNetNewCompany, true);
  assert.equal(result.body.company.protected, true);
  assert.equal(result.body.company.gateReason, 'Existing company blocked');
  assert.equal(result.body.policy.existingCompanyNoCommunication, 'blocked');
});
test('government domain is blocked even when CRM has no matching company', async () => {
  const result = await check({ ...fresh, company: { inHubSpot: false, domain: 'sta.gov.sa' } });
  assert.equal(result.body.company.gateReason, 'Government blocked');
  assert.equal(result.body.company.protected, true);
});
test('a complete new-company identity response remains eligible', async () => {
  const result = await check(fresh);
  assert.equal(result.body.company.protected, false);
});
test('missing CRM identity data and upstream failures never become net-new results', async () => {
  assert.equal((await check({})).status, 500);
  assert.equal((await check({ error: 'rate limited' }, 429)).status, 429);
});
