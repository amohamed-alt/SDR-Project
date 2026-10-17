import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const origin='https://sdr.dashboardtalentera.tech';
function fixture({fetchGate}={}){
 const handlers=[],posts=[],starts=[];const storage={pairingToken:'do-not-expose'};
 const chrome={runtime:{onMessage:{addListener:f=>handlers.push(f)},getManifest:()=>({version:'1.7.0'})},storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,storage[k]])),set:async v=>Object.assign(storage,v)}},permissions:{contains:async()=>true},tabs:{query:async()=>[{id:4,title:'HR Saudi',url:'https://www.linkedin.com/sales/search/people?x=1'}]},alarms:{clear:async()=>{}}};
 const context={chrome,URL,AbortSignal,startOrResume:async(id,options)=>starts.push(['capture',id,options]),startCapturedProfileChecks:async(...args)=>starts.push(['read',...args]),stopCapturedProfileChecks:async()=>starts.push(['stop']),pauseSalesNavCapture:async()=>starts.push(['pause-capture']),fetch:async(url,args)=>{posts.push(JSON.parse(args.body));if(fetchGate)await fetchGate;return {ok:true,json:async()=>({ok:true,sourceUrl:'https://www.linkedin.com/sales/search/people',leads:[{name:'Saved person',salesLeadUrl:'https://www.linkedin.com/sales/lead/SAVED'}]})};}};
 vm.runInNewContext(fs.readFileSync('chrome-companion/dashboard-controller.js','utf8'),context);
 const send=(action,extra={},url=origin+'/signalhire-queue')=>new Promise(resolve=>handlers[0]({type:'dashboard_collector',action,...extra},{url},resolve));return{send,posts,starts,storage};
}
test('dashboard status distinguishes a browser worker from server token pairing and exposes no token',async()=>{const f=fixture();const r=await f.send('status');assert.equal(r.ok,true);assert.equal(r.version,'1.7.0');assert.equal(r.tabs[0].id,4);assert.equal(JSON.stringify(r).includes('do-not-expose'),false);});
test('dashboard read uses server-owned capture identities, never arbitrary page URLs',async()=>{
 const f=fixture();const r=await f.send('read',{runId:'00000000-0000-4000-8000-000000000001',leads:[{salesLeadUrl:'https://evil.test'}]});assert.equal(r.ok,true);assert.deepEqual(f.posts,[{action:'profile_read_run',runId:'00000000-0000-4000-8000-000000000001'}]);assert.equal(f.starts[0][1][0].name,'Saved person');
});
test('outside origins, lookalike hosts and paid/CRM commands never reach the worker',async()=>{
 const f=fixture();for(const url of ['https://evil.test/signalhire-queue','https://sdr.dashboardtalentera.tech.evil.test/signalhire-queue'])assert.equal((await f.send('read',{},url)).ok,false);
 for(const action of ['reveal','push'])assert.equal((await f.send(action)).ok,false);
 assert.equal(f.posts.length,0);assert.equal(f.starts.length,0);
});
test('dashboard capture must target a known open Sales Nav search; stop remains recoverable',async()=>{
 const f=fixture();assert.equal((await f.send('capture',{tabId:99})).ok,false);assert.equal((await f.send('capture',{tabId:4})).ok,true);assert.equal((await f.send('stop')).ok,true);assert.equal(f.starts[0][1],4);
 assert.equal(f.starts[0][2].readProfilesOnComplete,true);
});
test('collector start commands are singleflight across dashboard tabs, and stop cancels an outstanding read start',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const f=fixture({fetchGate:gate});
 const first=f.send('read',{runId:'00000000-0000-4000-8000-000000000001'});
 while(!f.posts.length)await new Promise(resolve=>setImmediate(resolve));
 const duplicate=await f.send('capture',{tabId:4});assert.equal(duplicate.ok,false);assert.match(duplicate.error,/already starting/);
 assert.equal((await f.send('stop')).ok,true);release();const cancelled=await first;assert.equal(cancelled.ok,false);assert.match(cancelled.error,/cancelled/);assert.equal(f.starts.filter(item=>item[0]==='read').length,0);
});
test('worker rejects starts during active capture or URL reading regardless of page disabled state',async()=>{
 const f=fixture();f.storage.salesNavFullRunV1={runId:'run',complete:false,paused:false,backgroundError:'Transient retry'};
 assert.equal((await f.send('read',{runId:'00000000-0000-4000-8000-000000000001'})).ok,false);
 f.storage.salesNavFullRunV1.complete=true;f.storage.salesNavWorkQueueV160={action:'read',pending:['a'],paused:false};
 assert.equal((await f.send('capture',{tabId:4})).ok,false);assert.equal(f.posts.length,0);assert.equal(f.starts.length,0);
});
