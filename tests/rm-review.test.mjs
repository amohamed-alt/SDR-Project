import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contactDisposition,contactReview,dealReview,validReviewValue} from '../src/lib/rm-review-core.ts';
import {journeyStatus} from '../src/lib/rm-journey-status.ts';
import {withResponsibleOwners} from '../src/lib/rm-journey-core.ts';
import {trackerCandidates} from '../src/lib/rm-tracker-core.ts';
const row={responsibleRmIds:['76369998'],contacts:[],end:'2026-10-01T09:00:00Z',outcome:'COMPLETED',notes:'',followups:[],tasks:[],deals:[]};
test('explicit disqualification removes follow-up SLA but keeps missing review fields visible',()=>{
 const properties={hs_lead_status:'UNQUALIFIED',unqualified_sub_reason:'No Need'};
 const s=journeyStatus({...row,contacts:[{ownerId:'76369998',properties}]},'76369998','2026-10-23T12:00:00Z');
 assert.equal(s.followupRequired,false);assert.deepEqual(s.issues,[]);assert.match(s.stopReason,/Unqualified/);
 const checks=contactReview(properties);assert.equal(checks.find(c=>c.name==='rm_feedback').filled,false);assert.equal(checks.find(c=>c.name==='rm_validation_reason').filled,true);assert.equal(checks.some(c=>c.name==='rm_next_followup_date'),false);
});
test('bad timing, absent interest checkbox and missing fields do not invent disqualification',()=>{
 for(const p of [{},{hs_lead_status:'BAD_TIMING'},{lead_interest_checkbox:'false'},{rm_meeting_outcome:'Follow-up Later'}])assert.equal(contactDisposition(p).stopped,false);
 assert.equal(contactDisposition({rm_meeting_outcome:'Unqualified'}).stopped,true);
 assert.equal(contactDisposition({rm_validation_reason:'No need'}).stopped,true);
});
test('one excluded contact does not exempt another active associated contact',()=>{
 const contacts=[{ownerId:'76369998',properties:{hs_lead_status:'UNQUALIFIED'}},{ownerId:'76369998',properties:{hs_lead_status:'IN_PROGRESS'}}];
 assert.equal(journeyStatus({...row,contacts},'76369998','2026-10-23T12:00:00Z').followupRequired,true);
 assert.equal(journeyStatus({...row,contacts:[{ownerId:'other',properties:{hs_lead_status:'UNQUALIFIED'}}]},'76369998','2026-10-23T12:00:00Z').followupRequired,false);
 assert.equal(journeyStatus({...row,contacts:[...contacts,{ownerId:'other',properties:{}}]},'76369998','2026-10-23T12:00:00Z').followupRequired,true);
});
test('no deal does not create a missing deal next-step SLA and closed deal validation excludes future steps',()=>{
 assert.equal(journeyStatus(row,'76369998','2026-10-23T12:00:00Z').issues.includes('Next step / date missing'),false);
 assert.deepEqual(dealReview({},true).map(c=>c.name),['deal_update_rm_notes']);
 assert.equal(dealReview({next_steps_planned_by_rm:'Send proposal'}).find(c=>c.name==='deal_next_step').filled,true);
});
test('CRM ownership adds Fadi without claiming he attended or changing actual participant evidence',()=>{
 const rms=withResponsibleOwners([],['76369998'],'Contact owner');assert.equal(rms[0].slug,'fadi');assert.deepEqual(rms[0].roles,['Contact owner · attendance unverified']);
 assert.deepEqual(withResponsibleOwners(rms,['76369998'],'Direct opportunity owner'),rms);
});
test('tracker candidates retain multiple same-day records and never merge similar companies',()=>{
 const tracker={company:'Qiyas Alelmia',date:'2026-10-08',meetingId:'',rmId:'76369998'};
 const crm=['1','2'].map(id=>({id,company:{name:'Qiyas Alelmia'},start:'2026-10-08T11:00:00Z',people:{rms:[{id:'76369998'}]}}));
 assert.deepEqual(trackerCandidates(tracker,crm).map(r=>r.id),['1','2']);assert.deepEqual(trackerCandidates({...tracker,company:'Qiyas'},crm),[]);
 assert.equal(trackerCandidates({...tracker,meetingId:'2'},crm)[0].id,'2');assert.deepEqual(trackerCandidates({...tracker,rmId:'other'},crm),[]);
});
test('contact field validation rejects invalid dates, hidden enums and unknown types',()=>{
 assert.equal(validReviewValue({type:'date'},'2026-02-30'),false);assert.equal(validReviewValue({type:'date'},'2026-02-28'),true);
 assert.equal(validReviewValue({type:'enumeration',options:[{value:'x',hidden:true}]},'x'),false);assert.equal(validReviewValue({type:'number'},'123'),false);
});
