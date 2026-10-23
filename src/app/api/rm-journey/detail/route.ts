import { NextRequest,NextResponse } from 'next/server';
import { sdrAdminAuthorized } from '@/lib/sdr-admin-auth';
import { loadJourneyDetail } from '@/lib/rm-journey-detail';
import { RM_PROFILES } from '@/lib/rm-journey-core';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(!sdrAdminAuthorized(req))return NextResponse.json({error:'Unlock SDR tools to continue.'},{status:401,headers});
 const id=req.nextUrl.searchParams.get('meetingId')||'',rm=req.nextUrl.searchParams.get('rmId')||'';
 if(!/^\d+$/.test(id)||!RM_PROFILES.some(p=>p.id===rm))return NextResponse.json({error:'Invalid meeting or RM'},{status:400,headers});
 try{return NextResponse.json(await loadJourneyDetail(id,rm),{headers});}catch{return NextResponse.json({error:'Journey history could not be verified. Refresh or inspect the CRM record.'},{status:502,headers});}
}
