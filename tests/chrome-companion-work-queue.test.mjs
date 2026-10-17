import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const sample={name:'Person A',title:'HR Director',company:'Example',location:'Riyadh',connectionDegree:'3rd',salesLeadUrl:'https://www.linkedin.com/sales/lead/ABC,SEARCH,x',linkedinUrl:''};
function fixture({allowed=true,syncOk=true,profileError='',captureBusy=false}={}){
 const storage={pairingToken:'test-token'},messages=[],alarms=[],calls=[],opened=[],closed=[],finalized=[];
 const chrome={storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,storage[k]])),set:async v=>Object.assign(storage,JSON.parse(JSON.stringify(v)))}},runtime:{getManifest:()=>({version:'1.7.0'}),onMessage:{addListener:fn=>messages.push(fn)}},permissions:{contains:async()=>allowed},tabs:{create:async args=>(opened.push(args),{id:opened.length}),get:async()=>({status:'complete'}),remove:async id=>closed.push(id)},scripting:{executeScript:async args=>[{result:profileError?{ok:false,error:profileError}:{ok:true,lead:{...args.args[0],linkedinUrl:'https://www.linkedin.com/in/'+args.args[0].name.replaceAll(' ','-')}}}]},alarms:{create:()=>{},clear:async()=>{},onAlarm:{addListener:fn=>alarms.push(fn)}}};
 const fetch=async(url,args)=>{calls.push(JSON.parse(args.body));return {ok:true,json:async()=>({ok:true,profileSynced:syncOk})};};
 const context={chrome,fetch,URL,Map,Date,Promise,AbortSignal,importScripts:()=>{},readVisibleLinkedInProfile:()=>{},setTimeout:f=>f(),isSalesNavCaptureBusy:()=>captureBusy,finalizeSalesNavCapture:async(...args)=>finalized.push(args)};vm.runInNewContext(fs.readFileSync('chrome-companion/queue-v160.js','utf8'),context);
 async function drain(){for(let i=0;i<100;i++){alarms.forEach(fn=>fn({name:'salesnav-work-queue-v160'}));await new Promise(r=>setImmediate(r));const q=storage.salesNavWorkQueueV160;if(q&&(!q.pending.length||q.paused))return q;}throw Error('Queue stalled');}
 return {storage,calls,opened,closed,finalized,drain,start:context.startCapturedProfileChecks,stop:context.stopCapturedProfileChecks,message:body=>new Promise(resolve=>messages[0](body,{},resolve))};
}
test('URL reading syncs every saved identity without any HubSpot, reveal or push request',async()=>{
 const f=fixture();await f.start([sample,{...sample,name:'Person B',salesLeadUrl:'https://www.linkedin.com/sales/lead/DEF'}],'search','00000000-0000-4000-8000-000000000001');
 const q=await f.drain();assert.equal(q.done,2);assert.ok(q.rows.every(row=>row.status==='synced'));assert.equal(f.opened.length,2);assert.equal(f.closed.length,2);assert.ok(f.opened.every(tab=>tab.active===false));
 assert.deepEqual(f.calls.map(call=>call.action),['profile_sync','profile_sync']);assert.ok(f.calls.every(call=>call.runId===q.captureRunId));assert.equal(f.calls[0].lead.salesLeadUrl,sample.salesLeadUrl);
});
test('unmatched URL save is a visible error and cannot be counted as a synced profile',async()=>{
 const f=fixture({syncOk:false});await f.start([sample],'search','run');const q=await f.drain();assert.equal(q.rows[0].status,'error');assert.match(q.rows[0].error,/could not be saved/);assert.equal(q.rows[0].lead.linkedinUrl,'https://www.linkedin.com/in/Person-A');
});
test('denied access and sign-in pause reading, retain remaining work and never spend credits',async()=>{
 for(const options of [{allowed:false},{profileError:'LinkedIn sign-in or verification is required.'}]){
 const f=fixture(options);await f.start([sample,{...sample,salesLeadUrl:'https://www.linkedin.com/sales/lead/OTHER'}],'search','run');const q=await f.drain();assert.equal(q.paused,true);assert.equal(q.pending.length,1);assert.equal(q.rows[0].status,'error');assert.equal(f.calls.length,0);
 }
});
test('legacy popup queue commands cannot reveal contacts or create SDR tasks',async()=>{
 const f=fixture();for(const action of ['check','reveal','push']){const r=await f.message({type:'work_queue_start',action,confirmed:true});assert.equal(r.ok,false);assert.match(r.error,/dashboard/);}assert.equal(f.calls.length,0);
});
test('full-search capture saves cards independently and never waits on CRM/profile queue',()=>{
 const source=fs.readFileSync('chrome-companion/background-v154.js','utf8');assert.doesNotMatch(source,/appendCapturedProfileChecks|ensureCapturedProfileQueueIdle|action: 'profile_options'/);assert.match(source,/await savePage/);assert.match(source,/run\.paused/);
});
test('reader drains multiple profiles continuously without requiring an alarm per person',async()=>{
 const f=fixture();await f.start([sample,{...sample,name:'Person B',salesLeadUrl:'https://www.linkedin.com/sales/lead/DEF'}],'search','run');
 for(let i=0;i<100&&f.storage.salesNavWorkQueueV160?.done!==2;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(f.storage.salesNavWorkQueueV160.done,2);assert.equal(f.opened.length,2);assert.equal(f.storage.salesNavReaderProgressV1.phase,'finished');
});
test('extension capture is finalized only after every queued profile URL attempt completes',async()=>{
 const f=fixture();await f.start([sample,{...sample,name:'Person B',salesLeadUrl:'https://www.linkedin.com/sales/lead/DEF'}],'search','run',{afterCapture:true});
 assert.equal(f.finalized.length,0);await f.drain();assert.equal(f.finalized.length,1);assert.equal(f.finalized[0][0],'run');assert.equal(f.finalized[0][1].attempted,2);assert.equal(f.finalized[0][1].failed,0);
});
test('cards-complete capture hands its own run to the URL reader while capture start is still unwinding',async()=>{
 const f=fixture({captureBusy:true});f.storage.salesNavFullRunV1={runId:'run',complete:false,cardsComplete:true,paused:false};
 await f.start([sample],'search','run',{afterCapture:true});const q=await f.drain();assert.equal(q.rows[0].status,'synced');assert.equal(f.finalized.length,1);
});
test('concurrent reader starts cannot replace one another and capture owns the browser until paused or finished',async()=>{
 const f=fixture();const results=await Promise.allSettled([f.start([sample],'search','first'),f.start([sample],'search','second')]);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);await f.drain();
 const blocked=fixture();blocked.storage.salesNavFullRunV1={runId:'capture',complete:false,paused:false};
 await assert.rejects(blocked.start([sample],'search','run'),/capture is running/);assert.equal(blocked.opened.length,0);
});
