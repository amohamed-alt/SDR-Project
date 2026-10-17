import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {buildMeetingCreatorQueue, MEETING_CREATOR_MARITA_OWNER, MEETING_CREATOR_OPS_OWNER} from "../src/lib/meeting-creator-queue.ts";

const api=fs.readFileSync("src/app/api/meeting-creator/push/route.ts","utf8");

test("reviewed task push is admin-only and requires an explicit selected batch",()=>{
  assert.match(api,/sdrAdminAuthorized\(request\)/);
  assert.match(api,/sameOrigin\(request\)/);
  assert.match(api,/action: z\.literal\("push_selected"\)/);
  assert.match(api,/\.min\(1\)\.max\(10\)/);
  assert.match(api,/x\.status==="call_ready"/);
  assert.match(api,/row\.phoneEvidence!=="saudi_mobile_format_unverified"/);
});

test("batch push rechecks all CRM associations, current activity, company identity and owner",()=>{
  for(const contract of [
    'linkedIds("companies","calls"','linkedIds("contacts","calls"',
    'linkedIds("companies","tasks"','linkedIds("contacts","tasks"',
    'linkedIds("companies","meetings"','linkedIds("companies","deals"',
    "CONNECTED_DISPOSITIONS","OPEN_STATUSES","possibleAliases",
    "createScheduledMaritaTask","HubSpot task creation rejected","hs_task_status:\"NOT_STARTED\"",
    "associationTypeId:204","associationTypeId:192",
  ]) assert.ok(api.includes(contract),contract);
});

test("write endpoint creates TASK only; no Apollo/SignalHire reveals or new Contacts",()=>{
  assert.doesNotMatch(api,/apollo|signalhire|\/crm\/v3\/objects\/contacts|createContact/i);
  assert.match(api,/existing-HubSpot-contact-task-only/);
});

test("operations-owned companies are eligible for owner-based SDR routing, RM owned remain protected",()=>{
 const base={
  id:"1",name:"Saudi Sample Logistics",domain:"logistics-sample.sa",
  country:"Saudi Arabia",employeeCount:850,industry:"Logistics",
  ownerId:MEETING_CREATOR_OPS_OWNER,accountType:"Acquisition",accountStatus:"",
  openDeals:0,detectedAts:"",activeJobs:10,completeHistory:true,
 };
 const person={
   id:"2",companyId:"1",firstName:"Example",lastName:"HR Director",
   title:"Human Resources Director",phone:"+966552345678",mobilePhone:"",
   ownerId:MEETING_CREATOR_OPS_OWNER,linkedinUrl:"",salesEmailLastReplied:"",
 };
 const x={companies:[base],contacts:[person],calls:[],tasks:[],meetings:[],deals:[]};
 const [ops]=buildMeetingCreatorQueue(x);
 assert.equal(ops.status,"call_ready");
 assert.ok([MEETING_CREATOR_MARITA_OWNER,"37624223"].includes(ops.sdrId));
 const [rm]=buildMeetingCreatorQueue({...x,companies:[{...base,ownerId:"76369997"}]});
 assert.equal(rm.status,"protected");
});

test("Meeting Creator push rechecks colleague calls and allows bounded 100/day task plan",()=>{
  assert.match(api,/readAssociations\("contacts","calls",allCompanyContacts\)/);
  assert.match(api,/WRONG_NUMBER_DISPOSITION/);
  assert.match(api,/dailyCapOverride:100/);
  assert.match(api,/elevatusTargetOverride:0/);
  assert.match(api,/source:\s*z\.enum\(\["inventory","wrong_number"\]\)/);
});
