import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const code = fs.readFileSync('chrome-companion/background-v154.js', 'utf8');
function harness({ next = 'moved', failSave = false, url = 'https://www.linkedin.com/sales/search/people?query=ksa&page=1' } = {}) {
  const storage = {}; const events = [];
  const page = { ok: true, sourceUrl: url, leads: [{ name: 'Person', company: 'Company', salesLeadUrl: 'https://www.linkedin.com/sales/lead/123', connectionDegree: '2nd' }] };
  const context = vm.createContext({ URL, Date, Number, String, Map, Set, crypto: { randomUUID: () => 'run' },
    chrome: {
      runtime: { getManifest: () => ({ version: '1.5.6' }), onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} } },
      storage: { local: {
        get: async () => structuredClone(storage), set: async value => Object.assign(storage, structuredClone(value)),
        remove: async keys => keys.forEach(key => delete storage[key]),
      } },
      scripting: { executeScript: async ({ func }) => {
        if (func.name === 'pageIsSalesNavPeopleSearch') return [{ result: true }];
        if (func.name === 'extractCurrentSalesNavPageV154') return [{ result: structuredClone(page) }];
        events.push('click'); return [{ result: { status: next } }];
      } },
      alarms: { get: async () => true, clear: async () => {}, create: () => {}, onAlarm: { addListener() {} } },
    },
    fetch: async (_url, init) => {
      const body = JSON.parse(init.body); events.push(body.action);
      if (failSave && body.action === 'full_run_page') throw new Error('offline');
      return { ok: true, text: async () => JSON.stringify({ ok: true, total: 1 }) };
    },
  });
  storage.pairingToken = 'test'; vm.runInContext(code, context);
  return { context, storage, events, page };
}

test('capture persists the page before clicking Next', async () => {
  const h = harness(); await h.context.startOrResume(1);
  assert.deepEqual(h.events, ['full_run_page', 'click']);
  assert.equal(h.storage.salesNavFullRunV1.navigationPending, true);
});
test('save failure never advances pagination', async () => {
  const h = harness({ failSave: true });
  await assert.rejects(h.context.startOrResume(1), /offline/);
  assert.ok(!h.events.includes('click'));
});
test('missing or ambiguous pagination pauses instead of claiming completion', async () => {
  for (const next of ['missing', 'ambiguous']) {
    const h = harness({ next }); await h.context.startOrResume(1);
    assert.equal(h.storage.salesNavFullRunV1.paused, true);
    assert.equal(h.storage.salesNavFullRunV1.complete, false);
    assert.ok(!h.events.includes('full_run_finish'));
  }
});
test('visible disabled Next marks a genuine final page complete', async () => {
  const h = harness({ next: 'end' }); await h.context.startOrResume(1);
  assert.equal(h.storage.salesNavFullRunV1.complete, true);
});
test('changed search filters never append to an old run', async () => {
  const h = harness(); await h.context.startOrResume(1);
  h.page.sourceUrl = 'https://www.linkedin.com/sales/search/people?query=uae&page=2';
  await h.context.processContinuation(1);
  assert.equal(h.storage.salesNavFullRunV1.paused, true);
  assert.equal(h.events.filter(x => x === 'full_run_page').length, 1);
});
test('stale URL transition cannot skip an unsaved page', async () => {
  const h = harness(); await h.context.startOrResume(1);
  h.page.sourceUrl = 'https://www.linkedin.com/sales/search/people?query=ksa&page=2';
  await h.context.processContinuation(1);
  assert.equal(h.storage.salesNavFullRunV1.pagesRead, 1);
  assert.equal(h.events.filter(x => x === 'click').length, 1);
});
test('stuck Next retry is bounded and saved pages are not duplicated', async () => {
  const h = harness(); await h.context.startOrResume(1);
  for (let i = 0; i < 9; i++) await h.context.processContinuation(1);
  assert.equal(h.storage.salesNavFullRunV1.paused, true);
  assert.equal(h.events.filter(x => x === 'click').length, 2);
  assert.equal(h.events.filter(x => x === 'full_run_page').length, 1);
});
test('page signature checks cards beyond the first five', () => {
  const h = harness(); const a = Array.from({ length: 7 }, (_, i) => ({ salesLeadUrl: `https://www.linkedin.com/sales/lead/${i}` }));
  const b = a.map(x => ({ ...x })); b[6].salesLeadUrl = 'https://www.linkedin.com/sales/lead/new';
  assert.notEqual(h.context.pageSignature(a), h.context.pageSignature(b));
});
test('pagination finds a visible Arabic Next and ignores disabled or hidden buttons', () => {
  const h = harness(); let clicks = 0;
  const button = { innerText: 'التالي', getAttribute: () => null, getClientRects: () => [1], click: () => clicks++ };
  h.context.document = { querySelectorAll: () => [{ querySelectorAll: () => [button] }] };
  assert.equal(h.context.clickNextSalesNavPageV154().status, 'moved'); assert.equal(clicks, 1);
  button.getAttribute = key => key === 'aria-disabled' ? 'true' : null;
  assert.equal(h.context.clickNextSalesNavPageV154().status, 'end');
  button.getClientRects = () => [];
  assert.equal(h.context.clickNextSalesNavPageV154().status, 'missing');
});

test('tracking parameters do not create a new page identity', () => {
  const h = harness();
  assert.equal(h.context.leadKey({ salesLeadUrl: 'https://www.linkedin.com/sales/lead/123?trk=one' }), h.context.leadKey({ salesLeadUrl: 'https://www.linkedin.com/sales/lead/123?trk=two' }));
});

test('pagination loops pause rather than advancing forever through saved pages', async () => {
  const h = harness(); await h.context.startOrResume(1);
  const first = structuredClone(h.page);
  h.page.leads[0].salesLeadUrl = 'https://www.linkedin.com/sales/lead/456';
  h.page.sourceUrl = 'https://www.linkedin.com/sales/search/people?query=ksa&page=2';
  await h.context.processContinuation(1);
  Object.assign(h.page, first);
  await h.context.processContinuation(1);
  assert.equal(h.storage.salesNavFullRunV1.paused, true);
  assert.equal(h.events.filter(x => x === 'click').length, 2);
});
