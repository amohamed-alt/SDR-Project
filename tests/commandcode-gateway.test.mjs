import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, rm, writeFile, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('shared CommandCode gateway uses only its key, caches evidence, rejects web tools and enforces persisted limits',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'commandcode-gateway-'));
 const names=['COMMANDCODE_API','COMMANDCODE_API_KEY','COMMANDCODE_GATEWAY_STATE_PATH','COMMANDCODE_FAST_DAILY_LIMIT','OPENROUTER_API_KEY'];
 const original=Object.fromEntries(names.map(n=>[n,process.env[n]]));const originalFetch=globalThis.fetch;
 try{
  Object.assign(process.env,{COMMANDCODE_API:'test-key',COMMANDCODE_GATEWAY_STATE_PATH:join(dir,'state.json'),COMMANDCODE_FAST_DAILY_LIMIT:'1',OPENROUTER_API_KEY:'retired-key'});
  const {commandCodeCompletion,getCommandCodeStatus}=await import('../src/lib/commandcode-gateway.ts');
  let calls=0;
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'https://api.commandcode.ai/provider/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer test-key');assert.equal(JSON.parse(init.body).tools,undefined);return Response.json({choices:[{message:{content:'اختبار رسالة سعودية'}}],usage:{prompt_tokens:10,completion_tokens:5}});};
  const input={cacheKey:'fixture',system:'Use supplied evidence',user:'شركة اختبار',maxOutputTokens:200};
  await assert.rejects(commandCodeCompletion({...input,serverTools:[{type:'web_search'}]}),/does not provide native web/);assert.equal(calls,0);
  assert.equal((await commandCodeCompletion(input)).cached,false);
  assert.equal((await commandCodeCompletion(input)).cached,true);assert.equal(calls,1);
  assert.equal((await getCommandCodeStatus()).provider,'commandcode');
  await assert.rejects(commandCodeCompletion({...input,user:'شركة أخرى'}),/daily safety limit/);
  delete process.env.COMMANDCODE_API;delete process.env.COMMANDCODE_API_KEY;
  await assert.rejects(commandCodeCompletion(input),/not configured/);assert.equal(calls,1);
  process.env.COMMANDCODE_API='test-key';
  await writeFile(process.env.COMMANDCODE_GATEWAY_STATE_PATH,'broken');
  await assert.rejects(commandCodeCompletion(input),/usage storage is unavailable/);
 }finally{globalThis.fetch=originalFetch;for(const n of names){if(original[n]===undefined)delete process.env[n];else process.env[n]=original[n];}await rm(dir,{recursive:true,force:true});}
});
test('production no longer injects the retired gateway; runtime strips legacy keys',async()=>{
 for(const p of ['docker-compose.yml','.github/workflows/deploy-hostinger.yml','.env.example'])assert.doesNotMatch(await readFile(p,'utf8'),/OPENROUTER/);
 const entry=await readFile('docker/sdr-entrypoint.sh','utf8');assert.match(entry,/OPENROUTER_/);assert.doesNotMatch(entry,/DEPLOY_OPENROUTER/);
 const hiring=await readFile('src/lib/hiring-verification.ts','utf8');assert.doesNotMatch(hiring,/Completion\(/);assert.match(hiring,/ambiguous and stale roles are excluded/);
});
