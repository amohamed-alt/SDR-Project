import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'salesnav-store-'));
process.env.SALESNAV_COMPANION_FULL_RUN_PATH = join(dir, 'latest.json');
process.env.SALESNAV_COMPANION_HISTORY_DIR = join(dir, 'history');
const { saveCompanionFullRunPage, getCompanionFullRun, finishCompanionFullRun } = await import('../src/lib/salesnav-companion.ts');
after(() => rm(dir, { recursive: true, force: true }));
const lead = (id, query = '') => ({ name: `Person ${id}`, title: 'HR Director', company: 'Company', location: '', connectionDegree: '2nd', salesLeadUrl: `https://www.linkedin.com/sales/lead/${id}${query}`, linkedinUrl: '' });
const input = (id, pageNumber, leads) => ({ id, pageNumber, leads, sourceUrl: 'https://www.linkedin.com/sales/search/people?query=ksa', searchFingerprint: 'ksa' });
test('retrying a page with different tracking URLs does not duplicate people', async () => {
  await saveCompanionFullRunPage(input('retry', 1, [lead(1, '?trk=first')]));
  const run = await saveCompanionFullRunPage(input('retry', 1, [lead(1, '?trk=second')]));
  assert.equal(run.leads.length, 1); assert.equal(run.pagesRead, 1);
});
test('concurrent page uploads retain both pages instead of losing captured leads', async () => {
  await Promise.all([saveCompanionFullRunPage(input('concurrent', 1, [lead(1)])), saveCompanionFullRunPage(input('concurrent', 2, [lead(2)]))]);
  const run = await getCompanionFullRun('concurrent'); assert.equal(run.leads.length, 2); assert.equal(run.pagesRead, 2);
});
test('full-run server caps the queue at 2500 unique leads and retains history', async () => {
  const run = await saveCompanionFullRunPage(input('cap', 100, Array.from({ length: 2505 }, (_, i) => lead(i))));
  assert.equal(run.leads.length, 2500);
  await finishCompanionFullRun('cap', 'Reached cap');
  assert.equal((await getCompanionFullRun('cap')).complete, true);
  assert.equal((await getCompanionFullRun('retry')).leads.length, 1);
});
