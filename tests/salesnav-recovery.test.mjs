import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server.js';
import { loadRoute } from './helpers/load-route.mjs';
import { salesNavLeadId, salesNavAliases } from '../src/lib/salesnav-identity.ts';
import { salesNavSdrOwner } from '../src/lib/salesnav-company-gate.ts';
const request = (body) => new NextRequest('https://example.test/api/test', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const identity = {name:'Same Name',company:'Acme',salesLeadUrl:'https://www.linkedin.com/sales/lead/ACwAbC,NAME?trk=first'};
function journal() {
  const rows = new Map();
  return { rows, operationFingerprint: JSON.stringify,
    lookupOperation: async key => rows.get(key) || {state:'missing',result:{}},
    claimOperation: async (key) => {
      const row = rows.get(key);
      if (row && (row.state==='running' || row.state==='completed' || row.result.pending)) return {claimed:false,...row};
      const next = {state:'running',lease:Math.random().toString(),result:row?.result || {}};
      rows.set(key,next); return {claimed:true,...next};
    },
    checkpointOperation: async (operation,result,state='running') => {
      const row = rows.get(operation.key);
      assert.equal(row.lease,operation.lease); assert.equal(row.state,'running');
      Object.assign(row.result,result); Object.assign(operation.result,result); row.state=state;
    },
  };
}
const eligible = {contact:{inHubSpot:false,id:''},company:{protected:false,inHubSpot:false,engagementChecked:true}};
async function revealFixture(provider) {
  const operations = journal();
  let calls=0;
  const {POST} = await loadRoute('src/app/api/prospecting/salesnav/reveal-fast/route.ts', {
    '@/lib/salesnav-identity':{salesNavLeadId}, '@/lib/salesnav-operations':operations,
    '@/lib/company-dedupe':{normalizedCompanyName:value=>String(value).toLowerCase()},
    '@/lib/sdr-admin-auth':{sdrAdminAuthorized:()=>true},
    '@/app/api/prospecting/resolve-companion/route':{POST:async()=>{calls++;return provider();}},
    '@/app/api/prospecting/salesnav/precheck-v2/route':{POST:async()=>Response.json(eligible)},
    '@/lib/salesnav-lead-ledger':{lookupSalesNavLead:async()=>null,saveSalesNavReveal:async()=>{}},
  });
  return {POST,operations,calls:()=>calls};
}
test('shared identity ignores tracking and display commas without lowercasing opaque IDs',()=>{
  assert.equal(salesNavLeadId(identity),'sales:ACwAbC');
  assert.equal(salesNavLeadId({...identity,salesLeadUrl:identity.salesLeadUrl.replace('trk=first','page=9')}),'sales:ACwAbC');
  assert.notEqual(salesNavLeadId({...identity,salesLeadUrl:'https://www.linkedin.com/sales/lead/OTHER'}),salesNavLeadId(identity));
  assert.equal(salesNavLeadId({name:'Same Name',company:'Acme'}),'');
  assert.deepEqual(salesNavAliases({linkedinUrl:'https://www.linkedin.com/in/Test-Person/?trk=x'}),['li:test-person']);
});
test('two concurrent reveal routes make one provider call and reuse a result lacking a public URL',async()=>{
  const fixture=await revealFixture(async()=>Response.json({prospect:{phone:'+966555555555',fullName:'Same Name'},meta:{creditsLeft:17}}));
  const replies=await Promise.all([fixture.POST(request({lead:identity})),fixture.POST(request({lead:identity}))]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
  assert.equal(fixture.calls(),1);
  const reused=await fixture.POST(request({lead:identity}));
  assert.equal(reused.status,200);const payload=await reused.json();
  assert.equal(payload.cached,true);assert.equal(payload.creditUsed,false);assert.equal(payload.prospect.phone,'+966555555555');assert.equal(fixture.calls(),1);
});
test('timeout after provider dispatch blocks repeat spend and never claims zero cost',async()=>{
  const fixture=await revealFixture(async()=>Response.json({error:'timeout',paidRequestSent:true},{status:504}));
  const first=await fixture.POST(request({lead:identity}));assert.equal(first.status,504);assert.equal((await first.json()).creditUsed,null);
  const retry=await fixture.POST(request({lead:identity}));assert.equal(retry.status,409);assert.equal(fixture.calls(),1);
});
test('known pre-provider failure can retry while a weak identity or first-degree lead cannot spend',async()=>{
  const fixture=await revealFixture(async()=>Response.json({error:'no exact person',paidRequestSent:false},{status:404}));
  await fixture.POST(request({lead:identity}));await fixture.POST(request({lead:identity}));assert.equal(fixture.calls(),2);
  assert.equal((await fixture.POST(request({lead:{name:'A',company:'B'}}))).status,422);
  assert.equal((await fixture.POST(request({lead:{...identity,connectionDegree:'1st'}}))).status,409);
  assert.equal(fixture.calls(),2);
});
test('company protection remains separate from person identity so journal-owned contact can resume',async()=>{
  let upstream = {...eligible,contact:{inHubSpot:true,id:'known'},company:{inHubSpot:true,protected:false,engagementChecked:true}};
  const {POST}=await loadRoute('src/app/api/prospecting/salesnav/precheck-v2/route.ts',{
    '@/app/api/prospecting/signalhire/precheck/route':{POST:async()=>Response.json(upstream)},
  });
  let result=await (await POST(request({name:'A'}))).json();assert.equal(result.contact.inHubSpot,true);assert.equal(result.company.protected,false);
  upstream={...upstream,company:{...upstream.company,connectedCallCount:1}};
  result=await (await POST(request({name:'A'}))).json();assert.equal(result.company.protected,true);
  upstream={...upstream,company:{inHubSpot:true,engagementChecked:false}};
  result=await (await POST(request({name:'A'}))).json();assert.equal(result.company.protected,true);
});
test('ATS not_detected is unknown; explicit verified no-ATS evidence routes Marita',()=>{
  assert.throws(()=>salesNavSdrOwner('','not_detected'),/unverified/);
  assert.equal(salesNavSdrOwner('','no_ats_observed'),'31644369');
});

test('push resumes the journal-owned contact after pre-task failure and schedules without a PATCH',async()=>{
  const operations=journal();const key='push:sales:ACwAbC';const claimed=await operations.claimOperation(key);
  const originalFetch=globalThis.fetch;const originalToken=process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  process.env.HUBSPOT_PRIVATE_APP_TOKEN='test-only';
  let contacts=0,tasks=0,patches=0,taskScan=0;
  const hubspot={
    HubSpotApiError:class extends Error {},
    readAssociations:async()=>new Map(),
    searchAll:async(type)=>{
      if(type==='companies') return [{id:'co',properties:{name:'Acme',domain:'acme.test',hubspot_owner_id:'31644369'}}];
      if(type==='contacts')return [];
      if(type==='tasks'){if(++taskScan===1)throw new Error('scheduler read failed before POST');return [];}
      return [];
    },
    batchRead:async(type,ids)=>ids.map(id=>({id,properties:type==='companies'?{domain:'acme.test',hubspot_owner_id:'31644369'}:type==='contacts'?{phone:'+966555555555',hubspot_owner_id:'31644369'}:{hs_timestamp:'2026-10-12T06:00:00.000Z',hubspot_owner_id:'31644369',hs_task_type:'CALL'}})),
  };
  globalThis.fetch=async(url,init)=>{
    if(init.method==='PATCH')patches++;
    if(String(url).endsWith('/contacts') && init.method==='POST'){contacts++;return Response.json({id:'contact-1'});}
    if(String(url).endsWith('/tasks') && init.method==='POST'){tasks++;return Response.json({id:'task-1'});}
    return Response.json({});
  };
  try{
    const {POST}=await loadRoute('src/app/api/prospecting/push/route.ts',{
      '@/lib/salesnav-operations':operations,
      '@/lib/saudi-ats-policy':{atsProduct:()=>null,SAUDI_DAILY_LIMIT:100,usablePhone:()=>true},
      '@/lib/marita-task-scheduler':{MaritaScheduleError:class extends Error{},createScheduledMaritaTask:async(input)=>{await input.readTasks();return {task:await input.createTask('2026-10-12T06:00:00.000Z'),dueAt:'2026-10-12T06:00:00.000Z'};}},
      '@/lib/sdr-admin-auth':{sdrAdminAuthorized:()=>true},
      '@/lib/acquisition-data-api':{getAcquisitionAccount:async()=>null,listAcquisitionPeople:async()=>({people:[]}),writeAcquisitionPush:async()=>{}},
      '@/lib/saudi-coverage-store':{reserveInventoryOperation:async()=>{},finishInventoryOperation:async()=>{}},
      '@/lib/acquisition-routing':{manualTaskOwners:()=>[{id:'31644369',name:'Marita'}]},
      '@/lib/hubspot':hubspot,
      '@/lib/prospecting-company-intelligence':{normalizeCompanyDomain:value=>String(value||'')},
      '@/lib/company-dedupe':{compatibleCompanyIdentity:()=>true,normalizedCompanyName:value=>value},
    });
    const prospect={fullName:'Same Name',company:'Acme',companyDomain:'acme.test',phone:'+966555555555',score:70,priority:'high',assignmentMode:'acquisition',ownerId:'31644369',salesNavOperation:{key,lease:claimed.lease}};
    const first=await POST(request(prospect));assert.equal(first.status,500);
    assert.equal(operations.rows.get(key).result.contactId,'contact-1');assert.equal(operations.rows.get(key).result.pending,'');
    operations.rows.get(key).state='review';
    const resumed=await operations.claimOperation(key);prospect.salesNavOperation.lease=resumed.lease;
    const next=await POST(request(prospect));assert.equal(next.status,200);const payload=await next.json();
    assert.equal(payload.contactId,'contact-1');assert.equal(payload.taskId,'task-1');assert.equal(contacts,1);assert.equal(tasks,1);assert.equal(patches,0);
    const again=await POST(request(prospect));assert.equal(again.status,200);assert.equal((await again.json()).taskId,'task-1');assert.equal(tasks,1);
  }finally{globalThis.fetch=originalFetch;if(originalToken===undefined)delete process.env.HUBSPOT_PRIVATE_APP_TOKEN;else process.env.HUBSPOT_PRIVATE_APP_TOKEN=originalToken;}
});

test('same-name colleagues have isolated cached phones and a corrupt ledger never resets',async()=>{
  const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sdr-ledger-test-'));
  const previous=process.env.SALESNAV_LEAD_LEDGER_PATH;process.env.SALESNAV_LEAD_LEDGER_PATH=path.join(directory,'ledger.json');
  try{
    const ledger=await loadRoute('src/lib/salesnav-lead-ledger.ts',{'./salesnav-identity':{salesNavAliases}});
    const other={...identity,salesLeadUrl:'https://www.linkedin.com/sales/lead/DIFFERENT'};
    await ledger.saveSalesNavReveal({identity,prospect:{phone:'111'},attempted:true});
    await ledger.saveSalesNavReveal({identity:other,prospect:{phone:'222'},attempted:true});
    assert.equal((await ledger.lookupSalesNavLead(identity)).cachedProspect.phone,'111');
    assert.equal((await ledger.lookupSalesNavLead(other)).cachedProspect.phone,'222');
    await fs.writeFile(process.env.SALESNAV_LEAD_LEDGER_PATH,'{broken');
    await assert.rejects(ledger.saveSalesNavReveal({identity,prospect:{phone:'333'}}));
    assert.equal(await fs.readFile(process.env.SALESNAV_LEAD_LEDGER_PATH,'utf8'),'{broken');
  }finally{if(previous===undefined)delete process.env.SALESNAV_LEAD_LEDGER_PATH;else process.env.SALESNAV_LEAD_LEDGER_PATH=previous;await fs.rm(directory,{recursive:true,force:true});}
});

test('requested date remains inside capacity/workday planning and never patches a full day',async()=>{
  const {planMaritaTask,cairoDate}=await import('../src/lib/marita-task-scheduler.ts');
  const full=Array.from({length:70},(_,i)=>({id:String(i),properties:{hubspot_owner_id:'31644369',hs_task_status:'NOT_STARTED',hs_timestamp:'2026-10-12T06:00:00Z'}}));
  const result=planMaritaTask(full,[],false,new Date('2026-10-11T07:00:00Z'),undefined,'2026-10-12T09:00:00Z');
  assert.equal(cairoDate(result),'2026-10-13');
  const friday=planMaritaTask([],[],false,new Date('2026-10-11T07:00:00Z'),undefined,'2026-10-16T09:00:00Z');
  assert.equal(cairoDate(friday),'2026-10-18');
});

test('legacy URL ledger aliases are reused without spending again on migration',async()=>{
  const fs=await import('node:fs/promises');const os=await import('node:os');const path=await import('node:path');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'sdr-ledger-old-'));
  const previous=process.env.SALESNAV_LEAD_LEDGER_PATH;process.env.SALESNAV_LEAD_LEDGER_PATH=path.join(directory,'ledger.json');
  try{
    const old={key:'old',aliases:[`sales:${identity.salesLeadUrl}`],salesLeadUrl:identity.salesLeadUrl,cachedProspect:{phone:'saved'},revealAttemptedAt:'2026-10-01'};
    await fs.writeFile(process.env.SALESNAV_LEAD_LEDGER_PATH,JSON.stringify({version:1,records:{old}}));
    const ledger=await loadRoute('src/lib/salesnav-lead-ledger.ts',{'./salesnav-identity':{salesNavAliases}});
    const result=await ledger.lookupSalesNavLead({...identity,salesLeadUrl:identity.salesLeadUrl.replace('trk=first','trk=new')});
    assert.equal(result.cachedProspect.phone,'saved');
  }finally{if(previous===undefined)delete process.env.SALESNAV_LEAD_LEDGER_PATH;else process.env.SALESNAV_LEAD_LEDGER_PATH=previous;await fs.rm(directory,{recursive:true,force:true});}
});
