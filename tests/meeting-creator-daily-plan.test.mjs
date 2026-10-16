import assert from "node:assert/strict";
import test from "node:test";
import { planCreatorDay } from "../src/lib/meeting-creator-daily-plan.ts";
import {
  MEETING_CREATOR_MARITA_OWNER,
  MEETING_CREATOR_DANIEL_OWNER,
} from "../src/lib/meeting-creator-queue.ts";

function lead(i,owner, motion="new_contact",status="call_ready") {
  return {
    key:`test-${i}`,companyId:`company-${i}`,companyName:`Test ${i}`,
    domain:`test-${i}.sa`,employeeCount:500,status,motion,
    reason:"Sample",recommendedProduct:"Talentera",talenteraScore:80,evalufyScore:70,
    priority:80,sdrId:owner,sdrName:owner===MEETING_CREATOR_MARITA_OWNER?"Marita":"Daniel",
    contactId:`person-${i}`,contactName:"Example",contactTitle:"HR Director",
    contactPhone:"+966555551111",phoneEvidence:"saudi_mobile_format_unverified",
    contactLinkedIn:"",attemptedCalls:motion==="reactivation"?2:0,connectedCalls:0,openTasks:0,
  };
}

test("a 100-account SDR plan allows at most 25 reactivations",()=>{
  const ready=[
    ...Array.from({length:95},(_,i)=>lead(i,MEETING_CREATOR_MARITA_OWNER)),
    ...Array.from({length:60},(_,i)=>lead(100+i,MEETING_CREATOR_MARITA_OWNER,"reactivation")),
  ];
  const [marita,daniel]=planCreatorDay(ready);
  assert.equal(marita.total,100);
  assert.equal(marita.newAccounts,95);
  assert.equal(marita.reactivationAccounts,5);
  assert.equal(daniel.total,0);
  assert.equal(daniel.shortfall,100);
});

test("reactivation count is never padded beyond capped share",()=>{
  const ready=[
    ...Array.from({length:10},(_,i)=>lead(i,MEETING_CREATOR_DANIEL_OWNER)),
    ...Array.from({length:70},(_,i)=>lead(100+i,MEETING_CREATOR_DANIEL_OWNER,"reactivation")),
  ];
  const plan=planCreatorDay(ready)[1];
  assert.equal(plan.total,35);
  assert.equal(plan.newAccounts,10);
  assert.equal(plan.reactivationAccounts,25);
  assert.equal(plan.shortfall,65);
});

test("duplicated company and protected rows never enter SDR action queue",()=>{
  const x=lead(1,MEETING_CREATOR_MARITA_OWNER);
  const plans=planCreatorDay([x,{...x,key:"dup",contactId:"second"},lead(2,MEETING_CREATOR_DANIEL_OWNER,"new_contact","protected")]);
  assert.equal(plans[0].total,1);
  assert.equal(plans[1].total,0);
});
