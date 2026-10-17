import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(name, run) {
  const dir = await mkdtemp(join(tmpdir(), `companion-${name}-`));
  const paths = {
    SALESNAV_COMPANION_STORE_PATH: join(dir, 'pairing.json'),
    SALESNAV_COMPANION_FULL_RUN_PATH: join(dir, 'latest.json'),
    SALESNAV_COMPANION_HISTORY_DIR: join(dir, 'history'),
  };
  const saved = Object.fromEntries(Object.keys(paths).map(key => [key, process.env[key]]));
  Object.assign(process.env, paths);
  try {
    const store = await import(`../src/lib/salesnav-companion.ts?storage-${name}`);
    await run(store, dir);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

const first = '00000000-0000-4000-8000-000000000101';
const second = '00000000-0000-4000-8000-000000000102';
const lead = { name: 'Test Person', title: 'HR Director', company: 'Example', location: 'Riyadh', connectionDegree: '2nd', salesLeadUrl: 'https://www.linkedin.com/sales/lead/ABC,NAME_SEARCH,first', linkedinUrl: '' };
const page = { sourceUrl: 'https://www.linkedin.com/sales/search/people', searchFingerprint: 'saved-search', pageNumber: 1, leads: [lead] };

test('concurrent pairing heartbeats succeed and cannot restore a rotated token', async () => {
  await fixture('pairing', async (store, dir) => {
    const oldToken = await store.generateCompanionToken();
    await Promise.all(Array.from({ length: 16 }, () => store.touchCompanionToken()));
    const requests = [store.touchCompanionToken(), store.generateCompanionToken(), ...Array.from({ length: 16 }, () => store.touchCompanionToken())];
    const [, rotated] = await Promise.all(requests);
    assert.equal(await store.verifyCompanionToken(oldToken), false);
    assert.equal(await store.verifyCompanionToken(rotated), true);
    assert.ok((await store.companionStatus()).lastUsedAt);
    assert.equal((await readdir(dir)).some(file => file.endsWith('.tmp')), false);
  });
});

test('delayed capture pages and finish repair history without selecting an older search', async () => {
  await fixture('late-pages', async store => {
    await store.saveCompanionFullRunPage({ ...page, id: first });
    await store.saveCompanionFullRunPage({ ...page, id: second, leads: [{ ...lead, name: 'New Search Person', salesLeadUrl: 'https://www.linkedin.com/sales/lead/NEW' }] });
    await store.saveCompanionFullRunPage({ ...page, id: first, pageNumber: 2, leads: [{ ...lead, name: 'Old Search Page Two', salesLeadUrl: 'https://www.linkedin.com/sales/lead/OLD-TWO' }] });
    assert.equal((await store.getLatestCompanionFullRun()).id, second);
    await store.finishCompanionFullRun(first, 'Delayed completion');
    const archived = await store.getCompanionFullRun(first);
    assert.equal(archived.pagesRead, 2);
    assert.equal(archived.leads.length, 2);
    assert.equal(archived.complete, true);
    const latest = await store.getLatestCompanionFullRun();
    assert.equal(latest.id, second);
    assert.equal(latest.leads[0].name, 'New Search Person');
    assert.equal(latest.complete, false);
  });
});

test('repeated capture deduplicates the stable Sales Nav identity and preserves a synced public URL', async () => {
  await fixture('stable-person', async store => {
    await store.saveCompanionFullRunPage({ ...page, id: first });
    await store.saveCompanionFullRunPage({ ...page, id: first, pageNumber: 2, leads: [{ ...lead, salesLeadUrl: 'https://www.linkedin.com/sales/lead/ABC,NAME_SEARCH,second?trk=other', linkedinUrl: 'https://www.linkedin.com/in/test-person/?trk=profile' }] });
    let run = await store.getCompanionFullRun(first);
    assert.equal(run.leads.length, 1);
    assert.equal(run.leads[0].linkedinUrl, 'https://www.linkedin.com/in/test-person');
    await store.saveCompanionFullRunPage({ ...page, id: first, pageNumber: 3, leads: [{ ...lead, salesLeadUrl: 'https://www.linkedin.com/sales/lead/ABC,PROFILE,third', linkedinUrl: 'https://www.linkedin.com/in/conflicting-person' }] });
    run = await store.getCompanionFullRun(first);
    assert.equal(run.leads.length, 1);
    assert.equal(run.pagesRead, 3);
    assert.equal(run.leads[0].linkedinUrl, 'https://www.linkedin.com/in/test-person');
  });
});
