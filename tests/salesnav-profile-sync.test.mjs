import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publicPersonProfile, mergeCapturedProfile } from '../src/lib/salesnav-profile-sync.ts';
const lead = {name:'Test Person',title:'HR Director',company:'Example',location:'Riyadh',connectionDegree:'2nd',salesLeadUrl:'https://www.linkedin.com/sales/lead/ACwAAA,NAME_SEARCH,x',linkedinUrl:''};
const profile = {...lead,linkedinUrl:'https://www.linkedin.com/in/test-person/?trk=nav',salesLeadUrl:'https://www.linkedin.com/sales/lead/ACwAAA,PROFILE,x'};

test('public identity accepts only actual HTTPS LinkedIn person profiles',()=>{
 assert.equal(publicPersonProfile(profile.linkedinUrl),'https://www.linkedin.com/in/test-person');
 for(const url of [lead.salesLeadUrl,'https://linkedin.com/company/test','https://linkedin.com.evil.test/in/test','http://linkedin.com/in/test','']) assert.equal(publicPersonProfile(url),'');
});
test('profile handoff matches exact Sales Nav identity and person name, never company or name alone',()=>{
 const result=mergeCapturedProfile([lead],profile);assert.equal(result.synced,true);assert.equal(result.leads.length,1);assert.equal(result.leads[0].linkedinUrl,'https://www.linkedin.com/in/test-person');assert.equal(lead.linkedinUrl,'');
 for(const patch of [{name:'Other Person'},{salesLeadUrl:'https://www.linkedin.com/sales/lead/OTHER'},{salesLeadUrl:''},{linkedinUrl:lead.salesLeadUrl}]) assert.equal(mergeCapturedProfile([lead],{...profile,...patch}).synced,false);
 assert.throws(()=>mergeCapturedProfile([{...lead,linkedinUrl:'https://www.linkedin.com/in/other'}],profile),/different public LinkedIn/);
});
test('free checks repair a finished saved run without duplicates, losing pages, or changing capture completion',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'salesnav-profile-sync-'));
 const keys=['SALESNAV_COMPANION_FULL_RUN_PATH','SALESNAV_COMPANION_HISTORY_DIR'];const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  process.env.SALESNAV_COMPANION_FULL_RUN_PATH=join(dir,'latest.json');process.env.SALESNAV_COMPANION_HISTORY_DIR=join(dir,'history');
  const store=await import('../src/lib/salesnav-companion.ts?profile-sync-test');
  const input={id:'00000000-0000-4000-8000-000000000001',sourceUrl:'https://www.linkedin.com/sales/search/people',searchFingerprint:'sample',pageNumber:1,leads:[lead]};
  await store.saveCompanionFullRunPage(input);assert.equal(await store.syncCompanionProfile(profile,'00000000-0000-4000-8000-000000000099'),false,'a stale repair cannot change another run');assert.equal(await store.syncCompanionProfile(profile),true,'profiles sync during active capture');
  assert.equal((await store.getLatestCompanionFullRun()).complete,false);
  await Promise.all([store.saveCompanionFullRunPage({...input,pageNumber:2,leads:[{...lead,name:'Next Page Person',salesLeadUrl:'https://www.linkedin.com/sales/lead/NEXT'}]}),store.syncCompanionProfile(profile)]);
  const activeRun=await store.getLatestCompanionFullRun();assert.equal(activeRun.pagesRead,2);assert.equal(activeRun.leads.length,2);assert.equal(activeRun.leads[0].linkedinUrl,'https://www.linkedin.com/in/test-person');

  await store.finishCompanionFullRun(input.id,'No next page');
  await Promise.all([store.syncCompanionProfile(profile),store.syncCompanionProfile(profile)]);
  const run=await store.getLatestCompanionFullRun();assert.equal(run.leads.length,2);assert.equal(run.leads[0].linkedinUrl,'https://www.linkedin.com/in/test-person');assert.equal(run.complete,true);assert.equal(run.pagesRead,2);assert.equal(run.stopReason,'No next page');
  await store.saveCompanionFullRunPage(input);assert.equal((await store.getLatestCompanionFullRun()).leads.length,2);assert.equal((await store.getLatestCompanionFullRun()).leads[0].linkedinUrl,'https://www.linkedin.com/in/test-person');await store.finishCompanionFullRun(input.id,'No next page');
  const archived=await store.getCompanionFullRun(input.id);assert.equal(archived.leads[0].linkedinUrl,run.leads[0].linkedinUrl);
  await store.saveCompanionFullRunPage({...input,id:'00000000-0000-4000-8000-000000000002',leads:[{...lead,name:'Other Person',salesLeadUrl:'https://www.linkedin.com/sales/lead/OTHER'}]});await store.finishCompanionFullRun('00000000-0000-4000-8000-000000000002','Done');
  assert.equal(await store.syncCompanionProfile(profile),false);assert.equal((await store.getLatestCompanionFullRun()).id,'00000000-0000-4000-8000-000000000002');
 } finally {for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}await rm(dir,{recursive:true,force:true});}
});
