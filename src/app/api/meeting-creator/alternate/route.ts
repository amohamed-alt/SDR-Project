import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GET as queuePreview } from "@/app/api/meeting-creator/queue/route";
import { listAcquisitionPeople, upsertAcquisitionPeople, type AcquisitionPerson } from "@/lib/acquisition-data-api";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { rankAcquisitionCandidates } from "@/lib/acquisition-routing";
import { compatibleCompanyIdentity } from "@/lib/company-dedupe";
import type { CreatorQueueRow } from "@/lib/meeting-creator-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema=z.object({
  action:z.literal("find_alternate"),
  companyId:z.string().regex(/^\d{1,22}$/),
  source:z.enum(["inventory","wrong_number"]).default("wrong_number"),
  offset:z.number().int().min(0).max(100000).default(0),
  scan:z.number().int().min(20).max(100).default(60),
});
type Profile = {
  uid?: string; fullName?: string; location?: string;
  experience?: Array<{company?: string;title?: string;position?: string;current?: boolean}>;
  social?: Array<{type?:string;link?:string}>;
};
function clean(raw:unknown) {
  return String(raw??"").replace(/\s+/g," ").trim();
}
function normalizedPerson(raw:unknown) {
  return clean(raw).normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g," ").replace(/\s+/g," ").trim();
}
function sameOrigin(request:NextRequest){
  const site=request.headers.get("sec-fetch-site");
  if(site&&!["same-origin","same-site","none"].includes(site))return false;
  const origin=request.headers.get("origin");
  if(!origin)return true;
  try{return new URL(origin).host===request.nextUrl.host;}catch{return false;}
}
export async function POST(request:NextRequest) {
  if(!sameOrigin(request))return NextResponse.json({error:"Cross-site alternate research is blocked."},{status:403});
  if(!sdrAdminAuthorized(request))return NextResponse.json({error:"Admin authorization is required."},{status:401});
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Invalid alternate research request."},{status:400});
  const {companyId,source,offset,scan}=parsed.data;
  try{
    const u=new URL("/api/meeting-creator/queue",request.url);
    u.searchParams.set("source",source);u.searchParams.set("offset",String(offset));
    u.searchParams.set("scan",String(scan));u.searchParams.set("limit",String(scan));
    const preview=await queuePreview(new NextRequest(u,{headers:request.headers}));
    if(!preview.ok)return NextResponse.json({error:"CRM reactivation check failed. No research was started."},{status:409});
    const queue=await preview.json() as {accounts?:CreatorQueueRow[]};
    const row=queue.accounts?.find((item)=>item.companyId===companyId);
    if(!row||row.status!=="needs_alternate"||row.connectedCalls>0||row.openTasks>0){
      return NextResponse.json({error:"Company is not an eligible Needs Alternate account; refresh and review HubSpot."},{status:409});
    }
    const key=clean(process.env.SIGNALHIRE_API_KEY);
    if(!key)throw new Error("SignalHire search API is not configured.");
    const response=await fetch("https://www.signalhire.com/api/v1/candidate/searchByQuery",{
      method:"POST",headers:{apikey:key,"Content-Type":"application/json"},
      body:JSON.stringify({
        currentCompany:`"${row.companyName.replace(/"/g,"")}"`,
        currentTitle:'("Human Resources" OR "Talent Acquisition" OR Recruitment OR "Head of HR" OR CHRO) AND (Director OR Manager OR Head OR VP OR Chief)',
        size:30,
      }),
      cache:"no-store",signal:AbortSignal.timeout(25000),
    });
    const payload=await response.json().catch(()=>({})) as {profiles?:Profile[];total?:number;error?:string;message?:string};
    if(!response.ok)throw new Error(`SignalHire free candidate search returned HTTP ${response.status}: ${clean(payload.error||payload.message).slice(0,200)}`);
    const candidates=(payload.profiles||[]).map((p)=>{
      const exp=p.experience?.find((e)=>e.current) || p.experience?.[0];
      return {
        uid:clean(p.uid),fullName:clean(p.fullName),
        title:clean(exp?.title || exp?.position),currentCompany:clean(exp?.company),
        location:clean(p.location),
        linkedinUrl:clean(p.social?.find((s)=>/linkedin/i.test(clean(s.type)))?.link),
        currentConfirmed:Boolean(exp?.current),
      };
    }).filter((candidate)=>candidate.uid&&candidate.fullName&&candidate.currentConfirmed
      && normalizedPerson(candidate.fullName)!==normalizedPerson(row.contactName)
      && /\b(hr|human resources|talent|recruitment|people|chro|human capital)\b|موارد بشرية|التوظيف/i.test(candidate.title)
      && compatibleCompanyIdentity({
        requestedName:row.companyName,requestedDomain:"",
        existingName:candidate.currentCompany,existingDomain:"",
      }));
    const scored=rankAcquisitionCandidates(candidates,{
      accountName:row.companyName,country:"Saudi Arabia",
      primaryPersona:"HR Director",secondaryPersona:"Talent Acquisition Manager",
    }).filter((candidate)=>candidate.score>=45).slice(0,8);
    const stored=await listAcquisitionPeople(row.domain).catch(()=>({domain:row.domain,people:[] as AcquisitionPerson[]}));
    const previousIds=new Set(stored.people.map((person)=>person.uid));
    const records:AcquisitionPerson[]=scored.filter((p)=>!previousIds.has(p.uid)).map((person,index)=>({
      uid:person.uid,accountDomain:row.domain,
      fullName:person.fullName,title:person.title,currentCompany:person.currentCompany,
      location:person.location,linkedinUrl:person.linkedinUrl || "",
      rankScore:person.score,fitReason:person.reason,emails:[],phones:[],
      enrichmentStatus:"search_only",selected:index===0,
      meta:{provider:"SignalHire search-only",verifiedCurrentCompany:true,
        alternateForCompanyId:row.companyId,searchCheckedAt:new Date().toISOString(),
        excludedOldContactId:row.contactId},
    }));
    let storedCount=0;
    if(records.length) {
      try{await upsertAcquisitionPeople(records);storedCount=records.length;}
      catch(e){console.warn("Optional alternate-person cache unavailable",e);}
    }
    return NextResponse.json({
      action:"find_alternate",companyId,rowStatus:row.status,
      company:row.companyName,domain:row.domain,previousContact:row.contactName,
      searchTotal:Number(payload.total||0),matchedAlternates:scored.length,
      savedNewProfiles:storedCount,
      credits:{contactReveals:0,paidEnrichments:0},
      note:"Search-only profiles: no contact phones or emails revealed; do not create a call task until a different working number is obtained and verified.",
      people:scored.map((p)=>({
        uid:p.uid,name:p.fullName,title:p.title,currentCompany:p.currentCompany,
        linkedinUrl:p.linkedinUrl || "",score:p.score,phoneStatus:"not_revealed",
      })),
    },{headers:{"Cache-Control":"private, no-store"}});
  }catch(error) {
    console.error("Alternate-contact research failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to search alternate contacts."},{status:503});
  }
}
