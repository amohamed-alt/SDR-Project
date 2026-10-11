import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSalesNavCompany, salesNavSdrOwner } from '../src/lib/salesnav-company-gate.ts';

function fixture({ connected = false, retention = false, partial = false } = {}) {
  return {
    associations: async (from, to, ids) => new Map(ids.map((id) => [id,
      from === 'companies' && to === 'contacts' ? Array.from({ length: 150 }, (_, i) => `${i}`)
      : from === 'contacts' && id === '149' && to === 'calls' && connected ? ['call']
      : from === 'contacts' && id === '149' && to === 'deals' && retention ? ['deal'] : []])),
    records: async (type, ids) => partial ? [] : ids.map((id) => ({ id, properties: type === 'calls'
      ? { hs_call_disposition: 'f240bbac-87c9-4f6e-bf70-924b57d47db7', hs_timestamp: '2020-01-01' }
      : { pipeline: '1026934003' } })),
  };
}
test('connected call on contact 150 blocks even when years old', async () => {
  const result = await scanSalesNavCompany('company', fixture({ connected: true }));
  assert.equal(result.scannedContactCount, 150);
  assert.equal(result.connectedCallCount, 1);
  assert.equal(result.checked, true);
});
test('Retention deal linked only to a company contact is protected', async () => {
  assert.equal((await scanSalesNavCompany('company', fixture({ retention: true }))).hasRetentionDeal, true);
});
test('partial record read fails closed', async () => {
  await assert.rejects(scanSalesNavCompany('company', fixture({ connected: true, partial: true })), /Incomplete calls/);
});
test('empty graph is eligible and unknown ATS is never assumed absent', async () => {
  assert.equal((await scanSalesNavCompany('company', fixture())).engaged, false);
  assert.equal(salesNavSdrOwner('Workday', 'detected'), '37624223');
  assert.equal(salesNavSdrOwner('', 'no_ats_observed'), '31644369');
  assert.throws(() => salesNavSdrOwner('', ''), /unverified/);
  assert.throws(() => salesNavSdrOwner('Workday', ''), /unverified/);
});

test('strict association reader follows per-company cursors and rejects missing results', async () => {
  const fs = await import('node:fs');
  const ts = await import('typescript');
  const compiled = ts.transpileModule(fs.readFileSync('src/lib/hubspot.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { readCompleteAssociations } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = 'test-placeholder';
  const inputs = [];
  try {
    globalThis.fetch = async (_url, init) => {
      inputs.push(JSON.parse(init.body).inputs);
      return new Response(JSON.stringify({ status: 'COMPLETE', results: [{ from: { id: 'c' },
        to: [{ toObjectId: inputs.length === 1 ? '1' : '2' }],
        ...(inputs.length === 1 ? { paging: { next: { after: 'cursor' } } } : {}),
      }] }), { status: 200 });
    };
    assert.deepEqual((await readCompleteAssociations('companies', 'contacts', ['c'])).get('c'), ['1', '2']);
    assert.deepEqual(inputs[1], [{ id: 'c', after: 'cursor' }]);
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'COMPLETE', results: [] }), { status: 200 });
    await assert.rejects(readCompleteAssociations('companies', 'contacts', ['c']), /Missing/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HUBSPOT_PRIVATE_APP_TOKEN; else process.env.HUBSPOT_PRIVATE_APP_TOKEN = originalToken;
  }
});
