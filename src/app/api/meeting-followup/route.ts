import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadMeetingFollowup, DEAL_FIELDS, EDIT_FIELDS } from '@/lib/meeting-followup';
import { batchRead, listOwners, readAssociations, getPropertyDefinitions, updateRecordVerified } from '@/lib/hubspot';
import { sdrAdminAuthorized } from '@/lib/sdr-admin-auth';
import { originMatchesRequestHosts } from '@/lib/request-origin';
import { SDRS } from '@/lib/meeting-followup-core';
import { bookedBySdr } from '@/lib/handoff-attribution';
import { meetingCreatorId } from '@/lib/owner-attribution';
import { participation } from '@/lib/rm-journey-core';
import { invalidateRmJourney } from '@/lib/rm-journey';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control':'private, no-store' };
export async function GET(req:NextRequest) {
  const from=req.nextUrl.searchParams.get('from')||'', to=req.nextUrl.searchParams.get('to')||'';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||from>to||Date.parse(to)-Date.parse(from)>93*86400000) return NextResponse.json({error:'Select a valid range of up to 93 days.'},{status:400,headers});
  try { return NextResponse.json(await loadMeetingFollowup(from,to),{headers}); }
  catch { return NextResponse.json({error:'Live HubSpot follow-up data could not be loaded. No empty or synthetic results substituted.'},{status:502,headers}); }
}
const bodySchema=z.object({id:z.string().regex(/^\d+$/),version:z.string().min(1),properties:z.record(z.string(),z.string().max(10000)),target:z.enum(['deals','meetings']).default('deals'),meetingId:z.string().regex(/^\d+$/).optional(),rmId:z.string().regex(/^\d+$/).optional()});
export async function POST(req:NextRequest) {
  if (!originMatchesRequestHosts({origin:req.headers.get('origin'),forwardedHost:req.headers.get('x-forwarded-host'),host:req.headers.get('host'),requestHost:req.nextUrl.host}) || req.headers.get('sec-fetch-site')==='cross-site') return NextResponse.json({error:'Same-origin request required'},{status:403,headers});
  if(!sdrAdminAuthorized(req)) return NextResponse.json({error:'Unlock SDR tools before updating HubSpot.'},{status:401,headers});
  if(process.env.DEMO_MODE==='true') return NextResponse.json({error:'Live writes disabled in demo mode'},{status:403,headers});
  try {
    const parsed=bodySchema.safeParse(await req.json());
    if(!parsed.success) return NextResponse.json({error:'Invalid update'},{status:400,headers});
    const {id,version,properties,target}=parsed.data;
    if(target==='meetings') {
      if(Object.keys(properties).length!==1||!properties.hs_meeting_outcome) return NextResponse.json({error:'Only meeting outcome can be edited'},{status:400,headers});
      const [meeting]=await batchRead('meetings',[id],['hs_created_by_user_id','hs_internal_meeting_notes','hs_attendee_owner_ids','hubspot_owner_id','hs_lastmodifieddate']);
      if(!meeting) return NextResponse.json({error:'Meeting not found'},{status:404,headers});
      const links=await readAssociations('meetings','deals',[id]);
      const linked=await batchRead('deals',links.get(id)??[],['pipeline','sdr_owner']);
      const owners=await listOwners();
      const bookingEligible=Object.keys(SDRS).some(owner=>bookedBySdr(String(meeting.properties.hs_internal_meeting_notes||''),String(meeting.properties.hs_created_by_user_id||''),meetingCreatorId(owners,owner),owner==='31644369'?'marita':'daniel'));
      const eligible=linked.some(d=>d.properties.pipeline==='default'&&SDRS[String(d.properties.sdr_owner)]);
      const participants=participation(meeting,owners);
      if(!eligible&&!bookingEligible&&!(participants.sdrs.length&&participants.rms.length)) return NextResponse.json({error:'Meeting attribution requires review'},{status:403,headers});
      if(meeting.properties.hs_lastmodifieddate!==version) return NextResponse.json({error:'Meeting changed. Reload before saving.'},{status:409,headers});
      const [field]=await getPropertyDefinitions('meetings',['hs_meeting_outcome']);
      if(!field.options?.some(o=>o.value===properties.hs_meeting_outcome&&!o.hidden)) return NextResponse.json({error:'Invalid meeting outcome'},{status:400,headers});
      const confirmed=await updateRecordVerified('meetings',id,properties);
      invalidateRmJourney();
      return NextResponse.json({confirmed:true,record:confirmed},{headers});
    }
    if(!Object.keys(properties).length||Object.keys(properties).some(k=>!EDIT_FIELDS.includes(k))) return NextResponse.json({error:'Unsupported field'},{status:400,headers});
    const [record]=await batchRead('deals',[id],DEAL_FIELDS);
    let journeyEligible=false;
    if(parsed.data.meetingId&&parsed.data.rmId&&record?.properties.hubspot_owner_id===parsed.data.rmId){
      const [meetings,owners]=await Promise.all([batchRead('meetings',[parsed.data.meetingId],['hs_created_by_user_id','hs_attendee_owner_ids','hubspot_owner_id','hs_internal_meeting_notes']),listOwners()]);
      if(meetings[0]){const evidence=participation(meetings[0],owners);
        if(evidence.sdrs.length&&evidence.rms.some(r=>r.id===parsed.data.rmId)){
          const [direct,contacts]=await Promise.all([readAssociations('meetings','deals',[parsed.data.meetingId]),readAssociations('meetings','contacts',[parsed.data.meetingId])]);
          const indirect=await readAssociations('contacts','deals',contacts.get(parsed.data.meetingId)||[]);
          journeyEligible=[...(direct.get(parsed.data.meetingId)||[]),...[...indirect.values()].flat()].includes(id);
        }
      }
    }
    if(!record||record.properties.pipeline!=='default'||(!SDRS[String(record.properties.sdr_owner)]&&!journeyEligible)) return NextResponse.json({error:'Not an eligible SDR acquisition deal'},{status:403,headers});
    if(record.properties.hs_lastmodifieddate!==version) return NextResponse.json({error:'This deal changed in HubSpot. Reload before saving.'},{status:409,headers});
    const definitions=await getPropertyDefinitions('deals',Object.keys(properties));
    for(const [key,value] of Object.entries(properties)) {
      const field=definitions.find(f=>f.name===key);
      if(!field||(field.type==='enumeration'&&value&&!field.options?.some(o=>o.value===value&&!o.hidden))||(field.type==='date'&&value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))))) return NextResponse.json({error:'Invalid HubSpot property value'},{status:400,headers});
    }
    const confirmed=await updateRecordVerified('deals',id,properties);
    invalidateRmJourney();
      return NextResponse.json({confirmed:true,record:confirmed},{headers});
  } catch { return NextResponse.json({error:'Save could not be confirmed. Reload HubSpot before retrying; some values may already have been saved.'},{status:502,headers}); }
}
