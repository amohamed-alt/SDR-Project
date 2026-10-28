import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { outreachBrand, parseOutreachDraft } from '../src/lib/task-outreach.ts';
import { commandCodeOutreach } from '../src/lib/commandcode-outreach.ts';
const draft = {
 hook: 'كيف ترتبون متابعة المرشحين عندكم؟',
 connection: 'السلام عليكم أحمد حبيت أتواصل معك بحكم شغلك في التوظيف أنا من Talentera ويسعدني نتبادل الأفكار',
 message: 'يعطيك العافية أحمد وشكرًا لقبول الإضافة كيف ترتبون متابعة المرشحين عندكم؟ إذا مناسب أشاركك الفكرة باختصار',
};
test('copy validation rejects overlong notes, wrong brands, non-Arabic and malformed output', () => {
 assert.deepEqual(parseOutreachDraft(JSON.stringify(draft), 'Talentera'), draft);
 assert.equal(outreachBrand('37624223'), 'Evalufy');
 assert.equal(outreachBrand('31644369'), 'Talentera');
 assert.equal(outreachBrand('unassigned'), null);
 for (const bad of [{...draft,connection:'أ'.repeat(201)}, {...draft,message:'رسالة من Evalufy لقياس مهارات المرشحين'}, {...draft,hook:'How is hiring today?'}, {...draft,message:'افتح https://evil.test الآن للحصول على العرض'}]) {
  assert.throws(()=>parseOutreachDraft(JSON.stringify(bad),'Talentera'));
 }
 assert.throws(()=>parseOutreachDraft('not json','Talentera'));
});
test('provider coalesces clicks, persists cache, reserves a daily budget and hides upstream errors', async () => {
 const dir=await mkdtemp(join(tmpdir(),'outreach-test-'));
 const names=['COMMANDCODE_API','COMMANDCODE_MODEL','COMMANDCODE_STATE_PATH','COMMANDCODE_DAILY_LIMIT'];
 const original=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const originalFetch=globalThis.fetch;
 try {
  Object.assign(process.env,{COMMANDCODE_API:'test-secret',COMMANDCODE_MODEL:'test-model',COMMANDCODE_STATE_PATH:join(dir,'state.json'),COMMANDCODE_DAILY_LIMIT:'2'});
  let calls=0;
  globalThis.fetch=async (url,init)=>{
   calls++;
   assert.equal(url,'https://api.commandcode.ai/provider/v1/chat/completions');
   const body=JSON.parse(init.body);
   assert.equal(init.headers.Authorization,'Bearer test-secret');
   assert.equal(body.max_tokens,900);
   assert.ok(!body.messages[1].content.includes('contactId'));
   return Response.json({choices:[{message:{content:JSON.stringify(draft)},finish_reason:'stop'}]});
  };
  const evidence={contactId:'123',firstName:'أحمد',company:'شركة اختبار',title:'مدير التوظيف',brand:'Talentera'};
  await Promise.all([commandCodeOutreach(evidence),commandCodeOutreach(evidence)]);
  assert.equal(calls,1);
  assert.equal((await commandCodeOutreach(evidence)).cached,true);
  assert.equal(calls,1);
  globalThis.fetch=async()=>{calls++;return new Response('sensitive upstream body',{status:401});};
  await assert.rejects(commandCodeOutreach({...evidence,title:'مدير الموارد البشرية'}), /HTTP 401/);
  await assert.rejects(commandCodeOutreach({...evidence,company:'شركة أخرى'}), /daily message limit/);
  assert.equal(calls,2);
  // Cached results remain available after the quota is exhausted.
  assert.equal((await commandCodeOutreach(evidence)).cached,true);
 } finally {
  globalThis.fetch=originalFetch;
  for (const n of names) { if(original[n]===undefined)delete process.env[n];else process.env[n]=original[n]; }
  await rm(dir,{recursive:true,force:true});
 }
});
