import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
import * as qualification from '../src/lib/ai-sdr-qualification.ts';
import * as identity from '../src/lib/salesnav-identity.ts';
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
const lead = { name: 'Test Person', title: 'HR Director', company: 'Example Ltd', linkedinUrl: 'https://www.linkedin.com/in/test-person', salesLeadUrl: 'https://www.linkedin.com/sales/lead/123' };
const prospect = { fullName: lead.name, company: lead.company, linkedinUrl: lead.linkedinUrl, phone: '+962791234567' };

function route(file, adapters) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const modules = { 'next/server': { NextRequest, NextResponse }, zod: require('zod'), '@/lib/ai-sdr-qualification': qualification, '@/lib/salesnav-identity': identity, ...adapters };
  vm.runInNewContext(compiled, { exports, require: id => { if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`); return modules[id]; }, URL, Date, Set, console, process: { env: {} } });
  return async body => {
    const response = await exports.POST(new NextRequest('https://example.com/api/test', { method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, data: await response.json() };
  };
}
function revealFixture({ cached = null, revealed = prospect } = {}) {
  const calls = [];
  const run = route('src/app/api/prospecting/salesnav/reveal-fast/route.ts', {
    '@/lib/salesnav-lead-ledger': { lookupSalesNavLead: async () => { calls.push('lookup'); return cached; }, reserveSalesNavReveal: async () => { if(cached) return {reserved:false,record:cached}; calls.push('save-attempt'); return {reserved:true,record:{linkedinUrl:lead.linkedinUrl}}; }, salesNavRevealStatus: record => record.cachedProspect ? 'completed' : 'uncertain', saveSalesNavReveal: async input => { calls.push(input.prospect ? 'save-result' : 'save-state'); } },
    '@/app/api/prospecting/resolve-companion/route': { POST: async () => { calls.push('provider'); return NextResponse.json({ prospect: revealed }); } },
    '@/app/api/prospecting/salesnav/precheck-v2/route': { POST: async () => { calls.push('crm-check'); return NextResponse.json({ contact: { inHubSpot: false }, company: { protected: false } }); } },
  });
  return { calls, run };
}

test('Sales Nav identity compares normalized complete names without fuzzy matching', () => {
  for (const [selected, revealed] of [['José García', 'JOSE  GARCIA'], ['Anne-Marie O’Neil', 'anne marie o neil'], ['مُحَمَّد علي', 'محمد علي']]) {
    assert.equal(identity.salesNavNameMismatch({ ...lead, name: selected }, { fullName: revealed }), '');
  }
  for (const fullName of ['Other Person', 'Dr Test Person', '', undefined]) assert.match(identity.salesNavNameMismatch(lead, { fullName }), /manually/);
  assert.equal(identity.salesNavNameMismatch({ ...lead, salesLeadUrl: '' }, { fullName: 'Other Person' }), '');
});
test('cache identity requires a verified matching public URL even when other aliases match', () => {
  assert.equal(identity.cachedSalesNavIdentityMismatch(lead.linkedinUrl, { aliases: [`li:${lead.linkedinUrl}/?trk=abc`, 'sales:same', 'name-company:same'], cachedProspect: prospect }), '');
  for (const cached of [
    { aliases: ['sales:same', 'name-company:same'] },
    { aliases: ['li:https://www.linkedin.com/in/colleague'] },
    { aliases: [`li:${lead.linkedinUrl}`, 'li:https://www.linkedin.com/in/colleague'] },
    { aliases: [`li:${lead.linkedinUrl}`], cachedProspect: { linkedinUrl: 'https://www.linkedin.com/in/colleague' } },
  ]) assert.match(identity.cachedSalesNavIdentityMismatch(lead.linkedinUrl, cached), /Manual identity review/);
});
test('invalid nonempty public URL is rejected before lookup or paid reveal', async () => {
  for (const linkedinUrl of [lead.salesLeadUrl, 'https://example.com/in/test-person']) {
    const f = revealFixture(); const r = await f.run({ lead: { ...lead, linkedinUrl } });
    assert.equal(r.status, 422); assert.equal(r.data.creditUsed, false); assert.deepEqual(f.calls, []);
  }
});
test('corrected public URL cannot reuse an old reveal through matching sales/name aliases', async () => {
  const f = revealFixture({ cached: { aliases: [`li:${lead.linkedinUrl}`, `sales:${lead.salesLeadUrl}`], revealAttemptedAt: 'now', cachedProspect: prospect } });
  const r = await f.run({ lead: { ...lead, linkedinUrl: 'https://www.linkedin.com/in/colleague' } });
  assert.equal(r.status, 409); assert.equal(r.data.creditUsed, false); assert.deepEqual(f.calls, ['lookup']);
});
test('matching cached result remains free; conflicting cached name never reaches CRM', async () => {
  for (const mismatch of [false, true]) {
    const f = revealFixture({ cached: { aliases: [`li:${lead.linkedinUrl}`], revealAttemptedAt: 'now', cachedProspect: { ...prospect, fullName: mismatch ? 'Colleague Name' : lead.name } } });
    const r = await f.run({ lead }); assert.equal(r.status, mismatch ? 409 : 200); assert.equal(r.data.creditUsed, false);
    assert.deepEqual(f.calls, mismatch ? ['lookup'] : ['lookup', 'crm-check']);
  }
});
test('fresh mismatching reveal is retained as uncertain after a free eligibility check', async () => {
  const f = revealFixture({ revealed: { ...prospect, fullName: 'Colleague Name' } }); const r = await f.run({ lead });
  assert.equal(r.status, 409); assert.equal(r.data.creditUsed, true);
  assert.deepEqual(f.calls, ['lookup', 'save-attempt', 'crm-check', 'provider', 'save-state']);
});
test('fresh missing provider name cannot pass using the requested display-name fallback', async () => {
  for (const providerFullName of ['', 'Colleague Name']) {
    const f = revealFixture({ revealed: { ...prospect, providerFullName } }); const r = await f.run({ lead });
    assert.equal(r.status, 409); assert.equal(r.data.creditUsed, true);
    assert.deepEqual(f.calls, ['lookup', 'save-attempt', 'crm-check', 'provider', 'save-state']);
  }
  assert.equal(identity.salesNavNameMismatch(lead, { ...prospect, fullName: 'Display label', providerFullName: lead.name }), '');
});
test('fresh matching reveal continues through the existing CRM safety check', async () => {
  const f = revealFixture(); const r = await f.run({ lead }); assert.equal(r.status, 200);
  assert.deepEqual(f.calls, ['lookup', 'save-attempt', 'crm-check', 'provider', 'save-result', 'crm-check']);
});
test('both push routes reject a same-company colleague before any CRM access or write', async () => {
  const calls = [];
  const unexpected = async () => { calls.push('unexpected'); throw new Error('CRM must not be reached'); };
  const shared = { '@/app/api/prospecting/salesnav/precheck-v2/route': { POST: unexpected } };
  const ready = route('src/app/api/prospecting/salesnav/push-ready-v2/route.ts', { ...shared,
    '@/app/api/prospecting/push/route': { POST: unexpected }, '@/lib/acquisition-routing': { manualTaskOwners: unexpected }, '@/lib/salesnav-lead-ledger': { saveSalesNavPush: unexpected }, '@/lib/salesnav-push-attempt': { checkpointSalesNavPush: unexpected, SalesNavPushAttemptError: class extends Error {}, withSalesNavPushAttempt: unexpected }, '@/lib/sdr-admin-auth': {sdrAdminAuthorized: () => true}, 'node:crypto': require('node:crypto'),
  });
  const ai = route('src/app/api/ai/lead-agent/push/route.ts', { ...shared,
    '@/app/api/prospecting/salesnav/push-ready-v2/route': { POST: unexpected }, '@/lib/hubspot': { batchRead: unexpected, readAssociations: unexpected }, '@/lib/sdr-admin-auth': { sdrAdminAuthorized: () => true }, '@/lib/request-origin': { originMatchesRequestHosts: () => true },
  });
  const input = { lead: { ...lead, location: '', companyCountry: 'Saudi Arabia', companyDomain: 'example.com', employeeCount: 100, detectedAts: '', atsStatus: 'unknown', atsEvidence: '', sector: '' }, prospect: { ...prospect, fullName: 'Colleague Name' }, taskDueAt: '2026-10-14T06:00:00Z', taskOwnerId: '31644369' };
  for (const run of [ready, ai]) { const r = await run(input); assert.equal(r.status, 409); assert.match(r.data.error, /manually/); }
  assert.deepEqual(calls, []);
});



test('classic name + company reveal works without per-profile URL capture and reuses cached results', async () => {
  const requestLead = { ...lead, linkedinUrl: '' };
  const fresh = revealFixture();
  assert.equal((await fresh.run({ lead: requestLead })).status, 200);
  assert.deepEqual(fresh.calls, ['lookup', 'save-attempt', 'crm-check', 'provider', 'save-result', 'crm-check']);
  const cached = revealFixture({ cached: { revealAttemptedAt: 'now', cachedProspect: prospect } });
  const result = await cached.run({ lead: requestLead });
  assert.equal(result.status, 200); assert.equal(result.data.creditUsed, false);
  assert.deepEqual(cached.calls, ['lookup', 'crm-check']);
  const missingCompany = revealFixture();
  assert.equal((await missingCompany.run({ lead: { ...requestLead, company: '' } })).status, 422);
  assert.deepEqual(missingCompany.calls, []);
});
