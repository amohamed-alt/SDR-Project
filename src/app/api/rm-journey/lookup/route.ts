import {NextRequest,NextResponse} from 'next/server';
import {searchCompanyCandidates} from '@/lib/hubspot';
import {sdrAdminAuthorized} from '@/lib/sdr-admin-auth';
import {hubspotRecordUrl} from '@/lib/config';
export const runtime='nodejs';
export async function GET(req:NextRequest){
 const headers={'Cache-Control':'private, no-store'};
 if(!sdrAdminAuthorized(req))return NextResponse.json({error:'Unlock SDR tools to search HubSpot.'},{status:401,headers});
 const name=(req.nextUrl.searchParams.get('name')||'').trim();
 if(name.length<2||name.length>200)return NextResponse.json({error:'Enter a company name of 2–200 characters.'},{status:400,headers});
 try{const result=await searchCompanyCandidates(name);return NextResponse.json({total:result.total,companies:result.results.map(c=>({id:c.id,name:c.properties.name,domain:c.properties.domain,url:hubspotRecordUrl('company',c.id)})),partial:result.total>result.results.length},{headers});}catch{return NextResponse.json({error:'HubSpot search unavailable. No absence inferred.'},{status:502,headers});}
}
