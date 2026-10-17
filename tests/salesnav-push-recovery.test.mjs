import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
import * as attempts from '../src/lib/salesnav-push-attempt.ts';
import * as identity from '../src/lib/salesnav-identity.ts';
import * as qualification from '../src/lib/ai-sdr-qualification.ts';
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
const owners = [{ id: '31644369', name: 'Marita Chedid' }, { id: '37624223', name: 'Daniel Beaini' }];
const lead = { name: 'Example Person', company: 'Example Ltd', linkedinUrl: 'https://www.linkedin.com/in/example-person', salesLeadUrl: 'https://www.linkedin.com/sales/lead/123' };
const prospect = { fullName: lead.name, company: lead.company, linkedinUrl: lead.linkedinUrl, phone: '+966550000001', score: 70, priority: 'high' };
const payload = { lead, prospect, runId: 'run-1', taskOwnerId: '37624223', taskDueAt: '2026-10-19T09:00:00Z' };
const quiet = { error() {}, warn() {}, log() {} };

function load(file, modules, extra = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => {
    if (!(id in modules)) throw new Error(`Unexpected dependency ${id}`);
    return modules[id];
  }, URL, Request, Response, Date, Set, Buffer, AbortSignal, console: quiet, process: { env: { HUBSPOT_PRIVATE_APP_TOKEN: 'test' } }, ...extra });
  return exports;
}

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'salesnav-push-'));
  const calls = [];
  const contacts = new Map();
  const tasks = new Map();
  let associationFailures = options.associationFailures || 0;
  let associationReadsFailed = false;
  let taskTimeout = options.taskTimeout || false;
  let ledgerFailures = options.ledgerFailures || 0;
  let taskRejections = options.taskRejections || 0;
  const attemptModule = { ...attempts, withSalesNavPushAttempt: (input, action) => attempts.withSalesNavPushAttempt({ ...input, stateDirectory: directory }, action) };
  const hubspot = {
    HubSpotApiError: class extends Error {},
    searchAll: async (object) => object === 'contacts' ? [...contacts.values()] : [],
    batchRead: async (object, ids) => ids.map(id => (object === 'contacts' ? contacts : tasks).get(id)).filter(Boolean),
    readAssociations: async (_from, _to, ids) => {
      if (options.failTaskRead && !associationReadsFailed) { associationReadsFailed = true; throw new Error('task check unavailable'); }
      return new Map(ids.map(id => [id, [...tasks.keys()]]));
    },
  };
  const push = load('src/app/api/prospecting/push/route.ts', {
    'next/server': { NextRequest, NextResponse }, zod: require('zod'), 'node:crypto': require('node:crypto'),
    '@/lib/salesnav-push-attempt': attemptModule,
    '@/lib/sdr-admin-auth': { sdrAdminAuthorized: () => true },
    '@/lib/acquisition-routing': { manualTaskOwners: () => owners },
    '@/lib/acquisition-data-api': { getAcquisitionAccount: async () => null, listAcquisitionPeople: async () => ({}), writeAcquisitionPush: async () => {} },
    '@/lib/saudi-coverage-store': {},
    '@/lib/saudi-ats-policy': {},
    '@/lib/marita-task-scheduler': { createScheduledMaritaTask: () => { throw new Error('Dashboard must not invoke automatic scheduling'); }, MaritaScheduleError: class extends Error {} },
    '@/lib/prospect-phone-details': { distinctProspectPhones: values => [...new Set(values.filter(Boolean))], missingProspectPhoneProperties: (p, current = {}) => current.phone ? {} : { phone: p.phone } },
    '@/lib/hubspot': hubspot,
    '@/lib/prospecting-company-intelligence': { normalizeCompanyDomain: () => '' },
    '@/lib/company-dedupe': { normalizedCompanyName: () => '', compatibleCompanyIdentity: () => false },
  }, { fetch: async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ url, method: init.method, body });
    if (url.includes('/properties/')) return Response.json({});
    if (url.endsWith('/contacts') && init.method === 'POST') {
      contacts.set('contact-1', { id: 'contact-1', properties: body.properties });
      return Response.json({ id: 'contact-1' });
    }
    if (url.includes('/associations/') && associationFailures-- > 0) throw new Error('association failed');
    if (url.endsWith('/tasks') && init.method === 'POST') {
      if (taskRejections-- > 0) return Response.json({ message: 'rate limited' }, { status: 429 });
      if (taskTimeout) { taskTimeout = false; throw new Error('task POST timeout'); }
      tasks.set('task-1', { id: 'task-1', properties: body.properties });
      return Response.json({ id: 'task-1' });
    }
    return new Response(null, { status: 204 });
  } });
  const ready = load('src/app/api/prospecting/salesnav/push-ready-v2/route.ts', {
    'next/server': { NextRequest, NextResponse }, zod: require('zod'), 'node:crypto': require('node:crypto'),
    '@/lib/salesnav-push-attempt': attemptModule,
    '@/lib/salesnav-identity': identity,
    '@/lib/ai-sdr-qualification': qualification,
    '@/lib/sdr-admin-auth': { sdrAdminAuthorized: () => options.authorized !== false },
    '@/lib/acquisition-routing': { manualTaskOwners: () => owners },
    '@/lib/salesnav-lead-ledger': { saveSalesNavPush: async () => { if (ledgerFailures-- > 0) throw new Error('ledger write failed'); } },
    '@/app/api/prospecting/push/route': push,
    '@/app/api/prospecting/salesnav/precheck-v2/route': { POST: async () => {
      const existing = [...contacts.values()][0];
      return NextResponse.json({ contact: { inHubSpot: Boolean(existing || options.existingPerson), id: existing?.id || (options.existingPerson ? 'unrelated' : ''), matchedBy: 'LinkedIn' },
        company: { inHubSpot: false, id: '', protected: Boolean(existing || options.blocked || options.existingPerson), gateReason: existing ? 'Existing person blocked' : '', accountType: options.blocked ? 'Retention' : '', meetingCount: 0, connectedCallCount: 0, engagementChecked: true } });
    } },
  });
  return { calls, tasks, contacts, directory, cleanup: () => rm(directory, { recursive: true, force: true }),
    run: async (body = payload) => {
      const response = await ready.POST(new NextRequest('https://example.com/api/prospecting/salesnav/push-ready-v2', { method: 'POST', body: JSON.stringify(body) }));
      return { status: response.status, data: await response.json() };
    },
  };
}

test('selected SDR/date are used at first contact/task create; completed retry writes nothing', async () => {
  const f = await fixture();
  try {
    const first = await f.run();
    assert.equal(first.status, 200);
    const contact = f.calls.find(c => c.url.endsWith('/contacts'));
    const task = f.calls.find(c => c.url.endsWith('/tasks'));
    assert.equal(contact.body.properties.hubspot_owner_id, payload.taskOwnerId);
    assert.equal(task.body.properties.hubspot_owner_id, payload.taskOwnerId);
    assert.equal(task.body.properties.hs_timestamp, '2026-10-19T09:00:00.000Z');
    assert.match(task.body.properties.hs_task_body, /Daniel Beaini/);
    const writes = f.calls.length;
    const second = await f.run();
    assert.equal(second.status, 200); assert.equal(second.data.duplicate, true);
    assert.equal(f.calls.length, writes);
  } finally { await f.cleanup(); }
});

test('contact checkpoint repairs a failed task-read step without duplicating contact', async () => {
  const f = await fixture({ failTaskRead: true });
  try {
    const first = await f.run();
    assert.equal(first.status, 500); assert.equal(first.data.retryable, true); assert.equal(first.data.contactId, 'contact-1');
    const second = await f.run();
    assert.equal(second.status, 200);
    assert.equal(f.calls.filter(c => c.url.endsWith('/contacts') && c.method === 'POST').length, 1);
    assert.equal(f.calls.filter(c => c.url.endsWith('/tasks') && c.method === 'POST').length, 1);
  } finally { await f.cleanup(); }
});

test('ledger failure after task create is repairable from saved task ID with no second task', async () => {
  const f = await fixture({ ledgerFailures: 1 });
  try {
    const first = await f.run();
    assert.equal(first.status, 500); assert.equal(first.data.retryable, true); assert.equal(first.data.taskId, 'task-1');
    const second = await f.run();
    assert.equal(second.status, 200); assert.equal(second.data.taskId, 'task-1');
    assert.equal(f.calls.filter(c => c.url.endsWith('/tasks') && c.method === 'POST').length, 1);
  } finally { await f.cleanup(); }
});

test('uncertain task POST may be reconciled but cannot create another task on retry', async () => {
  const f = await fixture({ taskTimeout: true });
  try {
    assert.equal((await f.run()).status, 500);
    const second = await f.run();
    assert.equal(second.status, 500); assert.match(second.data.error, /uncertain/);
    assert.equal(f.calls.filter(c => c.url.endsWith('/tasks') && c.method === 'POST').length, 1);
    f.tasks.set('visible-later', { id: 'visible-later', properties: { hs_task_subject: `🔥 SALES SIGNAL — ${lead.name}`, hs_task_status: 'NOT_STARTED', hubspot_owner_id: payload.taskOwnerId, hs_timestamp: payload.taskDueAt } });
    const third = await f.run();
    assert.equal(third.status, 200); assert.equal(third.data.taskId, 'visible-later');
  } finally { await f.cleanup(); }
});

test('unrelated existing people, protected companies and unauthorized callers cause no CRM writes', async () => {
  for (const options of [{ existingPerson: true }, { blocked: true }, { authorized: false }]) {
    const f = await fixture(options);
    try { assert.ok((await f.run()).status >= 400); assert.equal(f.calls.length, 0); }
    finally { await f.cleanup(); }
  }
});

test('a definitive rejected task POST can be retried, while a network timeout remains uncertain', async () => {
  const f = await fixture({ taskRejections: 1 });
  try {
    const first = await f.run(); assert.equal(first.status, 500); assert.equal(first.data.retryable, true);
    const second = await f.run(); assert.equal(second.status, 200);
    assert.equal(f.calls.filter(c => c.url.endsWith('/tasks') && c.method === 'POST').length, 2);
    assert.equal(f.tasks.size, 1);
  } finally { await f.cleanup(); }
});

test('an active per-person lease rejects concurrent work, and an expired interrupted lease resumes checkpoints', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'salesnav-push-lease-'));
  const input = { identity: lead.linkedinUrl, prospect, ownerId: payload.taskOwnerId, dueAt: payload.taskDueAt, stateDirectory: directory };
  let release; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  try {
    const active = attempts.withSalesNavPushAttempt(input, async () => { await attempts.checkpointSalesNavPush({ contactId: 'saved-contact' }); entered(); await waiting; });
    await started;
    await assert.rejects(attempts.withSalesNavPushAttempt(input, async () => {}), /already running/);
    release(); await active;
    const key = createHash('sha256').update(input.identity).digest('hex');
    const lock = path.join(directory, `${key}.lock`);
    await mkdir(lock);
    await writeFile(path.join(lock, 'owner.json'), JSON.stringify({ id: 'dead-worker', expiresAt: Date.now() - 1000 }));
    await attempts.withSalesNavPushAttempt(input, async saved => { assert.equal(saved.contactId, 'saved-contact'); });
  } finally { release?.(); await rm(directory, { recursive: true, force: true }); }
});

test('saved recovery state survives refresh, matches exact profile/name, and preserves original owner/date', async () => {
  const f = await fixture({ failTaskRead: true });
  try {
    await f.run();
    const [saved, wrongName, otherProfile] = await attempts.readSalesNavPushStates([lead, { ...lead, name: 'Other Person' }, { ...lead, linkedinUrl: 'https://www.linkedin.com/in/other' }], f.directory);
    assert.equal(saved.resumeContactId, 'contact-1'); assert.equal(saved.pushRetryable, true);
    assert.equal(saved.prospect.linkedinUrl, lead.linkedinUrl); assert.equal(wrongName, null); assert.equal(otherProfile, null);
    const changed = await f.run({ ...payload, taskOwnerId: '31644369' });
    assert.equal(changed.status, 409); assert.match(changed.data.error, /Daniel Beaini/);
    assert.equal(changed.data.ownerId, '37624223');
    assert.equal((await f.run()).status, 200);
  } finally { await f.cleanup(); }
});

test('different people share a company receipt through search-index lag; uncertain company create remains blocked', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'salesnav-company-'));
  const input = { identity: lead.linkedinUrl, prospect, ownerId: payload.taskOwnerId, dueAt: payload.taskDueAt, stateDirectory: directory };
  try {
    let creates = 0;
    const action = () => attempts.withSalesNavPushCompany('example.com', async (knownId, remember) => {
      if (knownId) return knownId;
      creates++; await remember(''); await remember('company-1'); return 'company-1';
    });
    const ids = await Promise.all([input, { ...input, identity: 'https://www.linkedin.com/in/colleague' }].map(item => attempts.withSalesNavPushAttempt(item, action)));
    assert.deepEqual(ids, ['company-1', 'company-1']); assert.equal(creates, 1);
    await attempts.withSalesNavPushAttempt(input, () => attempts.withSalesNavPushCompany('uncertain.com', async (_id, remember) => { await remember(''); }));
    await assert.rejects(attempts.withSalesNavPushAttempt(input, () => attempts.withSalesNavPushCompany('uncertain.com', async () => { throw new Error('must not create'); })), /uncertain/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
