import { contactDisposition } from './rm-review-core.ts';
import { afterMeeting } from './rm-journey-core.ts';
export const RM_FOLLOWUP_SLA_DAYS = 21;
import type { JourneyRow } from './rm-journey.ts';
export function journeyStatus(row:JourneyRow,rmId:string,now:string){
 const matching=row.deals.filter(d=>d.ownerId===rmId);
 const direct=matching.filter(d=>d.direct);
 const deal=direct.length===1?direct[0]:matching.length===1?matching[0]:undefined;
 const closed=deal&&(deal.properties.hs_is_closed==='true'||['closedwon','closedlost'].includes(String(deal.properties.dealstage)));
 const tasks=row.tasks.filter(t=>t.ownerId===rmId&&(!deal||!t.dealIds.length||t.dealIds.includes(deal.id)));
 const open=tasks.filter(t=>t.status!=='COMPLETED');
 const future=open.filter(t=>Date.parse(t.due)>=Date.parse(now)).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
 const overdue=open.filter(t=>Date.parse(t.due)<Date.parse(now)).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
 const followups=row.followups.filter(f=>(f.ownerId===rmId||f.participantIds?.includes(rmId))&&afterMeeting(f.at,row.end,now)).sort((a,b)=>a.at.localeCompare(b.at));
 const responsible=Boolean(row.responsibleRmIds?.includes(rmId)||deal||open.length);
 const dispositions=(row.contacts||[]).map(c=>contactDisposition(c.properties));
 const disqualified=dispositions.length>0&&dispositions.every(c=>c.stopped);
 const stopReason=closed?'Closed opportunity':disqualified?dispositions.map(c=>c.reason).filter((v,i,a)=>a.indexOf(v)===i).join(' · '):'';
 const followupRequired=!closed&&!disqualified;
 const lastFollowupAt=followups.at(-1)?.at||'';
 const anchor=Date.parse(lastFollowupAt||row.end), current=Date.parse(now);
 const elapsed=current-anchor;
 const idleDays=Number.isFinite(elapsed)&&elapsed>=0?Math.floor(elapsed/86400000):null;
 const slaApplicable=followupRequired&&responsible&&idleDays!==null;
 const slaDueAt=Number.isFinite(anchor)?new Date(anchor+RM_FOLLOWUP_SLA_DAYS*86400000).toISOString():'';
 const slaBreached=slaApplicable&&current>=Date.parse(slaDueAt);
 const daysRemaining=slaApplicable?Math.max(0,Math.ceil((Date.parse(slaDueAt)-current)/86400000)):null;
 const overdueDays=slaBreached?Math.floor((current-Date.parse(slaDueAt))/86400000):0;
 const issues:string[]=[];
 if(slaBreached)issues.push('21-day follow-up SLA exceeded');
 if(followupRequired&&responsible&&overdue.length)issues.push(`${overdue.length} overdue RM task${overdue.length>1?'s':''}`);
 // Data completeness is not a timed follow-up breach.
 const validationIssues:string[]=[];
 if(current>=Date.parse(row.end)){
 if(!['COMPLETED','NO_SHOW','CANCELED','RESCHEDULED'].includes(row.outcome))validationIssues.push('Outcome needs updating');
 if(row.outcome==='COMPLETED'){
 if(!row.notes&&!deal?.properties.deal_update_rm_notes)validationIssues.push('Meeting notes missing');
 if(followupRequired&&deal&&(!(deal.properties.deal_next_step||deal.properties.next_steps_planned_by_rm)||!deal.properties.next_step_due_date))validationIssues.push('Next step / date missing');
 }
 }
 return {followupRequired,stopReason,disqualified,lastFollowupAt,idleDays,slaApplicable,slaDueAt,slaBreached,daysRemaining,overdueDays,validationIssues,responsible,deal,tasks,future,overdue,followups,issues,closed:Boolean(closed),stage:deal?.stage||'No unique RM opportunity',linkReview:matching.length>1?'Multiple RM opportunities':!deal?'Opportunity linkage needs review':''};
}
