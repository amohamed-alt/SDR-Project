import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listAcquisitionAccounts } from "@/lib/acquisition-data-api";
import { searchAll, readAssociations, batchRead } from "@/lib/hubspot";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import {
  buildMeetingCreatorQueue,
  type CreatorCompany, type CreatorContact, type CreatorCall,
  type CreatorTask, type CreatorMeeting, type CreatorDeal,
} from "@/lib/meeting-creator-queue";
import { normalizedCompanyDomain } from "@/lib/company-dedupe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The endpoint is PREVIEW-ONLY. No provider reveal, CRM mutation, task creation,
// LinkedIn automation or contact credit spend is reachable through this route.
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  scan: z.coerce.number().int().min(20).max(100).default(60),
});

function clean(value: unknown) {
  return String(value ?? "").trim();
}
function finiteNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}
function unique<T>(items: T[]) {
  return [...new Set(items)];
}
function flatten(map: Map<string,string[]>, keys: string[]) {
  return unique(keys.flatMap((id) => map.get(id) || []));
}
function indexById<T extends { id: string }>(records: T[]) {
  return new Map(records.map((r) => [String(r.id), r]));
}
function validSaudi(value: string) {
  return /saudi arabia|\bksa\b|السعودية|المملكة العربية السعودية/i.test(value);
}
const companyProps = [
  "name","domain","country","gtm_country","industry","gtm_industry","numberofemployees",
  "gtm_employee_count","hubspot_owner_id","hs_num_open_deals","account_type","account_status",
  "detected_ats","hs_last_booked_meeting_date","hs_last_open_task_date",
] as const;
const contactProps = [
  "firstname","lastname","jobtitle","phone","mobilephone","hubspot_owner_id",
  "gtm_linkedin_url","hs_sales_email_last_replied",
] as const;

export async function GET(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) {
    return NextResponse.json({ error:"Admin access required to view contacts and phones." }, { status:401 });
  }
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({error:"Invalid Meeting Creator scan options."},{status:400});

  try {
    const { limit, offset, scan } = parsed.data;
    // Stored acquisition inventory is the provider-credit-free discovery source.
    const inventory = await listAcquisitionAccounts({
      country:"Saudi Arabia", includeExcluded:true, limit:scan, offset,
    });
    const seed = inventory.accounts
      .filter((a) => a.domain && validSaudi(a.country) && Number(a.employeeCount || 0) >= 250)
      .filter((a) => a.exclusionStatus !== "excluded" || /already exists in hubspot/i.test(a.exclusionReason))
      .filter((a) => !a.domain.endsWith(".invalid") && a.status !== "pushed")
      .slice(0, scan);

    if (!seed.length) {
      return NextResponse.json({
        generatedAt:new Date().toISOString(),previewOnly:true,
        note:"No qualified companies on this inventory page. Use another offset or review the existing inventory.",
        summary:{readFromInventory:inventory.accounts.length,scanned:0,callReady:0,needsResearch:0,protected:0},
        pagination:{offset,scan,nextOffset:offset + inventory.accounts.length,sourceTotal:inventory.pagination?.filteredTotal || 0},
        accounts:[],
      },{headers:{"Cache-Control":"private, no-store"}});
    }

    // Prefer confirmed HubSpot company ids; also verify exact-domain matches.
    // Alias/parent/subsidiary matches are not automatically treated as net-new.
    const sourceDomains = unique(seed.map((a) => normalizedCompanyDomain(a.domain)).filter(Boolean));
    const storedIds = unique(seed.map((a) => clean(a.hubspotCompanyId)).filter((id) => /^\d+$/.test(id)));
    const companyMatches = await Promise.all([
      searchAll("companies",companyProps,[{propertyName:"domain",operator:"IN",values:sourceDomains}]),
      batchRead("companies",storedIds,companyProps),
    ]);
    const companiesById = new Map(companyMatches.flat().map((p) => [String(p.id),p]));
    const companiesByDomain = new Map([...companiesById.values()].map((p) => [normalizedCompanyDomain(p.properties.domain),p]));
    const confirmedCompanies = seed.map((a) => {
      const match = companiesById.get(clean(a.hubspotCompanyId)) || companiesByDomain.get(normalizedCompanyDomain(a.domain));
      return {seed:a,crm:match};
    });
    const matchedIds = unique(confirmedCompanies.map((x) => clean(x.crm?.id)).filter(Boolean));

    if (!matchedIds.length) {
      return NextResponse.json({
        generatedAt:new Date().toISOString(),previewOnly:true,
        note:"These inventory companies are not exact matched to HubSpot. Resolve company aliases before pushing.",
        summary:{readFromInventory:inventory.accounts.length,scanned:seed.length,callReady:0,needsResearch:seed.length,protected:0},
        pagination:{offset,scan,nextOffset:offset + inventory.accounts.length,sourceTotal:inventory.pagination?.filteredTotal || 0},
        accounts:confirmedCompanies.slice(0,limit).map(({seed:a})=>({
          key:`identity:${a.domain}`,companyId:"",companyName:a.name,domain:a.domain,
          employeeCount:a.employeeCount,status:"needs_research",motion:"new_contact",
          reason:"No exact CRM company match. Verify aliases, parent company and stored contact identities.",
          recommendedProduct:"Review",talenteraScore:0,evalufyScore:0,priority:a.gtmScore,
          sdrId:"",sdrName:"",contactId:"",contactName:"",contactTitle:"",
          contactPhone:"",phoneEvidence:"missing",contactLinkedIn:"",attemptedCalls:0,connectedCalls:0,openTasks:0,
        })),
      },{headers:{"Cache-Control":"private, no-store"}});
    }

    const [companyContacts, companyCalls, companyMeetings, companyTasks, companyDeals] = await Promise.all([
      readAssociations("companies","contacts",matchedIds),
      readAssociations("companies","calls",matchedIds),
      readAssociations("companies","meetings",matchedIds),
      readAssociations("companies","tasks",matchedIds),
      readAssociations("companies","deals",matchedIds),
    ]);

    const maxContactsPerCompany = 30;
    const scannedContacts = unique(matchedIds.flatMap((companyId) => (companyContacts.get(companyId)||[]).slice(0,maxContactsPerCompany)));
    const [contactCalls,contactMeetings,contactTasks,contacts] = await Promise.all([
      readAssociations("contacts","calls",scannedContacts),
      readAssociations("contacts","meetings",scannedContacts),
      readAssociations("contacts","tasks",scannedContacts),
      batchRead("contacts",scannedContacts,contactProps),
    ]);
    const companyCallsById = new Map<string,string[]>();
    const companyMeetingsById = new Map<string,string[]>();
    const companyTasksById = new Map<string,string[]>();
    for (const companyId of matchedIds) {
      const linkedContactIds = companyContacts.get(companyId) || [];
      companyCallsById.set(companyId,unique([
        ...(companyCalls.get(companyId)||[]),...flatten(contactCalls,linkedContactIds),
      ]));
      companyMeetingsById.set(companyId,unique([
        ...(companyMeetings.get(companyId)||[]),...flatten(contactMeetings,linkedContactIds),
      ]));
      companyTasksById.set(companyId,unique([
        ...(companyTasks.get(companyId)||[]),...flatten(contactTasks,linkedContactIds),
      ]));
    }

    const allCallIds=unique([...companyCallsById.values()].flat());
    const allMeetingIds=unique([...companyMeetingsById.values()].flat());
    const allTaskIds=unique([...companyTasksById.values()].flat());
    const allDealIds=flatten(companyDeals,matchedIds);
    const [callRows,meetingRows,taskRows,dealRows] = await Promise.all([
      batchRead("calls",allCallIds,["hs_call_disposition","hs_call_status","hs_call_to_number"]),
      batchRead("meetings",allMeetingIds,["hs_meeting_outcome","hs_meeting_start_time"]),
      batchRead("tasks",allTaskIds,["hs_task_status","hs_task_subject"]),
      batchRead("deals",allDealIds,["dealstage","pipeline"]),
    ]);
    const callsById=indexById(callRows);
    const meetingsById=indexById(meetingRows);
    const tasksById=indexById(taskRows);
    const dealsById=indexById(dealRows);
    const contactsById=indexById(contacts);

    const companyFacts:CreatorCompany[]=[];
    const contactFacts:CreatorContact[]=[];
    const callFacts:CreatorCall[]=[];
    const taskFacts:CreatorTask[]=[];
    const meetingFacts:CreatorMeeting[]=[];
    const dealFacts:CreatorDeal[]=[];

    for(const {seed:a,crm} of confirmedCompanies) {
      if(!crm)continue; // Missing/aliased identities enter the manual-review queue below.
      const id=String(crm.id);
      const p=crm.properties;
      const contactIds=companyContacts.get(id)||[];
      const allCompanyCalls=companyCallsById.get(id)||[];
      const allCompanyTasks=companyTasksById.get(id)||[];
      const allCompanyMeetings=companyMeetingsById.get(id)||[];
      const allCompanyDeals=companyDeals.get(id)||[];
      const completelyRead=contactIds.length<=maxContactsPerCompany
        && contactIds.every(x=>contactsById.has(x))
        && !(clean(p.hs_last_booked_meeting_date) && !allCompanyMeetings.length)
        && !(clean(p.hs_last_open_task_date) && !allCompanyTasks.length)
        && allCompanyCalls.every(x=>callsById.has(x))
        && allCompanyTasks.every(x=>tasksById.has(x))
        && allCompanyMeetings.every(x=>meetingsById.has(x))
        && allCompanyDeals.every(x=>dealsById.has(x));
      companyFacts.push({
        id,name:clean(p.name)||a.name,domain:normalizedCompanyDomain(p.domain)||normalizedCompanyDomain(a.domain),
        country:clean(p.country)||clean(p.gtm_country)||a.country,
        employeeCount:finiteNumber(p.numberofemployees)||finiteNumber(p.gtm_employee_count)||a.employeeCount,
        industry:clean(p.gtm_industry)||clean(p.industry)||a.industry,
        ownerId:clean(p.hubspot_owner_id),accountType:clean(p.account_type),
        accountStatus:clean(p.account_status),openDeals:finiteNumber(p.hs_num_open_deals),
        detectedAts:clean(p.detected_ats)||a.detectedAts,activeJobs:finiteNumber(a.activeJobs),
        completeHistory:completelyRead,
      });
      for(const cid of contactIds.slice(0,maxContactsPerCompany)){
        const contact=contactsById.get(cid);
        if(!contact)continue;
        const cp=contact.properties;
        contactFacts.push({
          id:cid,companyId:id,firstName:clean(cp.firstname),lastName:clean(cp.lastname),
          title:clean(cp.jobtitle),phone:clean(cp.phone),mobilePhone:clean(cp.mobilephone),
          ownerId:clean(cp.hubspot_owner_id),linkedinUrl:clean(cp.gtm_linkedin_url),
          salesEmailLastReplied:clean(cp.hs_sales_email_last_replied),
        });
      }
      for(const callId of allCompanyCalls){
        const call=callsById.get(callId);
        if(!call)continue;
        callFacts.push({
          id:callId,companyId:id,disposition:clean(call.properties.hs_call_disposition),
          toNumber:clean(call.properties.hs_call_to_number),
          contactIds:contactIds.filter((cid)=>(contactCalls.get(cid)||[]).includes(callId)),
        });
      }
      for(const taskId of allCompanyTasks){
        const task=tasksById.get(taskId);
        if(task)taskFacts.push({id:taskId,companyId:id,status:clean(task.properties.hs_task_status),subject:clean(task.properties.hs_task_subject)});
      }
      for(const meetingId of allCompanyMeetings){
        const meeting=meetingsById.get(meetingId);
        if(meeting)meetingFacts.push({id:meetingId,companyId:id,outcome:clean(meeting.properties.hs_meeting_outcome)});
      }
      for(const dealId of allCompanyDeals){
        const deal=dealsById.get(dealId);
        if(deal)dealFacts.push({id:dealId,companyId:id,stage:clean(deal.properties.dealstage),pipeline:clean(deal.properties.pipeline)});
      }
    }
    const evaluated=buildMeetingCreatorQueue({
      companies:companyFacts, contacts:contactFacts, calls:callFacts,
      tasks:taskFacts, meetings:meetingFacts, deals:dealFacts,
    });

    const identityReview=confirmedCompanies.filter((x)=>!x.crm).map(({seed:a})=>({
      key:`identity:${a.domain}`,companyId:"",companyName:a.name,domain:a.domain,
      employeeCount:a.employeeCount,status:"needs_research" as const,motion:"new_contact" as const,
      reason:"No exact CRM domain match; alternate domain/customer identity must be reviewed before outreach.",
      recommendedProduct:"Review",talenteraScore:0,evalufyScore:0,priority:a.gtmScore,
      sdrId:"",sdrName:"",contactId:"",contactName:"",contactTitle:"",
      contactPhone:"",phoneEvidence:"missing" as const,contactLinkedIn:"",attemptedCalls:0,connectedCalls:0,openTasks:0,
    }));
    const ready=evaluated.filter((x)=>x.status==="call_ready");
    const review=evaluated.filter((x)=>x.status==="needs_research");
    const blocked=evaluated.filter((x)=>x.status==="protected");
    return NextResponse.json({
      generatedAt:new Date().toISOString(),previewOnly:true,
      source:"Stored acquisition inventory + HubSpot read-only associations",
      policy:{
        paidContactCredits:0,crmWrites:0,
        phoneNote:"Saudi mobile FORMAT detected in CRM only; deliverability/identity not verified.",
        readyMeaning:"Review candidates, never automatic permission for task creation.",
        ownerRule:"Preserve SDR ownership; protected RM/customer/connected accounts are not reassigned.",
      },
      summary:{
        readFromInventory:inventory.accounts.length,scanned:seed.length,crmMatched:companyFacts.length,
        callReady:ready.length,needsResearch:review.length+identityReview.length,protected:blocked.length,
        maritaReady:ready.filter((x)=>x.sdrName==="Marita").length,
        danielReady:ready.filter((x)=>x.sdrName==="Daniel").length,
      },
      pagination:{offset,scan,nextOffset:offset + inventory.accounts.length,sourceTotal:inventory.pagination?.filteredTotal||0},
      accounts:[...ready,...review,...identityReview,...blocked].slice(0,limit),
    },{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){
    console.error("Meeting Creator queue failed",error);
    return NextResponse.json({error:error instanceof Error?error.message:"Unable to produce read-only lead queue."},
      {status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
