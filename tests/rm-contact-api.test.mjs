import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {z} from 'zod';
import * as review from '../src/lib/rm-review-core.ts';
const source=await readFile(new URL('../src/app/api/rm-journey/contact/route.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function fixture(overrides={}){
 let writes=0,invalidates=0;
 const state={authorized:true,origin:true,owner:'76369998',version:'v1',associated:true,...overrides};
 const modules={
 'next/server':{NextResponse:{json:(data,init)=>Response.json(data,init)}},zod:{z},
 '@/lib/sdr-admin-auth':{sdrAdminAuthorized:()=>state.authorized},
 '@/lib/request-origin':{originMatchesRequestHosts:()=>state.origin},
 '@/lib/rm-review-core':review,
 '@/lib/hubspot':{batchRead:async type=>type==='meetings'?[{properties:{hs_meeting_start_time:'2026-10-08T11:00:00Z'}}]:[{properties:{hubspot_owner_id:state.owner,lastmodifieddate:state.version}}],getPropertyDefinitions:async()=>[{name:'rm_meeting_outcome',type:'enumeration',options:[{value:'Unqualified'}]},{name:'rm_next_followup_date',type:'date'}],updateRecordVerified:async(type,id,properties)=>{writes++;return{id,properties:{...properties,lastmodifieddate:'v2'}};}},
 '@/lib/rm-journey':{loadRmJourney:async()=>({rows:[{id:'1',people:{rms:[{id:'76369998'}]},contacts:state.associated?[{id:'2',ownerId:'76369998'}]:[]}]}),invalidateRmJourney:()=>{invalidates++;}},
 };
 const exports={};new Function('require','exports',code)(name=>{if(!modules[name])throw Error(name);return modules[name];},exports);
 const post=async(properties={rm_meeting_outcome:'Unqualified'})=>{const req=new Request('https://test.invalid/api/rm-journey/contact',{method:'POST',headers:{origin:'https://test.invalid','content-type':'application/json'},body:JSON.stringify({meetingId:'1',rmId:'76369998',id:'2',version:'v1',properties})});req.nextUrl=new URL(req.url);return exports.POST(req);};
 return {post,counts:()=>({writes,invalidates})};
}
test('contact review saves verified changes and invalidates journey cache',async()=>{const f=fixture();const r=await f.post();assert.equal(r.status,200);assert.equal((await r.json()).confirmed,true);assert.deepEqual(f.counts(),{writes:1,invalidates:1});});
test('contact review rejects stale versions, changed owners, and unrelated contacts without writes',async()=>{for(const overrides of [{version:'v2'},{owner:'other'},{associated:false}]){const f=fixture(overrides);assert.ok([403,409].includes((await f.post()).status));assert.equal(f.counts().writes,0);}});
test('contact review rejects unsupported properties, invalid dates and unknown enum values',async()=>{for(const props of [{hubspot_owner_id:'99'},{rm_next_followup_date:'2026-02-30'},{rm_meeting_outcome:'invented'}]){const f=fixture();assert.equal((await f.post(props)).status,400);assert.equal(f.counts().writes,0);}});
test('contact review fails closed for authentication and origin checks',async()=>{for(const state of [{authorized:false},{origin:false}]){const f=fixture(state);assert.ok([401,403].includes((await f.post()).status));assert.equal(f.counts().writes,0);}});
