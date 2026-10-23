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
const base={responsibleRmIds:['31558980'],end:'2026-10-25T07:00:00Z',outcome:'COMPLETED',notes:'Discovery notes',followups:[{ownerId:'other',at:'2026-10-25T08:00:00Z'}],tasks:[{id:'task',ownerId:'other',due:'2026-10-26T10:00:00Z',status:'NOT_STARTED',dealIds:[]}],deals:[]};
test('another RM task or outreach never clears this RM follow-up gap',()=>{
 const s=journeyStatus(base,'31558980','2026-10-25T11:00:00Z');assert.equal(s.followups.length,0);assert.equal(s.future.length,0);assert.equal(s.slaBreached,false);assert.deepEqual(s.issues,[]);
});
test('ambiguous contact-linked opportunities are not automatically selected',()=>{
 const deals=['one','two'].map(id=>({id,ownerId:'31558980',direct:false,properties:{}}));assert.equal(journeyStatus({...base,deals},'31558980','2026-10-25T11:00:00Z').deal,undefined);
});

test('a completed follow-up meeting with this RM as listed attendee is counted',()=>{
 const row={...base,followups:[{ownerId:'31644369',participantIds:['31558980'],at:'2026-10-25T08:00:00Z'}]};
 assert.equal(journeyStatus(row,'31558980','2026-10-25T11:00:00Z').followups.length,1);
});

test('a meeting participant with no assigned ownership or RM task gets no personal SLA breach',()=>{
 const row={...base,responsibleRmIds:[],tasks:[],followups:[]};
 const status=journeyStatus(row,'75863674','2026-10-25T11:00:00Z');
 assert.equal(status.responsible,false);assert.deepEqual(status.issues,[]);
});
test('an explicitly assigned RM task establishes task responsibility even without account ownership',()=>{
 const row={...base,responsibleRmIds:[],tasks:[{id:'owned',ownerId:'75863674',due:'2026-10-25T08:00:00Z',status:'NOT_STARTED',dealIds:[]}]};
 const status=journeyStatus(row,'75863674','2026-10-25T11:00:00Z');
 assert.equal(status.responsible,true);assert.ok(status.issues.includes('1 overdue RM task'));
});
test('a historic completed task does not assign an attendee an ongoing follow-up SLA',()=>{
 const row={...base,responsibleRmIds:[],tasks:[{id:'old',ownerId:'75863674',due:'2026-09-01T08:00:00Z',status:'COMPLETED',dealIds:[]}]};
 assert.equal(journeyStatus(row,'75863674','2026-10-25T11:00:00Z').responsible,false);
});

test('latest RM outreach determines inactivity and tasks sort by nearest due date',()=>{
 const row={...base,followups:[{ownerId:'31558980',at:'2026-10-25T08:00:00Z'},{ownerId:'31558980',at:'2026-10-26T08:00:00Z'}],tasks:[{id:'late',ownerId:'31558980',due:'2026-11-05T10:00:00Z',status:'NOT_STARTED',dealIds:[]},{id:'next',ownerId:'31558980',due:'2026-10-30T10:00:00Z',status:'NOT_STARTED',dealIds:[]}]};
 const status=journeyStatus(row,'31558980','2026-10-29T10:00:00Z');
 assert.equal(status.idleDays,3);assert.equal(status.lastFollowupAt,'2026-10-26T08:00:00Z');assert.equal(status.future[0].id,'next');
});
test('future meetings have no inactivity age and custom closed stages suppress SLA',()=>{
 assert.equal(journeyStatus(base,'31558980','2026-10-24T11:00:00Z').idleDays,null);
 const status=journeyStatus({...base,deals:[{id:'closed',direct:true,ownerId:'31558980',properties:{hs_is_closed:'true',dealstage:'custom-closed'}}]},'31558980','2026-10-29T11:00:00Z');
 assert.equal(status.closed,true);assert.deepEqual(status.issues,[]);
});

test('21 calendar day SLA crosses at the exact due instant',()=>{
 const before=journeyStatus(base,'31558980','2026-11-15T06:59:59Z');
 const due=journeyStatus(base,'31558980','2026-11-15T07:00:00Z');
 assert.equal(before.slaBreached,false);assert.equal(before.daysRemaining,1);
 assert.equal(due.slaBreached,true);assert.equal(due.slaDueAt,'2026-11-15T07:00:00.000Z');
});
test('recent RM outreach resets SLA but an overdue task stays overdue',()=>{
 const row={...base,followups:[{ownerId:'31558980',at:'2026-11-14T08:00:00Z'}],tasks:[{id:'late',ownerId:'31558980',due:'2026-11-13T08:00:00Z',status:'NOT_STARTED',dealIds:[]},{id:'done',ownerId:'31558980',due:'2026-11-12T08:00:00Z',status:'COMPLETED',dealIds:[]}]};
 const status=journeyStatus(row,'31558980','2026-11-15T08:00:00Z');
 assert.equal(status.slaBreached,false);assert.equal(status.daysRemaining,20);
 assert.deepEqual(status.overdue.map(t=>t.id),['late']);assert.deepEqual(status.issues,['1 overdue RM task']);
});
test('missing notes are validation issues rather than an early SLA breach',()=>{
 const status=journeyStatus({...base,notes:''},'31558980','2026-10-26T07:00:00Z');
 assert.deepEqual(status.issues,[]);assert.ok(status.validationIssues.includes('Meeting notes missing'));
});
test('closed opportunities stay SLA exempt after 21 days without deleting overdue tasks',()=>{
 const row={...base,deals:[{id:'closed',direct:true,ownerId:'31558980',properties:{hs_is_closed:'true'}}],tasks:[{id:'late',ownerId:'31558980',due:'2026-10-26T07:00:00Z',status:'NOT_STARTED',dealIds:[]}]};
 const status=journeyStatus(row,'31558980','2026-12-01T07:00:00Z');
 assert.equal(status.slaBreached,false);assert.equal(status.followupRequired,false);assert.equal(status.overdue.length,1);assert.deepEqual(status.issues,[]);
});
