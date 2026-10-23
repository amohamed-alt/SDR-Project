import {NextRequest,NextResponse} from 'next/server';
import {z} from 'zod';
import {batchRead,getPropertyDefinitions,updateRecordVerified} from '@/lib/hubspot';
import {loadRmJourney,invalidateRmJourney} from '@/lib/rm-journey';
import {CONTACT_REVIEW_FIELDS,validReviewValue} from '@/lib/rm-review-core';
import {sdrAdminAuthorized} from '@/lib/sdr-admin-auth';
import {originMatchesRequestHosts} from '@/lib/request-origin';
export const runtime='nodejs';
const headers={'Cache-Control':'private, no-store'};
const id=z.string().regex(/^\d+$/);
const schema=z.object({meetingId:id,rmId:id,id,version:z.string().min(1),properties:z.record(z.string(),z.string().max(10000))}).strict();
export async function POST(req:NextRequest){
 if(!originMatchesRequestHosts({origin:req.headers.get('origin'),forwardedHost:req.headers.get('x-forwarded-host'),host:req.headers.get('host'),requestHost:req.nextUrl.host})||req.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Same-origin request required'},{status:403,headers});
 if(!sdrAdminAuthorized(req))return NextResponse.json({error:'Unlock SDR tools before updating HubSpot.'},{status:401,headers});
 if(process.env.DEMO_MODE==='true')return NextResponse.json({error:'Live writes disabled in demo mode'},{status:403,headers});
 try{
 const parsed=schema.safeParse(await req.json());
 if(!parsed.success)return NextResponse.json({error:'Invalid contact update'},{status:400,headers});
 const input=parsed.data,keys=Object.keys(input.properties);
 if(!keys.length||keys.some(k=>!CONTACT_REVIEW_FIELDS.includes(k)))return NextResponse.json({error:'Unsupported contact field'},{status:400,headers});
 const [meeting]=await batchRead('meetings',[input.meetingId],['hs_meeting_start_time']);
 const start=Date.parse(String(meeting?.properties.hs_meeting_start_time||''));
 if(!Number.isFinite(start))return NextResponse.json({error:'Meeting not found'},{status:404,headers});
 const day=new Date(start+3*3600000).toISOString().slice(0,10);
 const journey=await loadRmJourney(day,day,true);
 const row=journey.rows.find(r=>r.id===input.meetingId&&r.people.rms.some(p=>p.id===input.rmId));
 const contact=row?.contacts.find(c=>c.id===input.id&&c.ownerId===input.rmId);
 if(!contact)return NextResponse.json({error:'Only this RM’s verified associated contacts can be edited.'},{status:403,headers});
 const [current]=await batchRead('contacts',[input.id],['hubspot_owner_id','lastmodifieddate']);
 if(current?.properties.hubspot_owner_id!==input.rmId||current.properties.lastmodifieddate!==input.version)return NextResponse.json({error:'Contact changed in HubSpot. Reload before saving.'},{status:409,headers});
 const definitions=await getPropertyDefinitions('contacts',keys);
 if(keys.some(k=>!definitions.find(f=>f.name===k)||!validReviewValue(definitions.find(f=>f.name===k)!,input.properties[k])))return NextResponse.json({error:'Invalid HubSpot property value'},{status:400,headers});
 const record=await updateRecordVerified('contacts',input.id,input.properties);
 invalidateRmJourney();
 return NextResponse.json({confirmed:true,record},{headers});
 }catch{return NextResponse.json({error:'Save could not be confirmed. Reload HubSpot before retrying; some values may already have been saved.'},{status:502,headers});}
}
