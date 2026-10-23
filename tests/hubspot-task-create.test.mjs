import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/hubspot.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { createFollowupTaskOnce } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('task create resolves association direction and never retries an ambiguous failure', async t => {
  const original = globalThis.fetch;
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  process.env.HUBSPOT_PRIVATE_APP_TOKEN = 'unit-test-token';
  t.after(() => { globalThis.fetch = original; if (token === undefined) delete process.env.HUBSPOT_PRIVATE_APP_TOKEN; else process.env.HUBSPOT_PRIVATE_APP_TOKEN = token; });
  let creates = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/labels')) return Response.json({ results: [{ category: 'HUBSPOT_DEFINED', label: null, typeId: String(url).includes('/contacts/') ? 204 : 216 }] });
    creates++;
    const payload = JSON.parse(init.body);
    assert.equal(payload.properties.hs_task_status, 'NOT_STARTED');
    assert.equal(payload.properties.hs_task_reminders,String(Date.parse('2026-11-01T08:00:00Z')));
    assert.deepEqual(payload.associations.map(a => a.types[0].associationTypeId), [204, 216]);
    return new Response('uncertain server error', { status: 503 });
  };
  await assert.rejects(createFollowupTaskOnce({ contactId: '10', dealId: '20', ownerId: '30', title: 'Follow up', dueAt: '2026-11-01T09:00:00Z', type: 'CALL',reminderAt:'2026-11-01T08:00:00Z' }), /HubSpot request failed/);
  assert.equal(creates, 1);
});
