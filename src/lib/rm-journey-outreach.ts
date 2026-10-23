import { batchRead, readAssociations } from './hubspot';
import { attendeeIds } from './rm-journey-core';
export async function journeyOutreach(contactIds:string[],dealIds:string[]){
 const warnings:string[]=[];
 const defs=[{type:'calls',title:'Call attempt',fields:['hs_timestamp','hubspot_owner_id']},{type:'emails',title:'Email',fields:['hs_timestamp','hubspot_owner_id','hs_email_direction']},{type:'communications',title:'Communication',fields:['hs_timestamp','hubspot_owner_id','hs_communication_channel_type']},{type:'meetings',title:'Completed meeting',fields:['hs_timestamp','hs_meeting_start_time','hs_meeting_outcome','hubspot_owner_id','hs_attendee_owner_ids']}];
 const events=(await Promise.all(defs.map(async d=>{
  try{
   const [cl,dl]=await Promise.all([readAssociations('contacts',d.type,contactIds),readAssociations('deals',d.type,dealIds)]);
   const ids=[...new Set([...cl.values(),...dl.values()].flat())];
   if(ids.length>5000)warnings.push(`${d.title} history exceeds 5,000 records; outreach evidence is partial.`);
   const rows=await batchRead(d.type,ids.slice(0,5000),d.fields);
   return rows.filter(r=>d.type!=='meetings'||r.properties.hs_meeting_outcome==='COMPLETED').filter(r=>d.type!=='emails'||['OUTGOING','EMAIL'].some(v=>String(r.properties.hs_email_direction||'').includes(v))).map(r=>({id:r.id,type:d.title,at:String((d.type==='meetings'?r.properties.hs_meeting_start_time:r.properties.hs_timestamp)||r.properties.hs_timestamp||''),participantIds:d.type==='meetings'?attendeeIds(r.properties.hs_attendee_owner_ids):[],ownerId:String(r.properties.hubspot_owner_id||''),contactIds:contactIds.filter(id=>(cl.get(id)||[]).includes(r.id)),dealIds:dealIds.filter(id=>(dl.get(id)||[]).includes(r.id))}));
  }catch{warnings.push(`${d.title} history unavailable; absence of follow-up cannot be confirmed.`);return [];}
 }))).flat();
 return {events,warnings};
}
