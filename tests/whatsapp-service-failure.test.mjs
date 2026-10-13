import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source = fs.readFileSync('src/components/WhatsAppQuickAction.tsx','utf8') + '\nexport { requestWhatsAppPayload };';
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture(status, body) {
  const exports = {}; let calls = 0;
  vm.runInNewContext(compiled, {exports,require:()=>({}),AbortSignal,Error,Set,Map,Promise,JSON,setTimeout,fetch:async()=>{calls++;return new Response(body,{status});}});
  return {run:()=>exports.requestWhatsAppPayload('test-id'),count:()=>calls};
}
test('an HTML 503 is retried once and enables the loaded-data fallback',async()=>{
  const f=fixture(503,'<html>Service unavailable</html>');
  await assert.rejects(f.run(),e=>e.fallbackAllowed===true && /HTTP 503/.test(e.message));
  assert.equal(f.count(),2);
});
test('permissions and invalid numbers never enable the service-outage fallback',async()=>{
  for(const status of [403,404,422]) {
    const f=fixture(status,JSON.stringify({error:'Blocked'}));
    await assert.rejects(f.run(),e=>e.fallbackAllowed===false);
    assert.equal(f.count(),1);
  }
});
test('demo mode never enables contact outreach through the fallback',async()=>{
  const f=fixture(503,JSON.stringify({error:'WhatsApp outreach is disabled in DEMO_MODE.'}));
  await assert.rejects(f.run(),e=>e.fallbackAllowed===false);
});
