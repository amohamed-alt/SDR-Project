import { test } from 'node:test';
import assert from 'node:assert/strict';
import { participation, attendeeIds, afterMeeting } from '../src/lib/rm-journey-core.ts';
import { journeyStatus } from '../src/lib/rm-journey-status.ts';
const owners=[{id:'31644369',userId:'user-marita',name:'Marita'},{id:'31558980',userId:'user-zein',name:'Zein'}];
const record=properties=>({id:'1',properties});
test('SDR creator with RM attendees maps the meeting to both RMs',()=>{
 const r=participation(record({hs_created_by_user_id:'user-marita',hubspot_owner_id:'31644369',hs_attendee_owner_ids:'31558980;75863674'}),owners);
 assert.deepEqual(r.rms.map(r=>r.slug),['zein','bassam']);assert.equal(r.sdrs[0].booked,true);
});
test('reverse RM creator / SDR attendee is included without inventing booking credit',()=>{
 const r=participation(record({hs_created_by_user_id:'user-zein',hubspot_owner_id:'31558980',hs_attendee_owner_ids:'31644369'}),owners);
 assert.equal(r.rms[0].short,'Zein');assert.deepEqual(r.sdrs[0].roles,['Attendee']);assert.equal(r.sdrs[0].booked,false);
});
test('creator user IDs must map to owners; substring collisions never match attendees',()=>{
 const r=participation(record({hs_created_by_user_id:'31644369',hs_attendee_owner_ids:'131558980;316443690'}),owners);
 assert.equal(r.rms.length,0);assert.equal(r.sdrs.length,0);
 assert.deepEqual(attendeeIds('["31558980", "75863674", "31558980"]'),['31558980','75863674']);
});
test('attendance without SDR evidence does not attribute the meeting to an SDR',()=>{
 const r=participation(record({hubspot_owner_id:'31558980',hs_attendee_owner_ids:'75863674'}),owners);assert.equal(r.sdrs.length,0);
});
test('future scheduled activities cannot count as completed follow-up',()=>{
 assert.equal(afterMeeting('2026-10-26T08:00:00Z','2026-10-25T07:00:00Z','2026-10-25T10:00:00Z'),false);
});
const base={end:'2026-10-25T07:00:00Z',outcome:'COMPLETED',notes:'Discovery notes',followups:[{ownerId:'other',at:'2026-10-25T08:00:00Z'}],tasks:[{id:'task',ownerId:'other',due:'2026-10-26T10:00:00Z',status:'NOT_STARTED',dealIds:[]}],deals:[]};
test('another RM task or outreach never clears this RM follow-up gap',()=>{
 const s=journeyStatus(base,'31558980','2026-10-25T11:00:00Z');assert.equal(s.followups.length,0);assert.equal(s.future.length,0);assert.ok(s.issues.includes('No upcoming RM task recorded'));
});
test('ambiguous contact-linked opportunities are not automatically selected',()=>{
 const deals=['one','two'].map(id=>({id,ownerId:'31558980',direct:false,properties:{}}));assert.equal(journeyStatus({...base,deals},'31558980','2026-10-25T11:00:00Z').deal,undefined);
});
