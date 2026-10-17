import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMeetingCreatorQueue, normalizeSaudiMobile,
  MEETING_CREATOR_MARITA_OWNER, MEETING_CREATOR_DANIEL_OWNER,
} from "../src/lib/meeting-creator-queue.ts";

const company = {
  id: "c1", name: "Private Saudi Logistics", domain: "sample-logistics.sa",
  country: "Saudi Arabia", employeeCount: 850, industry: "Logistics",
  ownerId: MEETING_CREATOR_MARITA_OWNER, accountType: "Acquisition",
  accountStatus: "", openDeals: 0, detectedAts: "", activeJobs: 22,
  completeHistory: true,
};
const oldPerson = {
  id: "p1", companyId: "c1", firstName: "Old", lastName: "Contact",
  title: "HR Manager", phone: "+966501112233", mobilePhone: "",
  ownerId: MEETING_CREATOR_MARITA_OWNER, linkedinUrl: "", salesEmailLastReplied: "",
};
const newPerson = {
  id: "p2", companyId: "c1", firstName: "New", lastName: "Director",
  title: "Human Resources Director", phone: "0552223344", mobilePhone: "",
  ownerId: "", linkedinUrl: "", salesEmailLastReplied: "",
};
const noAnswer = {
  id: "call1", companyId: "c1", contactIds: ["p1"],
  toNumber: oldPerson.phone,
  disposition: "73a0d17f-1163-4015-bdd5-ec830791da20",
};

function queue(patch = {}) {
  return buildMeetingCreatorQueue({
    companies: [company], contacts: [oldPerson, newPerson], calls: [noAnswer],
    tasks: [], meetings: [], deals: [], ...patch,
  });
}

test("Saudi phone normalization handles +966, 05 and bare 5 formats, not HQ and foreign numbers", () => {
  assert.equal(normalizeSaudiMobile("+966 55 222 3344"), "+966552223344");
  assert.equal(normalizeSaudiMobile("0552223344"), "+966552223344");
  assert.equal(normalizeSaudiMobile("552223344"), "+966552223344");
  assert.equal(normalizeSaudiMobile("00966552223344"), "+966552223344");
  assert.equal(normalizeSaudiMobile("+966112345678"), "");
  assert.equal(normalizeSaudiMobile("+1 202 758 9338"), "");
});

test("reactivation uses a different decision maker, not the old attempted contact", () => {
  const rows = queue();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "call_ready");
  assert.equal(rows[0].motion, "reactivation");
  assert.equal(rows[0].contactId, "p2");
  assert.equal(rows[0].contactPhone, "+966552223344");
  assert.equal(rows[0].phoneEvidence, "saudi_mobile_format_unverified");
  assert.equal(rows[0].sdrId, MEETING_CREATOR_MARITA_OWNER);
});

test("an old contact cannot be presented as alternate", () => {
  const [row] = queue({ contacts: [oldPerson] });
  assert.equal(row.status, "needs_research");
  assert.equal(row.contactPhone, "");
});

test("connected call or meeting blocks any new SDR prospect", () => {
  const [connected] = queue({ calls: [noAnswer, { ...noAnswer, id: "call2", disposition: "f240bbac-87c9-4f6e-bf70-924b57d47db7" }] });
  assert.equal(connected.status, "protected");
  const [meeting] = queue({ meetings: [{ id:"m1", companyId:"c1", outcome:"COMPLETED" }] });
  assert.equal(meeting.status, "protected");
});

test("open task, positive reply or deal protects the account", () => {
  const [task] = queue({ tasks: [{id:"t1",companyId:"c1",status:"NOT_STARTED",subject:"Call alternate"}] });
  assert.equal(task.status, "protected");
  const [reply] = queue({ contacts:[oldPerson,{...newPerson,salesEmailLastReplied:"2026-10-01"}] });
  assert.equal(reply.status, "protected");
  const [deal] = queue({ companies:[{...company,openDeals:1}] });
  assert.equal(deal.status, "protected");
});

test("incomplete activity history never silently passes the call-ready gate", () => {
  const [row] = queue({ companies:[{...company,completeHistory:false}] });
  assert.equal(row.status, "needs_research");
  const [missingCallTarget] = queue({ calls:[{...noAnswer, contactIds:[],toNumber:""}] });
  assert.equal(missingCallTarget.status, "needs_research");
  const [unknownDisposition] = queue({ calls:[{...noAnswer,disposition:""}] });
  assert.equal(unknownDisposition.status, "needs_research");
});

test("RM ownership and customer status never reroute to SDR", () => {
  const [owned] = queue({companies:[{...company,ownerId:"999"}]});
  assert.equal(owned.status,"protected");
  const [retention] = queue({companies:[{...company,accountType:"Retention"}]});
  assert.equal(retention.status,"protected");
});

test("new never-called company with an HR leader and phone is call-ready", () => {
  const [row] = queue({ calls:[], contacts:[newPerson], companies:[{...company,ownerId:""}]});
  assert.equal(row.status,"call_ready");
  assert.equal(row.motion,"new_contact");
  assert.ok([MEETING_CREATOR_DANIEL_OWNER,MEETING_CREATOR_MARITA_OWNER].includes(row.sdrId));
});

test("same company domain is emitted once even if duplicate company records exist", () => {
  assert.equal(queue({companies:[company,{...company,id:"c2"}]}).length,1);
});

test("single wrong-number contact with completed task becomes alternate-research, never call-ready", () => {
  const wrong={...noAnswer,disposition:"17b47fee-58de-441e-a44c-c6300d46f273",title:"Call with Old Contact"};
  const [row]=queue({calls:[wrong],contacts:[oldPerson],tasks:[{id:"t1",companyId:"c1",status:"COMPLETED",subject:"Call Old Contact"}]});
  assert.equal(row.status,"needs_alternate");
  assert.equal(row.wrongNumberCalls,1);
  assert.equal(row.contactPhone,"");
  assert.match(row.reason,/Wrong number/i);
});

test("a matched called-name title excludes the old wrong number after a new HR person is found", () => {
  const wrong={...noAnswer, contactIds:[], toNumber:"", title:"Call with Old Contact",
    disposition:"17b47fee-58de-441e-a44c-c6300d46f273"};
  const [row]=queue({calls:[wrong],contacts:[oldPerson,newPerson]});
  assert.equal(row.status,"call_ready");
  assert.equal(row.contactId,"p2");
  assert.equal(row.contactPhone,"+966552223344");
  assert.equal(row.wrongNumberCalls,1);
});

test("a different person reusing the known wrong-number mobile is not call-ready", () => {
  const wrong={...noAnswer,disposition:"17b47fee-58de-441e-a44c-c6300d46f273",title:"Call with Old Contact"};
  const [row]=queue({calls:[wrong],contacts:[oldPerson,{...newPerson,phone:oldPerson.phone}]});
  assert.equal(row.status,"needs_alternate");
  assert.equal(row.contactPhone,"");
});

test("connected call or open future task blocks wrong-number reactivation", () => {
  const wrong={...noAnswer,disposition:"17b47fee-58de-441e-a44c-c6300d46f273"};
  assert.equal(queue({calls:[wrong,{...wrong,id:"c2",disposition:"f240bbac-87c9-4f6e-bf70-924b57d47db7"}],contacts:[oldPerson]})[0].status,"protected");
  assert.equal(queue({calls:[wrong],contacts:[oldPerson],tasks:[{id:"t2",companyId:"c1",status:"NOT_STARTED",subject:"Future task"}]})[0].status,"protected");
});
