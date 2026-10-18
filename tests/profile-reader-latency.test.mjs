import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('background polling does not nest a three-second menu wait in each attempt', async () => {
  let waits = 0;
  const root = { querySelector: () => null, querySelectorAll: () => [] };
  const context = {
    URL, location: { origin: 'https://www.linkedin.com', href: 'https://www.linkedin.com/sales/lead/PERSON', pathname: '/sales/lead/PERSON' },
    document: { title: '', querySelector: selector => selector === 'main' ? root : null, querySelectorAll: () => [] },
    setTimeout: resolve => { waits++; resolve(); },
  };
  vm.runInNewContext(fs.readFileSync('chrome-companion/profile-dom.js', 'utf8'), context);
  const result = await context.readVisibleLinkedInProfile({}, { waitForMenu: false });
  assert.equal(result.ok, false);
  assert.equal(waits, 0);
  await context.readVisibleLinkedInProfile();
  assert.equal(waits, 15, 'standalone popup keeps its existing menu wait');
});

test('a missing URL times out and the next person is saved without paid or CRM requests', async () => {
  let now = 0;
  const storage = { pairingToken: 'fixture-token' }, timers = [], alarms = [], posts = [], tabs = new Map();
  let nextId = 1;
  const chrome = {
    runtime: { getManifest: () => ({ version: '1.8.2' }), onMessage: { addListener() {} } },
    permissions: { contains: async () => true },
    storage: { local: { get: async keys => structuredClone(Object.fromEntries(keys.map(key => [key, storage[key]]))), set: async value => Object.assign(storage, structuredClone(value)) } },
    alarms: { create: (...args) => alarms.push(args), clear: async () => {}, onAlarm: { addListener() {} } },
    tabs: { create: async ({ url }) => { const tab = { id: nextId++, url, status: 'complete' }; tabs.set(tab.id, tab); return tab; }, get: async id => tabs.get(id), remove: async id => tabs.delete(id) },
    scripting: { executeScript: async ({ args }) => {
      assert.equal(args[1].waitForMenu, false);
      return [{ result: args[0].name === 'Missing' ? { ok: false, error: 'URL unavailable' } : { ok: true, lead: { ...args[0], linkedinUrl: 'https://www.linkedin.com/in/valid-person' } } }];
    } },
  };
  const context = { chrome, URL, AbortSignal, Date: class extends Date { static now() { return now; } },
    importScripts() {}, readVisibleLinkedInProfile() {},
    setTimeout: (callback, delay) => { if (delay === 100) timers.push(callback); else { now += delay; callback(); } },
    fetch: async (url, options) => { posts.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ ok: true, profileSynced: true }) }; },
  };
  vm.runInNewContext(fs.readFileSync('chrome-companion/queue-v160.js', 'utf8'), context);
  const lead = name => ({ name, salesLeadUrl: `https://www.linkedin.com/sales/lead/${name}`, connectionDegree: '2nd' });
  await context.startCapturedProfileChecks([lead('Missing'), lead('Valid')], '', 'fixture-run');
  await timers[0]();
  // The timer starts an async drain; flush its bounded promise chain.
  for (let i = 0; i < 1000 && storage.salesNavWorkQueueV160?.done !== 2; i++) await new Promise(resolve => setImmediate(resolve));
  const queue = storage.salesNavWorkQueueV160;
  assert.equal(queue.done, 2);
  assert.equal(queue.rows[0].status, 'error');
  assert.equal(queue.rows[1].status, 'synced');
  assert.equal(tabs.size, 0);
  assert.ok(now <= 15300, `timeout budget exceeded: ${now}ms`);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.action, 'profile_sync');
  assert.equal(posts[0].body.lead.name, 'Valid');
});
