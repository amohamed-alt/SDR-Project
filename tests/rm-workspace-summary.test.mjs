import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpenDeal, latestAccountUpdate, followupHealth } from '../src/lib/rm-workspace-summary.ts';
const row = { followups: [], deals: [], notes: '', summary: '', version: '' };
test('open deal totals require a confirmed open flag and exclude closed stages', () => {
  assert.equal(isOpenDeal({properties:{hs_is_closed:'false',dealstage:'qualifiedtobuy'}}),true);
  for(const properties of [{}, {hs_is_closed:'true'}, {hs_is_closed:'false',dealstage:'closedlost'}, {hs_is_closed:'false',dealstage:'closedwon'}]) assert.equal(isOpenDeal({properties}),false);
});
test('latest update uses all meetings in account group and excludes future or unrelated RM activity', () => {
 const older={...row,followups:[{ownerId:'rm',type:'Email',at:'2026-11-05T08:00:00Z'},{ownerId:'other',type:'Call attempt',at:'2026-11-06T08:00:00Z'},{ownerId:'rm',type:'Communication',at:'2026-11-07T08:00:00Z'}]};
 const latest=latestAccountUpdate([row,older],'rm','2026-11-06T09:00:00Z');assert.equal(latest.title,'Email');
 const deal={...row,deals:[{ownerId:'rm',name:'Deal',stage:'Proposal',properties:{deal_update_rm_notes:'<p>Proposal sent</p>',hs_lastmodifieddate:'2026-11-06T08:00:00Z'}}]};
 assert.deepEqual(latestAccountUpdate([older,deal],'rm','2026-11-06T09:00:00Z'),{title:'Deal record updated',text:'Proposal sent',at:'2026-11-06T08:00:00Z'});
});
test('healthy follow-up requires outreach, scheduled task and no exceptions',()=>{
 const state={followupRequired:true,responsible:true,overdue:[],slaBreached:false,future:[{}],lastFollowupAt:'2026-11-05T08:00:00Z'};
 assert.equal(followupHealth(state),'On track');assert.equal(followupHealth(state,true),'History incomplete');
 assert.equal(followupHealth({...state,overdue:[{}]}),'Overdue task');assert.equal(followupHealth({...state,slaBreached:true}),'Follow-up overdue');
 assert.equal(followupHealth({...state,future:[]}), 'Next action needed');assert.equal(followupHealth({...state,lastFollowupAt:''}), 'Scheduled · outreach unverified');
 assert.equal(followupHealth({...state,followupRequired:false}), 'No follow-up required');
});
