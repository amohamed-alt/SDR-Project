import { NextRequest, NextResponse } from 'next/server';
import { loadRmJourney } from '@/lib/rm-journey';
import { sdrAdminAuthorized } from '@/lib/sdr-admin-auth';
export const runtime='nodejs';
export const maxDuration=60;
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(!sdrAdminAuthorized(req))return NextResponse.json({error:'Unlock SDR tools to continue.'},{status:401,headers});
 const from=req.nextUrl.searchParams.get('from')||'',to=req.nextUrl.searchParams.get('to')||'';
 const valid=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 if(!valid(from)||!valid(to)||from>to||Date.parse(to)-Date.parse(from)>93*86400000)return NextResponse.json({error:'Choose a valid meeting date range of up to 93 days.'},{status:400,headers});
 try{return NextResponse.json(await loadRmJourney(from,to,req.nextUrl.searchParams.get('refresh')==='1'),{headers});}
 catch{return NextResponse.json({error:'HubSpot journey data is unavailable. No synthetic or empty results have been substituted.'},{status:502,headers});}
}
