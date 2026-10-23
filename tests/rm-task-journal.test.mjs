import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJournaledTask } from '../src/lib/rm-task-journal.ts';

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'rm-task-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let creates = 0, checks = 0, verifies = 0;
  const input = { directory, key: 'meeting:1:rm:2', payload: { dueAt: '2026-11-01T09:00:00Z' }, check: async () => { checks++; }, create: async () => { creates++; return { id: '123' }; }, verify: async id => { verifies++; return { id }; } };
  return { input, counts: () => ({ creates, checks, verifies }) };
}

test('a repeated request reads the persisted task and never creates a second task', async t => {
  const f = await fixture(t);
  assert.equal((await createJournaledTask(f.input)).reused, false);
  assert.equal((await createJournaledTask(f.input)).reused, true);
  assert.deepEqual(f.counts(), { creates: 1, checks: 1, verifies: 2 });
});
test('an uncertain create stays blocked across later requests', async t => {
  const f = await fixture(t);
  await assert.rejects(createJournaledTask({ ...f.input, create: async () => { throw new Error('timeout after commit'); } }), /timeout/);
  await assert.rejects(createJournaledTask(f.input), /previous task create could not be confirmed/);
  assert.equal(f.counts().creates, 0);
});
test('a read-back failure retries verification of the saved ID without creating again', async t => {
  const f = await fixture(t);
  await assert.rejects(createJournaledTask({ ...f.input, verify: async () => { throw new Error('read failed'); } }), /read failed/);
  assert.equal((await createJournaledTask(f.input)).task.id, '123');
  assert.equal(f.counts().creates, 1);
});
test('changing a payload after creation cannot create or silently claim success', async t => {
  const f = await fixture(t);
  await createJournaledTask(f.input);
  await assert.rejects(createJournaledTask({ ...f.input, payload: { dueAt: '2026-11-02T09:00:00Z' } }), /already has dashboard task 123/);
  assert.equal(f.counts().creates, 1);
});
test('failed eligibility checks do not reserve a task create', async t => {
  const f = await fixture(t);
  await assert.rejects(createJournaledTask({ ...f.input, check: async () => { throw new Error('existing open task'); } }), /existing open task/);
  assert.equal((await createJournaledTask(f.input)).task.id, '123');
  assert.equal(f.counts().creates, 1);
});
test('different meetings for the same RM cannot create concurrently', async t => {
  const f = await fixture(t);
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  let started;
  const signal = new Promise(resolve => { started = resolve; });
  const first = createJournaledTask({ ...f.input, lockKey: 'rm:2', create: async () => { started(); await hold; return { id: '123' }; } });
  await signal;
  await assert.rejects(createJournaledTask({ ...f.input, key: 'another-meeting', lockKey: 'rm:2' }), /busy or interrupted/);
  release(); await first;
});
