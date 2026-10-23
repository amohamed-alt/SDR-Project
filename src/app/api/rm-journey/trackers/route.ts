import { validRmReportingRange } from '@/lib/rm-reporting-period';
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
 if(!validRmReportingRange(from,to))return NextResponse.json({error:'Choose dates from 13 July 2026 through today.'},{status:400,headers});
 const sources=await Promise.all(SDR_PROFILES.map(async s=>{const sheet=await readMeetingSheet(s.id,req.nextUrl.searchParams.get('refresh')==='1');return {...sheet,owner:s.name,ownerId:s.id,rows:(sheet?.rows||[]).filter(r=>r.date>=from&&r.date<=to).map(r=>({...r,rmId:trackerRmId(r.salesRep),meetingId:trackerMeetingId(r.hubspotUrl),sdrId:s.id,sdr:s.name}))};}));
 return NextResponse.json({sources}, {headers});
}
