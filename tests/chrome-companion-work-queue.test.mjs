import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const sample={name:'Person A',title:'HR Director',company:'Example Company',location:'Amman, Jordan',connectionDegree:'3rd',salesLeadUrl:'https://www.linkedin.com/sales/lead/123,NAME_SEARCH,456',linkedinUrl:''};
function fixture({allowed=true,blocked=false,checkGate=null,profileSynced=true}={}){
 const storage={pairingToken:'test-token'},messages=[],alarms=[],opened=[],closed=[],calls=[];
 const chrome={storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,storage[k]])),set:async v=>Object.assign(storage,JSON.parse(JSON.stringify(v)))}},runtime:{getManifest:()=>({version:'1.6.0'}),onMessage:{addListener:fn=>messages.push(fn)}},permissions:{contains:async()=>allowed},tabs:{create:async args=>(opened.push(args),{id:100}),get:async()=>({status:'complete'}),remove:async id=>closed.push(id)},scripting:{executeScript:async args=>args.files?[]:[{result:args.target.tabId===9?{ok:true,sourceUrl:'https://www.linkedin.com/sales/search/people',leads:[sample]}:{ok:true,lead:{...sample,linkedinUrl:'https://www.linkedin.com/in/person-a'}}}]},alarms:{create:()=>{},clear:async()=>{},onAlarm:{addListener:fn=>alarms.push(fn)}}};
 const fetch=async(url,args)=>{const body=JSON.parse(args.body);calls.push(body);if(body.action==='profile_check' && checkGate)await checkGate;return {ok:true,json:async()=>body.action==='profile_options'?{ok:true,owners:[]}:body.action==='profile_check'?{ok:true,profileSynced,check:{eligible:!blocked,company:{protected:blocked}},hasPhone:false}:body.action==='profile_reveal'?{ok:true,check:{eligible:true},prospect:{phone:'+962791234567'},hasPhone:true}: body.action==='import'?{ok:true,runId:'00000000-0000-4000-8000-000000000021'}:{ok:true,verified:true,taskId:'t1',ownerName:'Daniel'}};};
 const context={chrome,fetch,URL,Map,Date,Promise,AbortSignal,importScripts:()=>{},extractCurrentSalesNavPageV154:()=>{},readVisibleLinkedInProfile:()=>{},dedupe:arr=>arr,setTimeout:f=>f()};
 vm.runInNewContext(fs.readFileSync('chrome-companion/queue-v160.js','utf8'),context);
 const message=body=>new Promise(resolve=>messages[0](body,{},resolve));
 const drain=async()=>{alarms.forEach(fn=>fn({name:'salesnav-work-queue-v160'}));for(let i=0;i<60;i++){await new Promise(r=>setImmediate(r));if(!storage.salesNavWorkQueueV160.pending.length)break;}return storage.salesNavWorkQueueV160;};
 return {storage,message,drain,opened,closed,calls,append:context.appendCapturedProfileChecks};
}
test('current-page capture is free; profile check opens and closes a temporary tab without moving the search',async()=>{const f=fixture();const captured=await f.message({type:'work_queue_capture',tabId:9});assert.equal(captured.queue.rows.length,1);assert.equal(f.calls.length,0);const key=captured.queue.rows[0].key;await f.message({type:'work_queue_start',action:'check',keys:[key]});const result=await f.drain();assert.equal(result.rows[0].status,'needs-reveal');assert.equal(result.rows[0].lead.linkedinUrl,'https://www.linkedin.com/in/person-a');assert.equal(f.opened[0].active,false);assert.deepEqual(f.closed,[100]);assert.deepEqual(f.calls.map(x=>x.action),['profile_check']);});
test('reveal and push require checked rows and explicit confirmation, and preserve the chosen owner/time',async()=>{const f=fixture();const captured=await f.message({type:'work_queue_capture',tabId:9});const key=captured.queue.rows[0].key;assert.equal((await f.message({type:'work_queue_start',action:'reveal',keys:[key],confirmed:true})).ok,false);await f.message({type:'work_queue_start',action:'check',keys:[key]});await f.drain();assert.equal((await f.message({type:'work_queue_start',action:'reveal',keys:[key]})).ok,false);await f.message({type:'work_queue_start',action:'reveal',keys:[key],confirmed:true});assert.equal((await f.drain()).rows[0].status,'ready');await f.message({type:'work_queue_start',action:'push',keys:[key],confirmed:true,ownerId:'37624223',dueAt:'2026-10-14T06:00:00Z'});assert.equal((await f.drain()).rows[0].status,'pushed');assert.equal(f.calls.at(-1).taskOwnerId,'37624223');assert.equal(f.calls.at(-1).taskDueAt,'2026-10-14T06:00:00Z');assert.equal(f.calls.filter(x=>x.action==='profile_reveal').length,1);});
test('protected people cannot reach reveal and denied LinkedIn access never creates a profile tab',async()=>{const f=fixture({blocked:true});const captured=await f.message({type:'work_queue_capture',tabId:9});const key=captured.queue.rows[0].key;await f.message({type:'work_queue_start',action:'check',keys:[key]});assert.equal((await f.drain()).rows[0].status,'blocked');assert.equal((await f.message({type:'work_queue_start',action:'reveal',keys:[key],confirmed:true})).ok,false);const denied=fixture({allowed:false});const r=await denied.message({type:'work_queue_capture',tabId:9});await denied.message({type:'work_queue_start',action:'check',keys:[r.queue.rows[0].key]});assert.equal((await denied.drain()).rows[0].status,'error');assert.equal(denied.opened.length,0);assert.equal(denied.calls.length,0);});
test('Current 25 automatically saves a dashboard run then reads public URLs without revealing or pushing',async()=>{
 const f=fixture();
 const captured=await f.message({type:'work_queue_capture',tabId:9,readProfiles:true});
 assert.equal(captured.ok,true);
 const result=await f.drain();
 assert.equal(result.rows[0].status,'needs-reveal');
 assert.equal(result.rows[0].lead.linkedinUrl,'https://www.linkedin.com/in/person-a');
 assert.deepEqual(f.calls.map(x=>x.action),['profile_options','import','profile_check']);
 assert.equal(f.calls[1].leads[0].salesLeadUrl,sample.salesLeadUrl);
 assert.equal(f.opened.length,1);
});
test('Current 25 cannot overwrite a Full Search that is still capturing',async()=>{
 const f=fixture();f.storage.salesNavFullRunV1={complete:false};
 const result=await f.message({type:'work_queue_capture',tabId:9,readProfiles:true});
 assert.equal(result.ok,false);assert.match(result.error,/Full-search capture is running/);assert.equal(f.calls.length,0);
});
test('Full Search retains leads across pages and hands every saved person to automatic profile reading',async()=>{
 const background=fs.readFileSync('chrome-companion/background-v154.js','utf8');
 const functions=background.slice(background.indexOf('async function markComplete('),background.indexOf('async function advance('));
 let stored;const handoffs=[];
 const context={Date,Number,MAX_PAGES:100,MAX_LEADS:2500,CONTINUATION_TAB_KEY:'tab',CONTINUE_ALARM:'alarm',chrome:{storage:{local:{remove:async()=>{}}},alarms:{clear:async()=>{}}},setRun:async value=>{stored=value;},finishRun:async run=>({total:run.total}),savePage:async(run,page,leads)=>({total:(run.total||0)+leads.length}),dedupe:leads=>[...new Map(leads.map(lead=>[lead.salesLeadUrl,lead])).values()],pageSignature:leads=>leads.map(lead=>lead.salesLeadUrl).join('|'),cleanUrl:value=>value,appendCapturedProfileChecks:async(leads,url)=>{handoffs.push({leads,url});}};
 vm.createContext(context);vm.runInContext(functions,context);
 let run={sourceUrl:'https://www.linkedin.com/sales/search/people',total:0,pagesRead:0};
 context.run=run;context.page={sourceUrl:run.sourceUrl,leads:[sample]};
 run=await vm.runInContext('persistCurrentPage(run,page)',context);
 context.run=run;context.page={sourceUrl:run.sourceUrl,leads:[{...sample,name:'Person B',salesLeadUrl:'https://www.linkedin.com/sales/lead/other'}]};
 run=await vm.runInContext('persistCurrentPage(run,page)',context);
 context.run=run;await vm.runInContext('markComplete(run,"No next page")',context);
 assert.equal(stored.complete,true);assert.equal(stored.total,2);assert.equal(handoffs.length,2);assert.equal(handoffs[0].leads.length,1);assert.equal(handoffs[1].leads.length,1);
 assert.equal(handoffs[0].url,run.sourceUrl);assert.match(stored.backgroundStatus,/profile reading continues/);
});

test('a new page appended during an in-flight profile check preserves the finished result and both people',async()=>{
 let release;const checkGate=new Promise(resolve=>{release=resolve;});
 const f=fixture({checkGate});
 await f.append([sample],'https://www.linkedin.com/sales/search/people','run-stream');
 for(let i=0;i<30&&!f.calls.some(call=>call.action==='profile_check');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(f.calls.some(call=>call.action==='profile_check'));
 const added=f.append([{...sample,salesLeadUrl:'https://www.linkedin.com/sales/lead/second,SEARCH,x'}],'https://www.linkedin.com/sales/search/people','run-stream');
 release();await added;const result=await f.drain();
 assert.equal(result.rows.length,2);assert.equal(result.pending.length,0);assert.equal(result.rows[0].status,'needs-reveal');assert.equal(result.rows[0].lead.linkedinUrl,'https://www.linkedin.com/in/person-a');
 const before=f.calls.filter(call=>call.action==='profile_check').length;
 await f.append([sample],'https://www.linkedin.com/sales/search/people','run-stream');await f.drain();
 assert.equal(f.calls.filter(call=>call.action==='profile_check').length,before,'a duplicate page does not recheck a finished person');
 assert.ok(f.calls.every(call=>call.action==='profile_check'),'page capture never reveals or pushes');
});
test('legacy 25/50 capture buttons also import and start automatic free profile reads',async()=>{
 const f=fixture();const prepared=await f.message({type:'work_queue_prepare_capture'});assert.equal(prepared.ok,true);
 const response=await f.message({type:'work_queue_import_capture',sourceUrl:'https://www.linkedin.com/sales/search/people',pagesRead:2,leads:[sample]});
 assert.equal(response.ok,true);assert.equal((await f.drain()).rows[0].status,'needs-reveal');
 assert.equal(f.calls.find(call=>call.action==='import').pagesRead,2);
 assert.ok(f.calls.some(call=>call.action==='profile_check'));assert.ok(f.calls.every(call=>!['profile_reveal','profile_push'].includes(call.action)));
});

 test('quick capture binds checks to the imported run; unsaved URLs cannot report success',async()=>{
 const f=fixture();await f.message({type:'work_queue_capture',tabId:9,readProfiles:true});await f.drain();
 assert.equal(f.calls.find(call=>call.action==='profile_check').runId,'00000000-0000-4000-8000-000000000021');
 const failed=fixture({profileSynced:false});await failed.append([sample],'https://www.linkedin.com/sales/search/people','00000000-0000-4000-8000-000000000022');
 const queue=await failed.drain();assert.equal(queue.rows[0].status,'error');assert.match(queue.rows[0].error,/not saved/);assert.equal(queue.rows[0].lead.linkedinUrl,'https://www.linkedin.com/in/person-a');
 assert.ok(failed.calls.every(call=>call.action==='profile_check'));
 });
