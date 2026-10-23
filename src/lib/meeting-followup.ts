import { batchRead, searchAll, readAssociations, listOwners, listDealStages, getPropertyDefinitions } from '@/lib/hubspot';
import { SDRS, followupIssues } from './meeting-followup-core';
import { bookedBySdr } from './handoff-attribution';
import { meetingCreatorId } from './owner-attribution';
export const DEAL_FIELDS = ['dealname','hubspot_owner_id','sdr_owner','pipeline','dealstage','product','deal_next_step','next_steps_planned_by_rm','next_step_due_date','deal_update_rm_notes','current_deal_blocker','hs_lastmodifieddate','hs_is_closed'];
export const EDIT_FIELDS = ['deal_next_step','next_steps_planned_by_rm','next_step_due_date','deal_update_rm_notes','current_deal_blocker'];
export async function loadMeetingFollowup(from: string, to: string) {
  if (process.env.DEMO_MODE === 'true') throw new Error('Meeting follow-up requires live HubSpot; demo writes are disabled.');
  const meetings = await searchAll('meetings', ['hs_internal_meeting_notes','hs_meeting_title','hs_meeting_start_time','hs_meeting_end_time','hs_meeting_outcome','hs_created_by_user_id','hubspot_owner_id','hs_lastmodifieddate'], [
    { propertyName:'hs_meeting_start_time', operator:'GTE', value:from+'T00:00:00+03:00' },
    { propertyName:'hs_meeting_start_time', operator:'LTE', value:to+'T23:59:59+03:00' },
  ]);
  const [links, contacts, owners, stages, fields, outcomes] = await Promise.all([
    readAssociations('meetings','deals', meetings.map(m=>m.id)),
    readAssociations('meetings','contacts', meetings.map(m=>m.id)), listOwners(), listDealStages(),
    getPropertyDefinitions('deals', EDIT_FIELDS), getPropertyDefinitions('meetings',['hs_meeting_outcome']),
  ]);
  const deals = await batchRead('deals', [...links.values()].flat(), DEAL_FIELDS);
  const taskLinks = await readAssociations('deals','tasks',deals.map(d=>d.id));
  const tasks = await batchRead('tasks',[...taskLinks.values()].flat(),['hs_task_status','hs_timestamp','hubspot_owner_id']);
  const taskMap = new Map(tasks.map(t=>[t.id,t])); const dealMap = new Map(deals.map(d=>[d.id,d]));
  const now = new Date().toISOString();
  const rows = meetings.flatMap(m=> {
    const ids = links.get(m.id)??[];
    const attributed = ids.map(id=>dealMap.get(id)).filter(d=>d && d.properties.pipeline==='default');
    const creator = String(m.properties.hs_created_by_user_id??'');
    const sdrId = Object.keys(SDRS).find(id=>bookedBySdr(String(m.properties.hs_internal_meeting_notes||''),creator,meetingCreatorId(owners,id),id==='31644369'?'marita':'daniel'));
    if (!sdrId) return [];
    const d = attributed.length===1 ? attributed[0] : undefined;
    const p = d?.properties??{};
    const rm = String(p.hubspot_owner_id||m.properties.hubspot_owner_id||'');
    const issues = !d ? [attributed.length>1?'Multiple SDR deals: association review required':'No directly linked SDR acquisition deal'] : followupIssues({outcome:String(m.properties.hs_meeting_outcome||''),end:String(m.properties.hs_meeting_end_time||m.properties.hs_meeting_start_time||''),now,notes:String(p.deal_update_rm_notes||''),nextStep:String(p.next_steps_planned_by_rm||p.deal_next_step||''),due:String(p.next_step_due_date||''),rm,closed:['closedwon','closedlost'].includes(String(p.dealstage)),tasks:(taskLinks.get(d.id)??[]).flatMap(id=>{const t=taskMap.get(id);return t?[{open:t.properties.hs_task_status!=='COMPLETED',due:String(t.properties.hs_timestamp||''),owner:String(t.properties.hubspot_owner_id||'')}]:[]})});
    const contactId = contacts.get(m.id)?.[0];
    return [{id:m.id,title:m.properties.hs_meeting_title||'Untitled meeting',start:m.properties.hs_meeting_start_time||'',outcome:m.properties.hs_meeting_outcome||'',sdr:SDRS[sdrId]||'Needs attribution',sdrId,rm:owners.find(o=>o.id===rm)?.name||rm||'Unassigned',rmId:rm,dealId:d?.id||'',deal:p.dealname||'',stage:stages.get(String(p.dealstage))||p.dealstage||'',product:p.product||'',properties:p,meetingVersion:m.properties.hs_lastmodifieddate||'',issues,url:d?`https://app-eu1.hubspot.com/contacts/145742477/deal/${d.id}?utm_source=sdr_dashboard`:contactId?`https://app-eu1.hubspot.com/contacts/145742477/contact/${contactId}?utm_source=sdr_dashboard`:''}];
  });
  return { rows, fields, outcomes:outcomes[0]?.options??[], updatedAt:now, policy:'Sun–Thu 09:00–16:30 Asia/Riyadh; outcome 2 working hours; notes and next step 3 working hours. Holidays not configured.', coverage:'Meeting start date cohort. Booking attribution: explicit booked-by marker or verified SDR creator user ID. Deal SDR alone does not establish who booked a meeting. Contact-only links and historical ownership need review. Rows are meetings, not unique opportunities.', writesEnabled:true };
}
export type MeetingFollowupData = Awaited<ReturnType<typeof loadMeetingFollowup>>;
