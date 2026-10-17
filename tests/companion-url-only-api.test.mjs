import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),next=require('next/server'),zod=require('zod');
const source=ts.transpileModule(fs.readFileSync('src/app/api/prospecting/salesnav/companion/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const runId='00000000-0000-4000-8000-000000000001';
const lead={name:'Saved Person',company:'Example',title:'HR Director',salesLeadUrl:'https://www.linkedin.com/sales/lead/SAVED',linkedinUrl:''};
function fixture({synced=true,authorized=true}={}){
 const calls=[],exports={};
 const store={verifyCompanionToken:async()=>authorized,touchCompanionToken:async()=>calls.push('touch'),getCompanionFullRun:async()=>({id:runId,sourceUrl:'https://www.linkedin.com/sales/search/people',leads:[lead,{...lead,linkedinUrl:'https://www.linkedin.com/in/already-saved'}]}),syncCompanionProfile:async(profile,id)=>{calls.push(['sync',profile,id]);return synced;}};
 const modules={'next/server':next,zod,'node:crypto':require('node:crypto'),'@/lib/salesnav-companion':store,'@/lib/salesnav-profile-sync':{publicPersonProfile:raw=>/^https:\/\/www\.linkedin\.com\/in\/[^/?#]+$/.test(raw||'')?raw:''},'@/lib/companion-profile-actions':{handleCompanionProfileAction:async()=>{throw Error('URL-only actions must not call CRM');}},'@/lib/salesnav-session':{},'@/lib/sdr-admin-auth':{sdrAdminAuthorized:()=>false}};
 vm.runInNewContext(source,{exports,require:id=>modules[id]});
 return{calls,post:async body=>{const response=await exports.POST(new next.NextRequest('https://sdr.dashboardtalentera.tech/api/prospecting/salesnav/companion',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)}));return {status:response.status,body:await response.json()};}};
}
test('URL-only run reads return only missing saved identities without a CRM call',async()=>{const f=fixture();const result=await f.post({action:'profile_read_run',runId});assert.equal(result.status,200);assert.equal(result.body.leads.length,1);assert.equal(result.body.leads[0].name,lead.name);assert.equal(f.calls.length,0);});
test('URL sync persists to the exact originating run without HubSpot availability',async()=>{const f=fixture();const result=await f.post({action:'profile_sync',runId,lead:{...lead,linkedinUrl:'https://www.linkedin.com/in/saved-person'}});assert.equal(result.status,200);assert.equal(result.body.profileSynced,true);assert.equal(f.calls[0][2],runId);});
test('unmatched URLs, wrong URL types and unpaired callers cannot report a successful sync',async()=>{assert.equal((await fixture({synced:false}).post({action:'profile_sync',runId,lead:{...lead,linkedinUrl:'https://www.linkedin.com/in/saved-person'}})).status,409);assert.equal((await fixture().post({action:'profile_sync',runId,lead:{...lead,linkedinUrl:lead.salesLeadUrl}})).status,400);assert.equal((await fixture({authorized:false}).post({action:'profile_read_run',runId})).status,401);});
test('Companion cannot reveal contacts or create tasks; work stays in dashboard',async()=>{for(const action of ['profile_reveal','profile_push']){const f=fixture();const result=await f.post({action,lead,revealConfirmed:true,pushConfirmed:true});assert.equal(result.status,409);assert.match(result.body.error,/dashboard/);assert.equal(f.calls.length,0);}});
