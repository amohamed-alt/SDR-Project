import { batchRead, getPropertyDefinitions, listDealStages, listOwners, readAssociations, searchAll } from './hubspot';
import { DEAL_FIELDS, EDIT_FIELDS } from './meeting-followup';
import { hubspotRecordUrl } from './config';
import { journeyOutreach } from './rm-journey-outreach';
import { participation, RM_PROFILES, plainText, afterMeeting } from './rm-journey-core';
export const JOURNEY_MEETING_FIELDS=['hs_meeting_title','hs_meeting_start_time','hs_meeting_end_time','hs_meeting_outcome','hs_created_by_user_id','hs_attendee_owner_ids','hubspot_owner_id','hs_internal_meeting_notes','hs_meeting_body','hs_meeting_summary','hs_has_meeting_transcript','hs_lastmodifieddate'];
export const JOURNEY_TASK_FIELDS=['hs_task_subject','hs_task_status','hs_timestamp','hs_task_completion_date','hubspot_owner_id'];
const snapshotCache=new Map<string,{expires:number;value:Awaited<ReturnType<typeof buildRmJourney>>}>();
const inflight=new Map<string,Promise<Awaited<ReturnType<typeof buildRmJourney>>>>();
export async function loadRmJourney(from:string,to:string,refresh=false){
 const key=from+':'+to; const cached=snapshotCache.get(key);
 if(!refresh&&cached&&cached.expires>Date.now())return cached.value;
 const running=inflight.get(key);if(running)return running;
 const promise=buildRmJourney(from,to).then(value=>{if(snapshotCache.size>=8)snapshotCache.delete(snapshotCache.keys().next().value!);snapshotCache.set(key,{expires:Date.now()+120000,value});return value;}).finally(()=>inflight.delete(key));
 inflight.set(key,promise);return promise;
}
export function invalidateRmJourney(){snapshotCache.clear();}
async function buildRmJourney(from:string,to:string){
 if(process.env.DEMO_MODE==='true')throw new Error('Live HubSpot required');
 const [meetings,owners,stages,fields,outcomes]=await Promise.all([
 searchAll('meetings',JOURNEY_MEETING_FIELDS,[{propertyName:'hs_meeting_start_time',operator:'GTE',value:from+'T00:00:00+03:00'},{propertyName:'hs_meeting_start_time',operator:'LTE',value:to+'T23:59:59.999+03:00'}]),listOwners(),listDealStages(),getPropertyDefinitions('deals',EDIT_FIELDS),getPropertyDefinitions('meetings',['hs_meeting_outcome'])]);
 const scoped=meetings.map(m=>({m,people:participation(m,owners)})).filter(r=>r.people.sdrs.length&&r.people.rms.length);
 const ids=scoped.map(r=>r.m.id);
 const [meetingContacts,meetingCompanies,directDeals]=await Promise.all([readAssociations('meetings','contacts',ids),readAssociations('meetings','companies',ids),readAssociations('meetings','deals',ids)]);
 const contactIds=[...new Set([...meetingContacts.values()].flat())];
 const [contacts,contactCompanies,contactDeals]=await Promise.all([batchRead('contacts',contactIds,['firstname','lastname','email','phone','mobilephone','jobtitle','company','createdate','hs_analytics_source']),readAssociations('contacts','companies',contactIds),readAssociations('contacts','deals',contactIds)]);
 const internalEmails=new Set(owners.map(o=>o.email?.toLowerCase()).filter(Boolean));
 const externalContacts=contacts.filter(c=>!internalEmails.has(String(c.properties.email||'').toLowerCase()));
 const contactMap=new Map(externalContacts.map(c=>[c.id,c]));
 const companyIds=[...new Set([...meetingCompanies.values(),...contactCompanies.values()].flat())];
 const dealIds=[...new Set([...directDeals.values(),...externalContacts.map(c=>contactDeals.get(c.id)||[])].flat())];
 const [companies,deals]=await Promise.all([batchRead('companies',companyIds,['name','domain']),batchRead('deals',dealIds,DEAL_FIELDS)]);
 const companyMap=new Map(companies.map(c=>[c.id,c]));const dealMap=new Map(deals.map(d=>[d.id,d]));
 const [dealTasks,contactTasks]=await Promise.all([readAssociations('deals','tasks',dealIds),readAssociations('contacts','tasks',externalContacts.map(c=>c.id))]);
 const tasks=await batchRead('tasks',[...new Set([...dealTasks.values(),...contactTasks.values()].flat())],JOURNEY_TASK_FIELDS);const taskMap=new Map(tasks.map(t=>[t.id,t]));
 const outreach=await journeyOutreach(externalContacts.map(c=>c.id),dealIds);
 const now=new Date().toISOString();
 const name=(id:string)=>owners.find(o=>o.id===id)?.name||id||'Not recorded';
 const rows=scoped.map(({m,people})=>{
  const cids=(meetingContacts.get(m.id)||[]).filter(id=>contactMap.has(id));
  const cs=cids.map(id=>contactMap.get(id)!);
  const companyId=(meetingCompanies.get(m.id)||[])[0]||cids.flatMap(id=>contactCompanies.get(id)||[])[0]||'';
  const company=companyMap.get(companyId);
  const direct=(directDeals.get(m.id)||[]).filter(id=>dealMap.get(id)?.properties.pipeline==='default');
  const indirect=cids.flatMap(id=>contactDeals.get(id)||[]).filter(id=>dealMap.get(id)?.properties.pipeline==='default');
  const candidates=[...new Set([...direct,...indirect])].map(id=>dealMap.get(id)!).filter(Boolean);
  const taskIds=[...new Set([...cids.flatMap(id=>contactTasks.get(id)||[]),...candidates.flatMap(d=>dealTasks.get(d.id)||[])])];
  const linkedTasks=taskIds.map(id=>taskMap.get(id)!).filter(Boolean).map(t=>({id:t.id,title:String(t.properties.hs_task_subject||'Follow-up task'),status:String(t.properties.hs_task_status||''),due:String(t.properties.hs_timestamp||''),completedAt:String(t.properties.hs_task_completion_date||''),ownerId:String(t.properties.hubspot_owner_id||''),owner:name(String(t.properties.hubspot_owner_id||'')),dealIds:candidates.filter(d=>(dealTasks.get(d.id)||[]).includes(t.id)).map(d=>d.id)}));
  const recordUrl=cs[0]?hubspotRecordUrl('contact',cs[0].id):company?hubspotRecordUrl('company',company.id):'';
  const followups=outreach.events.filter(e=>afterMeeting(e.at,String(m.properties.hs_meeting_end_time||m.properties.hs_meeting_start_time),now)&&(e.contactIds.some(id=>cids.includes(id))||e.dealIds.some(id=>candidates.some(d=>d.id===id))));
  return {followups,id:m.id,title:String(m.properties.hs_meeting_title||'Untitled meeting'),start:String(m.properties.hs_meeting_start_time||''),end:String(m.properties.hs_meeting_end_time||m.properties.hs_meeting_start_time||''),outcome:String(m.properties.hs_meeting_outcome||''),version:String(m.properties.hs_lastmodifieddate||''),people,assignedName:name(people.assignedId),creatorName:name(people.creatorId),company:company?{id:company.id,name:String(company.properties.name||''),domain:String(company.properties.domain||''),url:hubspotRecordUrl('company',company.id)}:null,contacts:cs.map(c=>({id:c.id,name:[c.properties.firstname,c.properties.lastname].filter(Boolean).join(' ')||String(c.properties.email||'Contact'),email:String(c.properties.email||''),title:String(c.properties.jobtitle||''),createdAt:String(c.properties.createdate||''),source:String(c.properties.hs_analytics_source||''),url:hubspotRecordUrl('contact',c.id)})),deals:candidates.map(d=>({id:d.id,name:String(d.properties.dealname||'Opportunity'),ownerId:String(d.properties.hubspot_owner_id||''),owner:name(String(d.properties.hubspot_owner_id||'')),stage:stages.get(String(d.properties.dealstage))||String(d.properties.dealstage||''),properties:d.properties,direct:direct.includes(d.id),url:hubspotRecordUrl('deal',d.id)})),tasks:linkedTasks,notes:plainText(m.properties.hs_internal_meeting_notes),summary:plainText(m.properties.hs_meeting_summary),description:plainText(m.properties.hs_meeting_body),hasTranscript:m.properties.hs_has_meeting_transcript==='true',recordUrl,prospectKey:companyId?'company:'+companyId:cids.length?'contact:'+cids.slice().sort().join(','):'meeting:'+m.id};
 }).sort((a,b)=>b.start.localeCompare(a.start));
 return {warnings:outreach.warnings,rows,profiles:RM_PROFILES,fields,outcomes:outcomes[0]?.options||[],updatedAt:new Date().toISOString(),from,to,counts:{scannedMeetings:meetings.length,matchedMeetings:rows.length},coverage:'Meeting start date cohort. RM must be creator, assigned owner or listed attendee; SDR must have explicit meeting involvement. Attendance is not booking credit. Contact-linked opportunities are labeled separately. Counts across RMs overlap for shared meetings.'};
}
export type RmJourneyData=Awaited<ReturnType<typeof buildRmJourney>>;
export type JourneyRow=RmJourneyData['rows'][number];
