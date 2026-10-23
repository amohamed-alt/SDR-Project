import { batchRead, listOwners, readAssociations } from './hubspot';
import { participation, plainText, afterMeeting } from './rm-journey-core';
import { JOURNEY_MEETING_FIELDS } from './rm-journey';
import { hubspotRecordUrl } from './config';
export async function loadJourneyDetail(meetingId:string,rmId:string){
 const [meetings,owners]=await Promise.all([batchRead('meetings',[meetingId],JOURNEY_MEETING_FIELDS),listOwners()]);
 const meeting=meetings[0];
 if(!meeting)throw new Error('Meeting not found');
 const people=participation(meeting,owners);
 if(!people.rms.some(r=>r.id===rmId)||!people.sdrs.length)throw new Error('Meeting is not in this RM workspace');
 const [contacts,deals]=await Promise.all([readAssociations('meetings','contacts',[meetingId]),readAssociations('meetings','deals',[meetingId])]);
 const cids=contacts.get(meetingId)||[];
 const cd=await readAssociations('contacts','deals',cids);
 const dids=[...new Set([...(deals.get(meetingId)||[]),...[...cd.values()].flat()])];
 const definitions=[
 {type:'calls',kind:'Call',fields:['hs_call_title','hs_call_body','hs_timestamp','hubspot_owner_id','hs_call_status'],title:'hs_call_title',body:'hs_call_body'},
 {type:'emails',kind:'Email',fields:['hs_email_subject','hs_email_text','hs_timestamp','hubspot_owner_id','hs_email_direction'],title:'hs_email_subject',body:'hs_email_text'},
 {type:'communications',kind:'WhatsApp / communication',fields:['hs_communication_body','hs_communication_channel_type','hs_timestamp','hubspot_owner_id'],title:'hs_communication_channel_type',body:'hs_communication_body'},
 {type:'notes',kind:'Note',fields:['hs_note_body','hs_timestamp','hubspot_owner_id'],title:'',body:'hs_note_body'},
 {type:'meetings',kind:'Meeting',fields:JOURNEY_MEETING_FIELDS,title:'hs_meeting_title',body:'hs_internal_meeting_notes'},
 {type:'tasks',kind:'Task',fields:['hs_task_subject','hs_task_body','hs_task_status','hs_timestamp','hs_task_completion_date','hubspot_owner_id'],title:'hs_task_subject',body:'hs_task_body'},
 ];
 const warnings:string[]=[];
 const sources=await Promise.all(definitions.map(async d=>{
  try{
   const [cl,dl]=await Promise.all([readAssociations('contacts',d.type,cids),readAssociations('deals',d.type,dids)]);
   const ids=[...new Set([...cl.values(),...dl.values()].flat())];
   if(ids.length>1000)warnings.push(`${d.kind}: showing 1,000 of ${ids.length} associated records; follow-up totals are partial.`);
   const records=await batchRead(d.type,ids.slice(0,1000),d.fields);
   return records.map(r=>{
    const p=r.properties, owner=String(p.hubspot_owner_id||'');
    const at=String(p.hs_timestamp||p.hs_meeting_start_time||'');
    const body=plainText(p[d.body]);
    const outgoing=d.type!=='emails'||['OUTGOING','EMAIL'].some(v=>String(p.hs_email_direction||'').includes(v));
    const realMeeting=d.type!=='meetings'||p.hs_meeting_outcome==='COMPLETED';
    return {id:r.id,type:d.kind,title:plainText(p[d.title])||d.kind,body:body.slice(0,12000),bodyTruncated:body.length>12000,at,ownerId:owner,owner:owners.find(o=>o.id===owner)?.name||'Not recorded',status:String(p.hs_task_status||p.hs_meeting_outcome||p.hs_call_status||''),completedAt:String(p.hs_task_completion_date||''),hasTranscript:p.hs_has_meeting_transcript==='true',summary:plainText(p.hs_meeting_summary),followup:owner===rmId&&outgoing&&realMeeting&&['calls','emails','communications','meetings'].includes(d.type)&&afterMeeting(at,String(meeting.properties.hs_meeting_end_time||meeting.properties.hs_meeting_start_time),new Date().toISOString()),scope:dids.some(id=>(dl.get(id)||[]).includes(r.id))?'Deal-linked':'Contact-linked'};
   });
  }catch{warnings.push(`${d.kind} could not be loaded; follow-up coverage is incomplete.`);return [];}
 }));
 const events=sources.flat().filter(e=>e.at).sort((a,b)=>b.at.localeCompare(a.at));
 const rmFollowups=events.filter(e=>e.followup);
 const first=rmFollowups.slice().sort((a,b)=>a.at.localeCompare(b.at))[0];
 return {events,warnings,rmFollowupCount:rmFollowups.length,firstRmFollowupAt:first?.at||'',lastRmFollowupAt:rmFollowups[0]?.at||'',recordUrl:cids[0]?hubspotRecordUrl('contact',cids[0]):dids[0]?hubspotRecordUrl('deal',dids[0]):'',generatedAt:new Date().toISOString(),coverage:'Associated contact/deal history. Contact-linked activity can include another opportunity; linkage is shown per event. A logged call is an attempt, not proof it connected. Tasks and notes never count as customer outreach.'};
}
export type JourneyDetail=Awaited<ReturnType<typeof loadJourneyDetail>>;
