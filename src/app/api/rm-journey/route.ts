import { validRmReportingRange } from '@/lib/rm-reporting-period';
import { NextRequest, NextResponse } from 'next/server';
import { loadRmJourney } from '@/lib/rm-journey';
import { sdrAdminAuthorized } from '@/lib/sdr-admin-auth';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(!sdrAdminAuthorized(req))return NextResponse.json({error:'Unlock SDR tools to continue.'},{status:401,headers});
 const from=req.nextUrl.searchParams.get('from')||'',to=req.nextUrl.searchParams.get('to')||'';
 if(!validRmReportingRange(from,to))return NextResponse.json({error:'Choose dates from 13 July 2026 through today.'},{status:400,headers});
 try{return NextResponse.json(await loadRmJourney(from,to,req.nextUrl.searchParams.get('refresh')==='1'),{headers});}
 catch{return NextResponse.json({error:'HubSpot journey data is unavailable. No synthetic or empty results have been substituted.'},{status:502,headers});}
}
