import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GET as queuePreview } from "@/app/api/meeting-creator/queue/route";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { createScheduledMaritaTask, MaritaScheduleError } from "@/lib/marita-task-scheduler";
import {
  CONNECTED_DISPOSITIONS, ATTEMPT_DISPOSITIONS, normalizeSaudiMobile,
  MEETING_CREATOR_MARITA_OWNER, MEETING_CREATOR_DANIEL_OWNER,
  MEETING_CREATOR_OPS_OWNER, WRONG_NUMBER_DISPOSITION, type CreatorQueueRow,
} from "@/lib/meeting-creator-queue";
import { normalizedCompanyDomain } from "@/lib/company-dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.literal("push_selected"),
  offset: z.number().int().min(0).max(100000),
  source: z.enum(["inventory","wrong_number"]).default("inventory"),
  scan: z.number().int().min(20).max(100).default(60),
  limit: z.number().int().min(1).max(100).default(50),
  choices: z.array(z.object({
    companyId: z.string().regex(/^\d{1,22}$/),
    contactId: z.string().regex(/^\d{1,22}$/),
  })).min(1).max(10),
});
const OPEN_STATUSES = new Set(["NOT_STARTED","IN_PROGRESS","WAITING","DEFERRED"]);

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin","same-site","none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; }
  catch { return false; }
}
function clean(value: unknown) {
  return String(value??"").replace(/\s+/g," ").trim();
}
function ids(map: Map<string,string[]>, id: string) {
  return map.get(id)||[];
}
function uniq(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}
async function linkedIds(fromType:string,toType:string,sourceId:string){
  const r=await readAssociations(fromType,toType,[sourceId]);
  return ids(r,sourceId);
}
function validCompany(company:Record<string,unknown>,row:CreatorQueueRow){
  if(clean(company.domain)&&normalizedCompanyDomain(company.domain)!==normalizedCompanyDomain(row.domain))throw new Error("Company domain changed; review the account identity.");
  if(!/saudi arabia|\bksa\b|السعودية/i.test(clean(company.country)))throw new Error("Saudi market is not confirmed in HubSpot.");
  if(Number(company.numberofemployees||0)<250)throw new Error("Company no longer meets the 250+ employee threshold.");
  if(Number(company.hs_num_open_deals||0)>0)throw new Error("Company now has an open deal.");
  if(/retention|customer|active client/i.test(clean(company.account_type)+" "+clean(company.account_status)))throw new Error("Customer or Retention account is protected.");
  const existingOwner=clean(company.hubspot_owner_id);
  if(existingOwner && ![MEETING_CREATOR_MARITA_OWNER,MEETING_CREATOR_DANIEL_OWNER,MEETING_CREATOR_OPS_OWNER].includes(existingOwner))throw new Error("RM-owned company is protected.");
  if([MEETING_CREATOR_MARITA_OWNER,MEETING_CREATOR_DANIEL_OWNER].includes(existingOwner)&&existingOwner!==row.sdrId)throw new Error("Company SDR assignment changed.");
}
function nameToken(raw:string){
  const exclusions=new Set(["group","saudi","arabian","company","holding","holdings","international","services","management","investment","trading","contracting","construction","industrial","global","technology","solutions","limited","corporation","enterprises","arabia","industries"]);
  const tokens=clean(raw).toLowerCase().match(/[a-z]{5,}/g)||[];
  return tokens.find((token)=>!exclusions.has(token))||"";
}

async function preflight(row:CreatorQueueRow){
  const [company,contact]=await Promise.all([
    batchRead("companies",[row.companyId],["name","domain","country","numberofemployees","hs_num_open_deals","account_type","account_status","hubspot_owner_id","hs_last_booked_meeting_date"]),
    batchRead("contacts",[row.contactId],["firstname","lastname","jobtitle","phone","mobilephone","hubspot_owner_id","hs_sales_email_last_replied","phone_number_status"]),
  ]);
  if(!company[0]||!contact[0])throw new Error("Company or contact no longer exists.");
  const companyInfo=company[0].properties;
  const person=contact[0].properties;
  validCompany(companyInfo,row);
  const personPhone=normalizeSaudiMobile(person.mobilephone)||normalizeSaudiMobile(person.phone);
  if(!personPhone || personPhone!==row.contactPhone)throw new Error("Contact phone changed or is not Saudi mobile format.");
  if(/^(wrong number|exhausted|no answer)$/i.test(clean(person.phone_number_status))) {
    throw new Error("Selected contact has invalid or exhausted phone status; find another decision maker.");
  }
  if(clean(person.hs_sales_email_last_replied))throw new Error("Buyer has already replied by email.");
  if(person.hubspot_owner_id && ![row.sdrId,MEETING_CREATOR_OPS_OWNER].includes(clean(person.hubspot_owner_id)))throw new Error("Contact is assigned to another owner.");

  const linkedCompanies=await linkedIds("contacts","companies",row.contactId);
  if(!linkedCompanies.includes(row.companyId))throw new Error("Contact is no longer associated with this company.");

  // Fail closed on alternate legal names/domains, including existing active
  // accounts stored under another domain. This is a discovery gate, not fuzzy
  // authorization to merge company records.
  const token=nameToken(clean(companyInfo.name));
  if(!token)throw new Error("Company alias review required before the first push.");
  const possibleAliases=await searchAll("companies",["name","domain"],[{propertyName:"name",operator:"CONTAINS_TOKEN",value:token}]);
  const ownDomain=normalizedCompanyDomain(companyInfo.domain);
  if(possibleAliases.some((x)=>String(x.id)!==row.companyId
    && normalizedCompanyDomain(x.properties.domain)!==ownDomain
    && clean(x.properties.name).toLowerCase().includes(token))) {
    throw new Error("Possible duplicate company/domain: resolve the CRM identity before pushing.");
  }

  const [allCompanyContacts,companyCalls,personCalls,companyTasks,personTasks,companyMeetings,personMeetings,companyDeals]=await Promise.all([
    linkedIds("companies","contacts",row.companyId),
    linkedIds("companies","calls",row.companyId),
    linkedIds("contacts","calls",row.contactId),
    linkedIds("companies","tasks",row.companyId),
    linkedIds("contacts","tasks",row.contactId),
    linkedIds("companies","meetings",row.companyId),
    linkedIds("contacts","meetings",row.contactId),
    linkedIds("companies","deals",row.companyId),
  ]);
  // Include calls/tasks/meetings linked to OTHER contacts at the same company,
  // not just the selected person. A connected call on any colleague is protected.
  if (allCompanyContacts.length > 30) throw new Error("More than 30 CRM contacts: manual activity review required.");
  const [associatedCalls,associatedTasks,associatedMeetings]=await Promise.all([
    readAssociations("contacts","calls",allCompanyContacts),
    readAssociations("contacts","tasks",allCompanyContacts),
    readAssociations("contacts","meetings",allCompanyContacts),
  ]);
  const [calls,tasks,meetings,deals]=await Promise.all([
    batchRead("calls",uniq([...companyCalls,...personCalls,...allCompanyContacts.flatMap((id)=>ids(associatedCalls,id))]),["hs_call_disposition","hs_call_status","hs_call_to_number"]),
    batchRead("tasks",uniq([...companyTasks,...personTasks,...allCompanyContacts.flatMap((id)=>ids(associatedTasks,id))]),["hs_task_status"]),
    batchRead("meetings",uniq([...companyMeetings,...personMeetings,...allCompanyContacts.flatMap((id)=>ids(associatedMeetings,id))]),["hs_meeting_outcome"]),
    batchRead("deals",uniq(companyDeals),["pipeline","dealstage"]),
  ]);
  if(calls.some((c)=>CONNECTED_DISPOSITIONS.has(clean(c.properties.hs_call_disposition))))throw new Error("Connected call logged; protect the existing conversation.");
  if(calls.some((c)=>clean(c.properties.hs_call_disposition)===WRONG_NUMBER_DISPOSITION
    && normalizeSaudiMobile(c.properties.hs_call_to_number)===personPhone))throw new Error("Selected Saudi mobile has a prior wrong-number outcome.");
  if(calls.some((c)=>!ATTEMPT_DISPOSITIONS.has(clean(c.properties.hs_call_disposition))))throw new Error("Unclassified call outcome requires review.");
  if(tasks.some((t)=>OPEN_STATUSES.has(clean(t.properties.hs_task_status))))throw new Error("An open follow-up task already exists.");
  if(meetings.some((m)=>!["CANCELED","NO_SHOW","RESCHEDULED"].includes(clean(m.properties.hs_meeting_outcome))))throw new Error("Meeting history blocks a new acquisition task.");
  if(deals.some((d)=>clean(d.properties.pipeline)==="1026934003" || clean(d.properties.dealstage).toLowerCase()!=="closedlost"))throw new Error("Commercial deal or Retention history requires review.");
  if(clean(companyInfo.hs_last_booked_meeting_date))throw new Error("Meeting-booked rollup requires review.");
  return {phone:personPhone,companyName:clean(companyInfo.name),contactName:clean(person.firstname+" "+person.lastname),contactTitle:clean(person.jobtitle)};
}

async function createTask(row:CreatorQueueRow,person:{phone:string;companyName:string;contactName:string;contactTitle:string}) {
  const secret=clean(process.env.HUBSPOT_PRIVATE_APP_TOKEN);
  if(!secret)throw new Error("Server-side HubSpot access token is not configured.");
  const notes=[
    "Meeting Creator — manually selected, CRM rechecked",
    `Company: ${person.companyName} | ${row.domain}`,
    `Contact: ${person.contactName} | ${person.contactTitle}`,
    `Phone: ${person.phone} (Saudi format only; not dial-verified)`,
    `Product suggestion: ${row.recommendedProduct}`,
    `Talentera fit: ${row.talenteraScore}/100 | Evalufy fit: ${row.evalufyScore}/100`,
    `Motion: ${row.motion} | Prior failed attempts: ${row.attemptedCalls}`,
    `Evidence: ${row.reason}`,
    row.contactLinkedIn?`LinkedIn: ${row.contactLinkedIn}`:"",
    "Before calling: verify current HR title, company identity and phone ownership.",
  ].filter(Boolean).join("\n");
  return createScheduledMaritaTask({
    contactId:row.contactId,companyId:row.companyId,
    ownerId:row.sdrId as "31644369"|"37624223",
    dailyCapOverride:100,
    elevatusTargetOverride:0,
    elevatus:false,
    readTasks:()=>searchAll("tasks",["hs_task_status","hs_timestamp","hubspot_owner_id","hs_task_subject"],[
      {propertyName:"hubspot_owner_id",operator:"EQ",value:row.sdrId},
      {propertyName:"hs_task_status",operator:"NEQ",value:"COMPLETED"},
    ]),
    createTask:async(dueAt:string)=>{
      const response=await fetch("https://api.hubapi.com/crm/objects/2026-03/tasks",{
        method:"POST",
        headers:{"Authorization":`Bearer ${secret}`,"Content-Type":"application/json"},
        body:JSON.stringify({
          properties:{
            hs_timestamp:dueAt,hubspot_owner_id:row.sdrId,
            hs_task_subject:`🔥 Meeting Creator | Call ${person.contactName} | ${person.companyName}`,
            hs_task_body:notes,hs_task_status:"NOT_STARTED",hs_task_priority:"HIGH",hs_task_type:"CALL",
          },
          associations:[
            {to:{id:row.contactId},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId:204}]},
            {to:{id:row.companyId},types:[{associationCategory:"HUBSPOT_DEFINED",associationTypeId:192}]},
          ],
        }),
        cache:"no-store",signal:AbortSignal.timeout(25000),
      });
      if(!response.ok)throw new Error(`HubSpot task creation rejected (HTTP ${response.status}). Reconcile before retrying.`);
      const created=await response.json() as {id?:string};
      if(!created.id)throw new Error("Task request returned no ID. Reconcile before retrying.");
      return {id:String(created.id)};
    },
  });
}

export async function POST(request:NextRequest) {
  if(!sameOrigin(request))return NextResponse.json({error:"Cross-site task requests are blocked."},{status:403});
  if(!sdrAdminAuthorized(request))return NextResponse.json({error:"Admin authorization is required to push SDR tasks."},{status:401});
  const parsed=schema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({error:"Invalid push selection."},{status:400});
  const {offset,choices,source,scan,limit}=parsed.data;
  const uniqueChoice=new Map(choices.map((item)=>[item.companyId,item]));
  if(uniqueChoice.size!==choices.length)return NextResponse.json({error:"Select no more than one person per company per push."},{status:409});

  try{
    const url=new URL("/api/meeting-creator/queue",request.url);
    url.searchParams.set("offset",String(offset));
    url.searchParams.set("source",source);
    url.searchParams.set("scan",String(scan));
    url.searchParams.set("limit",String(limit));
    const previewRequest=new NextRequest(url,{headers:request.headers});
    const response=await queuePreview(previewRequest);
    const payload=await response.json() as {accounts?:CreatorQueueRow[];error?:string};
    if(!response.ok)return NextResponse.json({error:payload.error||"CRM safety preview failed; no tasks pushed."},{status:409});
    const eligible=new Map((payload.accounts||[]).filter(x=>x.status==="call_ready").map(x=>[x.companyId,x]));
    const results:Array<Record<string,unknown>>=[];
    for(const selected of choices){
      const row=eligible.get(selected.companyId);
      if(!row||row.contactId!==selected.contactId||row.phoneEvidence!=="saudi_mobile_format_unverified"){
        results.push({companyId:selected.companyId,status:"skipped",reason:"Lead is no longer call-ready or the selected contact changed."});
        continue;
      }
      if(![MEETING_CREATOR_MARITA_OWNER,MEETING_CREATOR_DANIEL_OWNER].includes(row.sdrId)){
        results.push({companyId:selected.companyId,status:"skipped",reason:"No approved SDR assignment."});
        continue;
      }
      try{
        const contact=await preflight(row);
        const result=await createTask(row,contact);
        const verify=await batchRead("tasks",[String(result.task.id)],["hs_task_subject","hubspot_owner_id","hs_timestamp","hs_task_status"]);
        if(!verify[0]||clean(verify[0].properties.hubspot_owner_id)!==row.sdrId)throw new Error("Task created but owner verification was inconclusive; reconcile before retrying.");
        results.push({companyId:row.companyId,contactId:row.contactId,ownerId:row.sdrId,
          status:"created",taskId:String(result.task.id),dueAt:result.dueAt});
      }catch(error){
        results.push({companyId:selected.companyId,contactId:selected.contactId,
          status:"skipped_or_review",reason:error instanceof Error?error.message:"HubSpot task creation requires reconciliation."});
      }
    }
    return NextResponse.json({
      previewOnly:false,pushScope:"existing-HubSpot-contact-task-only",
      selected:choices.length,
      created:results.filter(x=>x.status==="created").length,
      skipped:results.filter(x=>x.status!=="created").length,
      results,
    },{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    console.error("Meeting Creator reviewed task push failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Failed to verify CRM history."},{status:503});
  }
}
