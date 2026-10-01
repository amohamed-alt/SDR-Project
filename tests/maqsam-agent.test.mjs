import assert from 'node:assert/strict';
import test from 'node:test';
import { maqsamAgentKey, isCompletedMaqsamCall } from '../src/lib/maqsam-agent.mjs';
import { targetAgentForCall, isEligibleCall, fetchCalls } from '../scripts/maqsam-sync.mjs';

test('SDRs use exact email or full name; unknown agents are never assigned to Marita', () => {
  assert.equal(maqsamAgentKey({ agentEmail: ' M.CHEDID@BAYT.NET ' }), 'marita');
  assert.equal(maqsamAgentKey({ agentName: 'Daniel  Beaini' }), 'daniel');
  assert.equal(maqsamAgentKey({ agentEmail: 'D.BEAINI@TALENTERA.COM', agentName: 'D. Beaini' }), 'daniel');
  assert.equal(maqsamAgentKey({ email: 'verified@example.test' }, { danielEmail: 'verified@example.test' }), 'daniel');
  assert.equal(maqsamAgentKey({ agentName: 'Daniel Other' }), 'unknown');
  assert.equal(maqsamAgentKey({}), 'unknown');
  const agent = { name: 'Daniel Beaini', email: 'real@example.test' };
  assert.deepEqual(targetAgentForCall({ agents: [{ name: 'Other agent' }, agent] }), agent);
  assert.equal(targetAgentForCall({ agents: [{ name: 'Other agent' }] }), undefined);
});

test('serviced calls count as completed; unanswered and unknown states do not', () => {
  for (const state of ['completed', 'serviced', 'answered', 'connected']) assert.ok(isCompletedMaqsamCall({ state }));
  for (const state of ['unanswered', 'not_completed', 'missed', '']) assert.equal(isCompletedMaqsamCall({ state }), false);
});

test('call sync keeps external attempts even without summaries; excludes internal calls', () => {
  assert.equal(isEligibleCall({ type: 'outbound', state: 'unanswered' }), true);
  assert.equal(isEligibleCall({ type: 'inbound', state: 'serviced', summary: null }), true);
  assert.equal(isEligibleCall({ type: 'internal', state: 'completed' }), false);
});

test('history scans every page, deduplicates IDs and fails closed on incomplete pagination', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }], []];
    let index = 0;
    globalThis.fetch = async (url) => {
      const query = new URL(url).searchParams;
      assert.equal(query.get('start_time'), '100');
      assert.equal(query.get('end_time'), '200');
      assert.equal(query.get('page'), String(index + 1));
      return new Response(JSON.stringify({ message: pages[index++] }));
    };
    assert.deepEqual((await fetchCalls(100, 200, 'Basic test', 4)).map(call => call.id), [1, 2, 3]);
    globalThis.fetch = async () => new Response(JSON.stringify({ message: [{ id: 1 }] }));
    await assert.rejects(fetchCalls(100, 200, 'Basic test', 4), /pagination did not advance/);
    await assert.rejects(fetchCalls(100, 200, 'Basic test', 1), /page limit reached/);
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'unexpected' }));
    await assert.rejects(fetchCalls(100, 200, 'Basic test', 4), /Unexpected Maqsam/);
  } finally { globalThis.fetch = originalFetch; }
});
