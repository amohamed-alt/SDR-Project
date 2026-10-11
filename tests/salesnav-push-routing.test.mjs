import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { salesNavSdrOwner, usableSalesNavPhone } from '../src/lib/salesnav-company-policy.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const { NextRequest, NextResponse } = require('next/server');
const source = fs.readFileSync('src/app/api/prospecting/salesnav/push-ready-v2/route.ts', 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const due = '2026-10-12T06:00:00.000Z';
function route({ blocked = false, authorized = true, mismatch = false, ats = '', status = '', companyOwner = '' } = {}) {
  const events = []; let pushed;
  const exports = {};
  const mocks = {
    '@/lib/sdr-admin-auth': { sdrAdminAuthorized: () => authorized },
    '@/lib/acquisition-routing': { manualTaskOwners: () => [{ id: '31644369', name: 'Marita' }, { id: '37624223', name: 'Daniel' }] },
    '@/lib/salesnav-company-policy': { salesNavSdrOwner, usableSalesNavPhone },
    '@/lib/salesnav-lead-ledger': { saveSalesNavPush: async () => events.push('ledger') },
    '@/lib/hubspot': { batchRead: async () => { events.push('readback'); return [{ id: 'task', properties: { hubspot_owner_id: mismatch ? 'wrong' : pushed.ownerId, hs_timestamp: due } }]; } },
    '@/app/api/prospecting/salesnav/precheck-v2/route': { POST: async req => { const body = await req.json(); assert.equal(body.fresh, true); events.push('precheck'); return NextResponse.json({ contact: { inHubSpot: false }, company: { protected: blocked, protectedReason: 'Connected call', ownerId: companyOwner, detectedAts: ats, atsStatus: status } }); } },
    '@/app/api/prospecting/push/route': { POST: async req => { events.push('push'); pushed = await req.json(); return NextResponse.json({ taskId: 'task', contactId: 'contact', companyId: 'company', ownerId: pushed.ownerId }); } },
  };
  const context = vm.createContext({ exports, require: name => mocks[name] || require(name), process: { env: { HUBSPOT_PRIVATE_APP_TOKEN: 'test-only' } }, Request, Response, URL, Date, AbortSignal, console: { error() {} },
    fetch: async (_url, options) => { events.push('patch'); const body = JSON.parse(options.body); assert.equal(body.properties.hubspot_owner_id, pushed.ownerId); return new Response('{}'); },
  });
  vm.runInContext(compiled, context);
  async function post(owner = '37624223', phone = '+966501234567') {
    return exports.POST(new NextRequest('https://example.com/api/prospecting/salesnav/push-ready-v2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ taskOwnerId: owner, taskDueAt: due, lead: { name: 'Example', company: 'Example Company' }, prospect: { fullName: 'Example', company: 'Example Company', phone, score: 90, priority: 'high' } }) }));
  }
  return { post, events, get pushed() { return pushed; } };
}
test('Daniel assignment reaches contact creation and is confirmed before ledger success', async () => {
  const h = route(); const response = await h.post();
  assert.equal(response.status, 200); assert.equal(h.pushed.assignmentMode, 'acquisition'); assert.equal(h.pushed.ownerId, '37624223');
  assert.deepEqual(h.events, ['precheck', 'push', 'patch', 'readback', 'ledger']);
});
test('blocked or unauthorized pushes perform no CRM writes', async () => {
  for (const settings of [{ blocked: true }, { authorized: false }]) {
    const h = route(settings); const response = await h.post(); assert.ok(response.status >= 400); assert.ok(!h.events.includes('push'));
  }
});
test('automatic ATS split chooses Daniel only with verified evidence', async () => {
  const h = route({ ats: 'Workday', status: 'detected' }); assert.equal((await h.post('auto')).status, 200); assert.equal(h.pushed.ownerId, '37624223');
  const unknown = route(); assert.equal((await unknown.post('auto')).status, 422); assert.ok(!unknown.events.includes('push'));
});
test('owner conflict and unusable phone cannot create tasks', async () => {
  const conflict = route({ companyOwner: 'rm' }); assert.equal((await conflict.post()).status, 409); assert.ok(!conflict.events.includes('push'));
  const invalid = route(); assert.equal((await invalid.post('37624223', 'N/A')).status, 422); assert.ok(!invalid.events.includes('push'));
});
test('failed readback never records push completion', async () => {
  const h = route({ mismatch: true }); assert.equal((await h.post()).status, 500); assert.ok(h.events.includes('readback')); assert.ok(!h.events.includes('ledger'));
});
