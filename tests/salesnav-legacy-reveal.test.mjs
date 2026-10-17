import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('legacy Sales Nav reveal delegates the original request and result to the guarded reveal handler', async () => {
  const compiled = ts.transpileModule(fs.readFileSync('src/app/api/prospecting/salesnav/reveal/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const request = { url: 'https://example.com/api/prospecting/salesnav/reveal', body: 'original payload' };
  const result = { status: 409, error: 'Reveal is already reserved.' };
  let calls = 0;
  vm.runInNewContext(compiled, { exports, require: name => {
    assert.equal(name, '../reveal-fast/route');
    return { POST: async forwarded => { calls += 1; assert.equal(forwarded, request); return result; } };
  } });
  assert.equal(await exports.POST(request), result);
  assert.equal(calls, 1);
});
