import { afterMeeting } from './rm-journey-core.ts';
import { businessMinutes } from './meeting-followup-core.ts';
import type { JourneyRow } from './rm-journey.ts';
export function journeyStatus(row:JourneyRow,rmId:string,now:string){
 const matching=row.deals.filter(d=>d.ownerId===rmId);
 const direct=matching.filter(d=>d.direct);
 const deal=direct.length===1?direct[0]:matching.length===1?matching[0]:undefined;
 const closed=deal&&['closedwon','closedlost'].includes(String(deal.properties.dealstage));
 const tasks=row.tasks.filter(t=>t.ownerId===rmId&&(!deal||!t.dealIds.length||t.dealIds.includes(deal.id)));
 const open=tasks.filter(t=>t.status!=='COMPLETED');
 const future=open.filter(t=>Date.parse(t.due)>=Date.parse(now));
 const overdue=open.filter(t=>Date.parse(t.due)<Date.parse(now));
 const followups=row.followups.filter(f=>(f.ownerId===rmId||f.participantIds?.includes(rmId))&&afterMeeting(f.at,row.end,now)).sort((a,b)=>a.at.localeCompare(b.at));
 const issues:string[]=[];const age=businessMinutes(row.end,now);
 if(!closed){
 if(age>=120&&!['COMPLETED','NO_SHOW','CANCELED','RESCHEDULED'].includes(row.outcome))issues.push('Outcome needs updating');
 if(row.outcome==='COMPLETED'&&age>=180){
 if(!row.notes&&!deal?.properties.deal_update_rm_notes)issues.push('Meeting notes missing');
 if(!future.length)issues.push('No upcoming RM task recorded');
 if(!deal?.properties.deal_next_step||!deal.properties.next_step_due_date)issues.push('Next step / date missing');
 }
 if(overdue.length)issues.push(`${overdue.length} overdue RM task${overdue.length>1?'s':''}`);
 }
 return {deal,tasks,future,overdue,followups,issues,closed:Boolean(closed),stage:deal?.stage||'No unique RM opportunity',linkReview:matching.length>1?'Multiple RM opportunities':!deal?'Opportunity linkage needs review':''};
}
