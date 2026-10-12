import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
const zod = require('zod');
const source = fs.readFileSync('src/lib/companion-profile-actions.ts','utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const lead = { name:'Test Person',title:'HR Director',company:'Example Ltd',linkedinUrl:'https://www.linkedin.com/in/test-person',salesLeadUrl:'https://www.linkedin.com/sales/lead/123' };
const prospect = {fullName:'Test Person',company:'Example Ltd',phone:'+962791234567',linkedinUrl:lead.linkedinUrl,score:60,priority:'high'};
function fixture({existing=false,protectedCompany=false,cached=null,verification=true}={}) {
 const calls=[];
 const adapters = {
  '@/app/api/prospecting/salesnav/precheck-v2/route':{POST:async()=>{calls.push('check');return NextResponse.json({contact:{inHubSpot:existing},company:{protected:protectedCompany,protectedReason:'Retention'}})}},
  '@/app/api/prospecting/salesnav/reveal-fast/route':{POST:async()=>{calls.push('reveal');return NextResponse.json({ok:true,prospect})}},
  '@/app/api/prospecting/salesnav/push-ready-v2/route':{POST:async req=>{calls.push(['push',await req.json(),req.headers.get('cookie')]);return NextResponse.json({ok:true,taskId:'t1',contactId:'c1',ownerName:'Daniel'})}},
  '@/lib/salesnav-lead-ledger':{lookupSalesNavLead:async()=>cached},
  '@/lib/acquisition-routing':{manualTaskOwners:()=>[{id:'31644369',name:'Marita'},{id:'37624223',name:'Daniel'},{id:'other',name:'RM'}]},
  '@/lib/saudi-ats-policy':{usablePhone:v=>v.replace(/\D/g,'').length>=8 && !/^(\d)\1+$/.test(v.replace(/\D/g,''))},
  '@/lib/sdr-admin-auth':{sdrAdminCookieName:()=> 'sdr_admin_access',sdrAdminCookieToken:()=> 'signed-internal-test'},
  '@/lib/hubspot':{batchRead:async()=>[{id:'t1',properties:{hubspot_owner_id:'37624223',hs_timestamp:'2026-10-14T06:00:00Z',hs_task_type:'CALL'}}],readAssociations:async()=>new Map([['t1',verification?['c1']:[]]])},
  '@/lib/company-dedupe':{normalizedCompanyName:v=>v.toLowerCase().replace(/\bltd\b/g,'').trim()},
 };
 const exports={};vm.runInNewContext(compiled,{exports,require:id=>id==='next/server'?{NextRequest,NextResponse}:id==='zod'?zod:adapters[id],URL,Date,Set});
 return {calls,run:async body=>{const request=new NextRequest('https://example.com/api/prospecting/salesnav/companion',{method:'POST',body:JSON.stringify(body)});const response=await exports.handleCompanionProfileAction(request,body);return {status:response?.status,data:response?await response.json():null};}};
}
test('options exposes only the two enabled SDRs',async()=>{const f=fixture();const r=await f.run({action:'profile_options'});assert.deepEqual(r.data.owners.map(x=>x.id),['31644369','37624223']);assert.equal(f.calls.length,0);});
test('missing public URL and tenure-as-title cannot spend credits',async()=>{const f=fixture();for(const change of [{linkedinUrl:''},{title:'4 years in role 4 years in company'}]){const r=await f.run({action:'profile_reveal',lead:{...lead,...change},revealConfirmed:true});assert.equal(r.status,400);}assert.equal(f.calls.length,0);});
test('existing people and protected companies are blocked before reveal',async()=>{for(const options of [{existing:true},{protectedCompany:true}]){const f=fixture(options);const r=await f.run({action:'profile_reveal',lead,revealConfirmed:true});assert.equal(r.status,409);assert.deepEqual(f.calls,['check']);}});
test('checking is free and retrieves the stored reveal',async()=>{const f=fixture({cached:{cachedProspect:prospect,revealAttemptedAt:'now'}});const r=await f.run({action:'profile_check',lead});assert.equal(r.data.hasPhone,true);assert.equal(r.data.cached,true);assert.deepEqual(f.calls,['check']);});
test('reveal needs explicit confirmation and rechecks after reveal',async()=>{let f=fixture();assert.equal((await f.run({action:'profile_reveal',lead})).status,400);assert.deepEqual(f.calls,['check']);f=fixture();const r=await f.run({action:'profile_reveal',lead,revealConfirmed:true});assert.equal(r.status,200);assert.deepEqual(f.calls,['check','reveal','check']);});
test('push accepts only stored usable phones and SDR owners',async()=>{let f=fixture();assert.equal((await f.run({action:'profile_push',lead,pushConfirmed:true,taskOwnerId:'37624223',taskDueAt:'2026-10-14T06:00:00Z',prospect})).status,422);assert.deepEqual(f.calls,['check']);f=fixture({cached:{cachedProspect:prospect}});assert.equal((await f.run({action:'profile_push',lead,pushConfirmed:true,taskOwnerId:'other',taskDueAt:'2026-10-14T06:00:00Z'})).status,400);});
test('push sends the selected SDR and trusted ledger data to the existing safety path',async()=>{const f=fixture({cached:{cachedProspect:prospect}});const r=await f.run({action:'profile_push',lead,pushConfirmed:true,taskOwnerId:'37624223',taskDueAt:'2026-10-14T06:00:00Z',prospect:{phone:'malicious'}});assert.equal(r.status,200);const call=f.calls[1];assert.equal(call[1].prospect.phone,prospect.phone);assert.equal(call[1].prospect.ownerId,'37624223');assert.equal(call[1].prospect.assignmentMode,'acquisition');assert.equal(call[1].taskOwnerId,'37624223');assert.equal(call[2],'sdr_admin_access=signed-internal-test');assert.equal(JSON.stringify(r.data).includes('signed-internal-test'),false);});
test('different provider identity or current employer blocks push',async()=>{for(const change of [{fullName:'Other Person'},{company:'Old Employer'},{linkedinUrl:'https://www.linkedin.com/in/same-name-other-person'}]){const f=fixture({cached:{cachedProspect:{...prospect,...change}}});const r=await f.run({action:'profile_push',lead,pushConfirmed:true,taskOwnerId:'31644369',taskDueAt:'2026-10-14T06:00:00Z'});assert.equal(r.status,409);assert.deepEqual(f.calls,['check']);}});

test('a written task is not reported successful until its contact association is verified',async()=>{const f=fixture({cached:{cachedProspect:prospect},verification:false});const r=await f.run({action:'profile_push',lead,pushConfirmed:true,taskOwnerId:'37624223',taskDueAt:'2026-10-14T06:00:00Z'});assert.equal(r.status,500);assert.match(r.data.error,/Task t1 was written but verification is incomplete/);assert.equal(f.calls.filter(x=>Array.isArray(x)&&x[0]==='push').length,1);});
