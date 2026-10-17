import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const originalSearch = 'https://www.linkedin.com/sales/search/people?query=original';
const lead = { name: 'Person A', title: 'HR Director', company: 'Example', location: 'Riyadh', salesLeadUrl: 'https://www.linkedin.com/sales/lead/ABC', linkedinUrl: '', connectionDegree: '3rd' };
function fixture({ failSave = false, pageGate } = {}) {
  const storage = { pairingToken: 'test-token' }, calls = [], readers = [], timeoutValues = [];
  let current = { ok: true, sourceUrl: `${originalSearch}&page=2`, leads: [lead] };
  let saveFails = failSave;
  const clone = value => JSON.parse(JSON.stringify(value));
  const chrome = {
    runtime: { getManifest: () => ({ version: '1.7.1' }), onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
    storage: { local: { get: async keys => Object.fromEntries(keys.map(key => [key, storage[key]])), set: async values => Object.assign(storage, clone(values)), remove: async keys => { for (const key of keys) delete storage[key]; } } },
    scripting: { executeScript: async ({ func }) => {
      if (func.name === 'pageIsSalesNavPeopleSearch') return [{ result: true }];
      if (func.name === 'extractCurrentSalesNavPageV154') { if (pageGate) await pageGate; return [{ result: clone(current) }]; }
      if (func.name === 'clickNextSalesNavPageV154') return [{ result: false }];
      throw new Error(`Unexpected script ${func.name}`);
    } },
    tabs: { create: async args => ({ id: 9, ...args }) },
    alarms: { create() {}, clear: async () => {}, get: async () => ({}), onAlarm: { addListener() {} } },
  };
  const context = { chrome, URL, Error, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' }, importScripts() {}, AbortSignal: { timeout: value => { timeoutValues.push(value); return { timeout: value }; } },
    startCapturedProfileChecks: async (...args) => readers.push(clone(args)), isCapturedProfileReaderBusy: () => false,
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); calls.push(body);
      if (body.action === 'full_run_page' && saveFails) throw new Error('Capture save timed out');
      const payload = body.action === 'profile_read_run' ? { ok: true, sourceUrl: originalSearch, leads: [lead] } : { ok: true, total: 1 };
      return { ok: true, text: async () => JSON.stringify(payload) };
    },
  };
  vm.runInNewContext(fs.readFileSync('chrome-companion/background-v154.js', 'utf8'), context);
  return { storage, calls, readers, timeoutValues, context, setPage: value => { current = value; }, recover: () => { saveFails = false; } };
}
function savedRun() { return { runId: '00000000-0000-4000-8000-000000000001', searchFingerprint: originalSearch, sourceUrl: originalSearch, pagesRead: 1, total: 1, signatures: ['previous-person'], lastSignature: 'previous-person', lastPageUrl: `${originalSearch}&page=1`, complete: false, paused: false }; }

test('capture pauses before saving cards if the tab changed search or filters', async () => {
  const f = fixture(); f.storage.salesNavFullRunV1 = savedRun();
  f.setPage({ ok: true, sourceUrl: 'https://www.linkedin.com/sales/search/people?query=other&page=2', leads: [lead] });
  await f.context.processContinuation(4);
  assert.equal(f.calls.length, 0); assert.equal(f.storage.salesNavFullRunV1.paused, true);
  assert.match(f.storage.salesNavFullRunV1.backgroundError, /search or filters changed/);
});
test('capture API requests have a deadline and failures pause without losing saved pages; resume recovers', async () => {
  const f = fixture({ failSave: true }); f.storage.salesNavFullRunV1 = savedRun();
  await f.context.processContinuation(4);
  assert.equal(f.storage.salesNavFullRunV1.pagesRead, 1); assert.equal(f.storage.salesNavFullRunV1.paused, true);
  assert.match(f.storage.salesNavFullRunV1.backgroundError, /timed out/); assert.deepEqual(f.timeoutValues, [20000]);
  assert.equal(f.context.isSalesNavCaptureBusy(), false);
  f.recover(); await f.context.startOrResume(4);
  assert.equal(f.storage.salesNavFullRunV1.complete, true); assert.equal(f.storage.salesNavFullRunV1.paused, false);
});
test('extension capture reads saved missing URLs before completing and handing the exact run to the dashboard', async () => {
  const f = fixture(); await f.context.startOrResume(4, { readProfilesOnComplete: true });
  assert.deepEqual(f.calls.map(call => call.action), ['full_run_page', 'profile_read_run']);
  assert.equal(f.readers.length, 1); assert.equal(f.readers[0][2], f.storage.salesNavFullRunV1.runId);
  assert.equal(f.readers[0][3].afterCapture, true); assert.equal(f.storage.salesNavFullRunV1.complete, false); assert.equal(f.storage.salesNavFullRunV1.cardsComplete, true);
  await f.context.finalizeSalesNavCapture(f.storage.salesNavFullRunV1.runId, { attempted: 1, failed: 0 });
  assert.deepEqual(f.calls.map(call => call.action), ['full_run_page', 'profile_read_run', 'full_run_finish']);
  assert.equal(f.storage.salesNavFullRunV1.complete, true);
});
test('a failed LinkedIn URL read keeps the batch incomplete and does not open the dashboard', async () => {
  const f = fixture(); await f.context.startOrResume(4, { readProfilesOnComplete: true });
  const runId = f.storage.salesNavFullRunV1.runId;
  await f.context.finalizeSalesNavCapture(runId, { attempted: 1, failed: 1 });
  assert.deepEqual(f.calls.map(call => call.action), ['full_run_page', 'profile_read_run']);
  assert.equal(f.storage.salesNavFullRunV1.complete, false);
  assert.equal(f.storage.salesNavFullRunV1.paused, true);
  assert.match(f.storage.salesNavFullRunV1.backgroundError, /LinkedIn URL/);
});
test('legacy capture does not silently opt into URL reading', async () => {
  const f = fixture(); await f.context.startOrResume(4);
  assert.equal(f.readers.length, 0); assert.deepEqual(f.calls.map(call => call.action), ['full_run_page', 'full_run_finish']);
});
test('a second capture start cannot overwrite the first, and stopping during initial page loading cancels it', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); const f = fixture({ pageGate: gate });
  const first = f.context.startOrResume(4, { readProfilesOnComplete: true });
  await assert.rejects(f.context.startOrResume(5), /already busy/);
  await f.context.pauseSalesNavCapture(); release(); await assert.rejects(first, /stopped/);
  assert.equal(f.calls.length, 0); assert.equal(f.readers.length, 0); assert.equal(f.context.isSalesNavCaptureBusy(), false);
});
