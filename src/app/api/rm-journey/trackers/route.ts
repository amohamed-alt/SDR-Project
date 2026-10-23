import { NextRequest,NextResponse } from 'next/server';
import { sdrAdminAuthorized } from '@/lib/sdr-admin-auth';
import { readMeetingSheet } from '@/lib/meeting-sheet';
import { SDR_PROFILES } from '@/lib/rm-journey-core';
import { trackerMeetingId,trackerRmId } from '@/lib/rm-tracker-core';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(!sdrAdminAuthorized(req))return NextResponse.json({error:'Unlock SDR tools to continue.'},{status:401,headers});
 const from=req.nextUrl.searchParams.get('from')||'',to=req.nextUrl.searchParams.get('to')||'';
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>93*86400000)return NextResponse.json({error:'Choose a valid meeting date range of up to 93 days.'},{status:400,headers});
 const sources=await Promise.all(SDR_PROFILES.map(async s=>{const sheet=await readMeetingSheet(s.id,req.nextUrl.searchParams.get('refresh')==='1');return {...sheet,owner:s.name,ownerId:s.id,rows:(sheet?.rows||[]).filter(r=>r.date>=from&&r.date<=to).map(r=>({...r,rmId:trackerRmId(r.salesRep),meetingId:trackerMeetingId(r.hubspotUrl),sdrId:s.id,sdr:s.name}))};}));
 return NextResponse.json({sources}, {headers});
}
