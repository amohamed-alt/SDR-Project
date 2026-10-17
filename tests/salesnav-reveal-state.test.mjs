import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
import * as qualification from '../src/lib/ai-sdr-qualification.ts';
import * as identity from '../src/lib/salesnav-identity.ts';
const require=createRequire(import.meta.url),next=require('next/server');
const lead={name:'Saved Person',company:'Example',title:'HR Director',location:'Riyadh',salesLeadUrl:'https://www.linkedin.com/sales/lead/STATE',linkedinUrl:'https://www.linkedin.com/in/saved-person'};
const prospect={fullName:lead.name,providerFullName:lead.name,company:lead.company,linkedinUrl:lead.linkedinUrl,phone:'+962791234567'};
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function fixture(t,{provider,check}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'salesnav-reveal-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'ledger.json'),ledger={};
 vm.runInNewContext(compile('src/lib/salesnav-lead-ledger.ts'),{exports:ledger,require:id=>id==='./salesnav-identity.ts'?identity:require(id),process:{env:{SALESNAV_LEAD_LEDGER_PATH:file}},console,URL,Date,Set,Map});
 let paid=0,checks=0;
 const modules={'next/server':next,zod:require('zod'),'@/lib/ai-sdr-qualification':qualification,'@/lib/salesnav-identity':identity,'@/lib/salesnav-lead-ledger':ledger,
 '@/app/api/prospecting/resolve-companion/route':{POST:async()=>{paid++;return provider?provider(paid):next.NextResponse.json({prospect});}},
 '@/app/api/prospecting/salesnav/precheck-v2/route':{POST:async()=>{checks++;return check?check(checks):next.NextResponse.json({contact:{inHubSpot:false},company:{protected:false}});}}};
 const route={};vm.runInNewContext(compile('src/app/api/prospecting/salesnav/reveal-fast/route.ts'),{exports:route,require:id=>modules[id],console,URL,Date});
 return{ledger,file,counts:()=>({paid,checks}),post:async()=>{const r=await route.POST(new next.NextRequest('https://example.com/api/reveal',{method:'POST',body:JSON.stringify({lead,runId:'run-state'})}));return{status:r.status,body:await r.json()};}};
}
test('atomic reveal reservation sends one paid request for concurrent clicks',async t=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const f=await fixture(t,{provider:async()=>{await gate;return next.NextResponse.json({prospect});}});
 const first=f.post();while(f.counts().paid===0)await new Promise(resolve=>setTimeout(resolve,1));
 const second=await f.post();assert.equal(second.status,409);assert.equal(second.body.revealStatus,'pending');release();assert.equal((await first).status,200);assert.equal(f.counts().paid,1);
 const [saved]=await f.ledger.salesNavLeadStates([lead]);assert.equal(saved.prospect.phone,prospect.phone);assert.equal(saved.revealStatus,'completed');
});
test('a rejected request can be explicitly retried; an uncertain provider outcome cannot charge twice',async t=>{
 const f=await fixture(t,{provider:async count=>count===1?next.NextResponse.json({error:'Quota rejected',creditUsed:false},{status:429}):next.NextResponse.json({prospect})});
 assert.equal((await f.post()).body.revealStatus,'retryable');assert.equal((await f.post()).status,200);assert.equal(f.counts().paid,2);
 const other=await fixture(t,{provider:async()=>next.NextResponse.json({error:'Provider timed out'},{status:504})});
 assert.equal((await other.post()).body.revealStatus,'uncertain');assert.equal((await other.post()).status,409);assert.equal(other.counts().paid,1);
});
test('corrupt durable ledger fails closed before any provider request',async t=>{
 const f=await fixture(t);fs.writeFileSync(f.file,'{corrupt');const r=await f.post();assert.equal(r.status,500);assert.equal(f.counts().paid,0);await assert.rejects(f.ledger.reserveSalesNavReveal({identity:lead}));assert.equal(fs.readFileSync(f.file,'utf8'),'{corrupt');
});
test('saved reveal survives a transient post-reveal HubSpot failure and is reused without another charge',async t=>{
 const f=await fixture(t,{check:async count=>count===2?next.NextResponse.json({error:'HubSpot unavailable'},{status:503}):next.NextResponse.json({contact:{inHubSpot:false},company:{protected:false}})});
 assert.equal((await f.post()).status,500);const [saved]=await f.ledger.salesNavLeadStates([lead]);assert.equal(saved.prospect.phone,prospect.phone);assert.equal(saved.revealStatus,'completed');
 const result=await f.post();assert.equal(result.status,200);assert.equal(result.body.cached,true);assert.equal(f.counts().paid,1);
});
test('a fresh HubSpot blocker stops the paid call and hydration retains completed task results',async t=>{
 const f=await fixture(t,{check:async()=>next.NextResponse.json({contact:{inHubSpot:true},company:{protected:true,protectedReason:'Existing person'}})});
 assert.equal((await f.post()).status,409);assert.equal(f.counts().paid,0);
 await f.ledger.saveSalesNavPush({identity:lead,prospect,taskId:'saved-task',contactId:'saved-contact',runId:'old-run'});
 const [saved]=await f.ledger.salesNavLeadStates([lead]);assert.equal(saved.taskId,'saved-task');assert.equal(saved.contactId,'saved-contact');assert.ok(saved.lastPushAt);assert.equal(saved.prospect.phone,prospect.phone);
});

test('legacy mismatched cached identity is not hydrated as a usable prospect',async t=>{
 const f=await fixture(t);await f.ledger.saveSalesNavReveal({identity:lead,prospect:{...prospect,fullName:'Other Person',providerFullName:'Other Person'},attempted:true});
 const [saved]=await f.ledger.salesNavLeadStates([lead]);assert.equal(saved.prospect,undefined);assert.equal(saved.revealStatus,'uncertain');assert.match(saved.revealError,/manually/);
});
