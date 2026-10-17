import { scoreMeetingCreatorAccount } from "./meeting-creator.ts";
import { evaluateReactivation } from "./meeting-creator-reactivation.ts";

export const MEETING_CREATOR_MARITA_OWNER = "31644369";
export const MEETING_CREATOR_DANIEL_OWNER = "37624223";
export const MEETING_CREATOR_OPS_OWNER = "31594536";

export type CreatorCompany = {
  id: string;
  name: string;
  domain: string;
  country: string;
  employeeCount: number;
  industry: string;
  ownerId: string;
  accountType: string;
  accountStatus: string;
  openDeals: number;
  detectedAts: string;
  activeJobs: number;
  completeHistory: boolean;
};

export type CreatorContact = {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  title: string;
  phone: string;
  mobilePhone: string;
  ownerId: string;
  linkedinUrl: string;
  salesEmailLastReplied: string;
  phoneNumberStatus?: string;
};

export type CreatorCall = {
  id: string;
  companyId: string;
  contactIds: string[];
  toNumber: string;
  disposition: string;
  title?: string;
};

export type CreatorTask = {
  id: string;
  companyId: string;
  status: string;
  subject: string;
};

export type CreatorMeeting = {
  id: string;
  companyId: string;
  outcome: string;
};

export type CreatorDeal = {
  id: string;
  companyId: string;
  stage: string;
  pipeline: string;
};

export type CreatorQueueInput = {
  companies: CreatorCompany[];
  contacts: CreatorContact[];
  calls: CreatorCall[];
  tasks: CreatorTask[];
  meetings: CreatorMeeting[];
  deals: CreatorDeal[];
};

export type CreatorQueueRow = {
  key: string;
  companyId: string;
  companyName: string;
  domain: string;
  employeeCount: number;
  status: "call_ready" | "needs_research" | "needs_alternate" | "protected";
  motion: "new_contact" | "reactivation" | "blocked";
  reason: string;
  recommendedProduct: string;
  talenteraScore: number;
  evalufyScore: number;
  priority: number;
  sdrId: string;
  sdrName: string;
  contactId: string;
  contactName: string;
  contactTitle: string;
  contactPhone: string;
  phoneEvidence: "saudi_mobile_format_unverified" | "missing";
  contactLinkedIn: string;
  attemptedCalls: number;
  connectedCalls: number;
  openTasks: number;
  wrongNumberCalls?: number;
  wrongNumberContacts?: number;
  nextAction?: string;
};

export const CONNECTED_DISPOSITIONS = new Set([
  "f240bbac-87c9-4f6e-bf70-924b57d47db7", // Connected
  "2e7360c1-6b71-40e9-ab2b-30ae98a4678c", // Meeting booked
  "a4c4c377-d246-4b32-a13b-75a56a4cd0ff", // Left live message: human engaged
]);

export const WRONG_NUMBER_DISPOSITION = "17b47fee-58de-441e-a44c-c6300d46f273";

export const ATTEMPT_DISPOSITIONS = new Set([
  "73a0d17f-1163-4015-bdd5-ec830791da20", // No answer
  "9d9162e7-6cf3-4944-bf63-4dff82258764", // Busy
  "b2cf5968-551e-4856-9783-52b3da59a7d0", // Left voicemail
  WRONG_NUMBER_DISPOSITION, // Wrong number
]);

const OPEN_TASK_STATUSES = new Set(["NOT_STARTED", "IN_PROGRESS", "WAITING", "DEFERRED"]);
const NON_TARGET_PATTERN = /(?:\bministry\b|\bauthority\b|\bgovernment\b|\bmunicipality\b|\bjob board\b|\bjob marketplace\b|\bstaffing agency\b|\brecruitment agency\b|وزارة|هيئة حكومية|بلدية)/i;
const STRONG_HR_TITLE = /\b(chro|chief human|chief people|vp human|vice president human|hr director|human resources director|head of hr|head of human resources|head of talent|talent acquisition manager|recruitment manager|recruiting manager|recruitment director|talent acquisition director|people director|people and culture manager|human resources manager|human resource manager|hr manager|human capital manager|hr business partner|human resources business partner)\b|مدير الموارد البشرية|مدير التوظيف|رئيس الموارد البشرية|مدير استقطاب المواهب/i;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function clamp(n: number) {
  return Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
}
export function normalizeSaudiMobile(raw: unknown) {
  const value = clean(raw).replace(/[^\d+]/g, "");
  let digits = value.replace(/^\+/, "");
  if (digits.startsWith("00966")) digits = digits.slice(2);
  if (/^05\d{8}$/.test(digits)) digits = "966" + digits.slice(1);
  if (/^5\d{8}$/.test(digits)) digits = "966" + digits;
  return /^9665\d{8}$/.test(digits) ? "+" + digits : "";
}
function comparableName(value: string) {
  return clean(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g," ").replace(/\s+/g," ").trim();
}
function safeNumber(value: unknown) {
  return Math.max(0, Number(value) || 0);
}
function eligibleCountry(country: string) {
  return /saudi arabia|\bksa\b|السعودية|المملكة العربية السعودية/i.test(country);
}
function titleFit(title: string) {
  return STRONG_HR_TITLE.test(clean(title));
}
function ownerFor(company: CreatorCompany, product: string, talenteraScore: number, evalufyScore: number) {
  if (company.ownerId === MEETING_CREATOR_MARITA_OWNER) return { id: company.ownerId, name: "Marita" };
  if (company.ownerId === MEETING_CREATOR_DANIEL_OWNER) return { id: company.ownerId, name: "Daniel" };
  const evalufy = product === "Evalufy" || (product === "Talentera + Evalufy" && evalufyScore > talenteraScore);
  return evalufy ? { id: MEETING_CREATOR_DANIEL_OWNER, name: "Daniel" } : { id: MEETING_CREATOR_MARITA_OWNER, name: "Marita" };
}

/**
 * Read-only lead candidate scorer. Any uncertain association, ownership, phone or
 * activity history must remain in needs_research, never silently become call_ready.
 * A call-ready result is an internal review candidate, NOT permission to create tasks.
 */
export function buildMeetingCreatorQueue(input: CreatorQueueInput): CreatorQueueRow[] {
  const byCompany = <T extends { companyId: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const row of rows) map.set(row.companyId, [...(map.get(row.companyId) || []), row]);
    return map;
  };
  const people = byCompany(input.contacts);
  const calls = byCompany(input.calls);
  const tasks = byCompany(input.tasks);
  const meetings = byCompany(input.meetings);
  const deals = byCompany(input.deals);
  const seen = new Set<string>();
  const result: CreatorQueueRow[] = [];

  for (const company of input.companies) {
    const domain = clean(company.domain).toLowerCase().replace(/^www\./, "");
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const sourcePeople = people.get(company.id) || [];
    const allCalls = calls.get(company.id) || [];
    const allTasks = tasks.get(company.id) || [];
    const allMeetings = meetings.get(company.id) || [];
    const allDeals = deals.get(company.id) || [];
    const openTasks = allTasks.filter((t) => OPEN_TASK_STATUSES.has(t.status.toUpperCase())).length;
    const connectedCalls = allCalls.filter((c) => CONNECTED_DISPOSITIONS.has(clean(c.disposition))).length;
    const attemptedCalls = allCalls.filter((c) => ATTEMPT_DISPOSITIONS.has(clean(c.disposition))).length;
    const wrongNumberCalls = allCalls.filter((c) => clean(c.disposition) === WRONG_NUMBER_DISPOSITION).length;
    const unresolvedDisposition = allCalls.some((c) => !CONNECTED_DISPOSITIONS.has(clean(c.disposition)) && !ATTEMPT_DISPOSITIONS.has(clean(c.disposition)));
    const calledIds = new Set<string>();
    const calledNumbers = new Set<string>();
    const unlinkedCalls = new Set<string>();
    for (const call of allCalls) {
      const normalizedNumber = normalizeSaudiMobile(call.toNumber);
      if (normalizedNumber) calledNumbers.add(normalizedNumber);
      const explicitIds = call.contactIds.filter((id) => sourcePeople.some((person) => person.id === id));
      for (const id of explicitIds) calledIds.add(id);
      if (explicitIds.length) continue;
      const matchesByPhone = normalizedNumber ? sourcePeople.filter((person) =>
        [normalizeSaudiMobile(person.phone),normalizeSaudiMobile(person.mobilePhone)].includes(normalizedNumber)) : [];
      const titleName = comparableName(call.title || "").replace(/^call with /,"");
      const matchesByTitle = titleName ? sourcePeople.filter((person) =>
        comparableName(person.firstName+" "+person.lastName) === titleName) : [];
      const matches = [...new Set([...matchesByPhone,...matchesByTitle].map((person) => person.id))];
      if (matches.length === 1) calledIds.add(matches[0]);
      else unlinkedCalls.add(call.id);
    }
    const unknownCalledPerson = unlinkedCalls.size > 0;
    const singleWrongNumberWithUnknownPerson = wrongNumberCalls > 0 && sourcePeople.length === 1 && unknownCalledPerson;
    const meaningfulMeeting = allMeetings.some((m) => m.outcome.toUpperCase() !== "CANCELED" && m.outcome.toUpperCase() !== "NO_SHOW" && m.outcome.toUpperCase() !== "RESCHEDULED");
    const positiveReplies = sourcePeople.filter((p) => clean(p.salesEmailLastReplied)).length;
    const invalidPhoneContacts=sourcePeople.filter((p)=>/^(wrong number|exhausted)$/i.test(clean(p.phoneNumberStatus)));
    const wrongNumberContacts=sourcePeople.filter((p)=>/^wrong number$/i.test(clean(p.phoneNumberStatus))).length;
    const protectedOwner = Boolean(company.ownerId && ![MEETING_CREATOR_MARITA_OWNER,MEETING_CREATOR_DANIEL_OWNER,MEETING_CREATOR_OPS_OWNER].includes(company.ownerId));
    const protectedAccount = !eligibleCountry(company.country)
      || company.employeeCount < 250
      || NON_TARGET_PATTERN.test(company.name)
      || protectedOwner
      || /retention|customer|churned|active customer/i.test(company.accountType + " " + company.accountStatus)
      || safeNumber(company.openDeals) > 0
      || allDeals.some((d) => d.pipeline === "1026934003" || d.stage.toLowerCase() === "closedwon"
        || !["closedwon","closedlost"].includes(d.stage.toLowerCase()))
      || meaningfulMeeting || connectedCalls > 0 || positiveReplies > 0 || openTasks > 0;
    const product = scoreMeetingCreatorAccount({
      companyId: company.id, name: company.name, domain, country: company.country,
      employeeCount: company.employeeCount, industry: company.industry,
      ats: company.detectedAts, activeJobs: safeNumber(company.activeJobs),
    });
    const defaultOwner = ownerFor(company, product.recommendedProduct, product.talenteraScore, product.evalufyScore);
    const historicalSdrOwners = [...new Set(sourcePeople
      .filter((p)=>calledIds.has(p.id))
      .map((p)=>p.ownerId)
      .filter((id)=>id===MEETING_CREATOR_MARITA_OWNER||id===MEETING_CREATOR_DANIEL_OWNER))];
    const ownerConflict = historicalSdrOwners.length > 1 ||
      (historicalSdrOwners.length===1 && [MEETING_CREATOR_MARITA_OWNER,MEETING_CREATOR_DANIEL_OWNER].includes(company.ownerId)
        && company.ownerId!==historicalSdrOwners[0]);
    const owner = historicalSdrOwners.length===1 && !ownerConflict
      ? { id:historicalSdrOwners[0],name:historicalSdrOwners[0]===MEETING_CREATOR_MARITA_OWNER?"Marita":"Daniel" }
      : defaultOwner;
    const wrongContactIds = new Set(allCalls.filter((call)=>call.disposition===WRONG_NUMBER_DISPOSITION).flatMap((call)=>call.contactIds));
    const wrongNumbers = new Set(allCalls.filter((call)=>call.disposition===WRONG_NUMBER_DISPOSITION)
      .map((call)=>normalizeSaudiMobile(call.toNumber)).filter(Boolean));
    const rankedPeople = [...sourcePeople]
      .filter((p) => !p.ownerId || p.ownerId === owner.id || p.ownerId === MEETING_CREATOR_OPS_OWNER)
      .map((p) => {
        const phone = normalizeSaudiMobile(p.mobilePhone) || normalizeSaudiMobile(p.phone);
        const persona = titleFit(p.title);
        const different = !calledIds.has(p.id) && !wrongContactIds.has(p.id)
          && !/^(wrong number|exhausted|no answer)$/i.test(clean(p.phoneNumberStatus))
          && (!phone || (!calledNumbers.has(phone) && !wrongNumbers.has(phone)))
          && !(singleWrongNumberWithUnknownPerson && sourcePeople.length === 1);
        return { p, phone, persona, different, weight: (persona ? 100 : 0) + (phone ? 50 : 0) + (different ? 30 : 0) };
      })
      .sort((a, b) => b.weight - a.weight || a.p.id.localeCompare(b.p.id));
    const best = rankedPeople.find((x) => x.persona && x.phone && x.different);
    const motion = allCalls.length ? "reactivation" : "new_contact";
    let status: CreatorQueueRow["status"] = "needs_research";
    let reason = "Find a different current HR decision maker with a Saudi mobile number.";
    if (protectedAccount) {
      status = "protected";
      reason = safeNumber(company.openDeals) || allDeals.length ? "Existing deal / opportunity requires Sales review."
        : protectedOwner ? "RM / another active owner controls this account."
          : connectedCalls ? "Connected call exists on this account."
            : meaningfulMeeting ? "Meeting already logged on account."
              : openTasks ? "Open SDR follow-up / task already exists."
                : positiveReplies ? "Positive email reply exists."
                  : "Account outside approved acquisition scope.";
    } else if (ownerConflict) {
      reason = "Different SDRs have contacted this account; confirm original assignment before any new task.";
    } else if (!company.completeHistory || unresolvedDisposition || (unknownCalledPerson && !singleWrongNumberWithUnknownPerson)) {
      reason = "Activity history is incomplete or a call has an unknown outcome/person. Manual review required.";
    } else if (allCalls.length && attemptedCalls !== allCalls.length) {
      reason = "Some call outcomes cannot be classified as failed attempts.";
    } else if (singleWrongNumberWithUnknownPerson) {
      status = "needs_alternate";
      reason = "Wrong number on the only contact; previous call identity requires confirmation before new outreach.";
    } else if (best) {
      const reactivation = allCalls.length ? evaluateReactivation({
        attemptedCalls, connectedCalls, bookedMeetings: allMeetings.length,
        openDeals: company.openDeals, openFollowUpTasks: openTasks, positiveReplies,
        completeCallHistory: company.completeHistory,
        newContactId: best.p.id, previouslyCalledContactIds: [...calledIds],
        newContactCurrentEmployerVerified: true,
        newContactDecisionMakerFit: best.persona,
        newContactBusinessPhoneAvailable: Boolean(best.phone),
      }) : { status: "eligible" as const, reason: "Uncontacted company with eligible HR decision maker." };
      if (reactivation.status === "eligible") {
        status = "call_ready";
        reason = allCalls.length
          ? `${attemptedCalls} unanswered/busy/voicemail/wrong-number call attempts; alternate HR contact available.`
          : "No logged calls; matching HR decision maker and mobile already exist in HubSpot.";
      } else {
        reason = reactivation.reason;
      }
    } else if (invalidPhoneContacts.length > 0 && !best) {
      status = "needs_alternate";
      reason = wrongNumberContacts
        ? "HubSpot Contact Phone Number Status = Wrong Number; find a new HR decision maker and a different phone."
        : "Old contact phone is exhausted; research another HR decision maker.";
    } else if (wrongNumberCalls > 0 && allCalls.length > 0) {
      status = "needs_alternate";
      reason = wrongNumberCalls === 1
        ? "Wrong number on the previous contact; find a different verified HR decision maker and a different phone."
        : `${wrongNumberCalls} wrong-number calls; find a different HR decision maker and verify the new phone.`;
    } else if (attemptedCalls > 0 && !best) {
      status = "needs_alternate";
      reason = `${attemptedCalls} unsuccessful call attempt(s) but no different phone-ready HR contact. Find a new decision maker.`;
    }
    const selected = best || rankedPeople[0];
    const priority = clamp(product.meetingScore + (best?.phone ? 5 : 0) + (allCalls.length && status === "call_ready" ? 3 : 0));
    result.push({
      key: `${company.id}:${selected?.p.id || "unmapped"}`,
      companyId: company.id, companyName: company.name, domain,
      employeeCount: company.employeeCount, status, motion: status === "protected" ? "blocked" : motion, reason,
      recommendedProduct: product.recommendedProduct,
      talenteraScore: product.talenteraScore, evalufyScore: product.evalufyScore,
      priority, sdrId: owner.id, sdrName: owner.name,
      contactId: selected?.p.id || "", contactName: selected ? clean(selected.p.firstName + " " + selected.p.lastName) : "",
      contactTitle: selected?.p.title || "",
      contactPhone: status === "call_ready" ? best?.phone || "" : "",
      phoneEvidence: status === "call_ready" && best?.phone ? "saudi_mobile_format_unverified" : "missing",
      contactLinkedIn: selected?.p.linkedinUrl || "",
      attemptedCalls, connectedCalls, openTasks, wrongNumberCalls, wrongNumberContacts,
      nextAction: status === "needs_alternate" ? "Search-only: find a different HR decision maker; verify employer and new Saudi phone before creating a task." : "",
    });
  }
  return result.sort((a,b) =>
    ({call_ready:0,needs_alternate:1,needs_research:2,protected:3})[a.status] - ({call_ready:0,needs_alternate:1,needs_research:2,protected:3})[b.status]
      || b.priority - a.priority || a.companyName.localeCompare(b.companyName));
}
