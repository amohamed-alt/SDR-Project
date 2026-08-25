import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWNER_ID = "31644369";
const SOURCE_LABEL = "INTEGRATION";
const SOURCE_DETAIL = "Extensive-Lighter";
const HOLDING_DAY_START = Date.parse("2037-01-01T00:00:00.000Z");
const HOLDING_DAY_END = Date.parse("2037-01-01T23:59:59.999Z");
const CONNECTED_DISPOSITION = "f240bbac-87c9-4f6e-bf70-924b57d47db7";
const HUBSPOT_API_BASE = "https://api.hubapi.com";

const inputSchema = z.object({
  execute: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
});

type SignalHireContact = { type?: string; value?: string; rating?: number; subType?: string | null };
type SignalHireCandidate = { uid?: string; fullName?: string; contacts?: SignalHireContact[] };
type SignalHireResult = { status?: string; candidate?: SignalHireCandidate };
type ContactUpdate = { id: string; properties: Record<string, string> };
type Outcome = {
  contactId: string;
  status: "updated" | "no_phone" | "not_found" | "identity_mismatch" | "became_ineligible" | "api_error";
  creditsLeft?: number | null;
};

function clean(value: unknown, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(request: Request) {
  const expected = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  const supplied = clean(request.headers.get("x-acquisition-worker-key"), 1000);
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function isTrue(value: unknown) {
  const normalized = clean(value, 20).toLowerCase();
  return normalized === "true" || normalized === "1";
}

function isPositiveNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0;
}

function normalizeLinkedInUrl(raw: string) {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return "";
    if (!/^\/in\//i.test(url.pathname)) return "";
    url.protocol = "https:";
    url.hostname = "www.linkedin.com";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function linkedinFrom(record: HubSpotRecord) {
  return normalizeLinkedInUrl(
    clean(record.properties.gtm_linkedin_url)
      || clean(record.properties.linkedin_profile_link)
      || clean(record.properties.hs_linkedin_url),
  );
}

function contactName(record: HubSpotRecord) {
  return clean([record.properties.firstname, record.properties.lastname].filter(Boolean).join(" "), 300)
    || clean(record.properties.email, 300)
    || String(record.id);
}

function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identityMatches(leftRaw: string, rightRaw: string) {
  const left = normalizeName(leftRaw);
  const right = normalizeName(rightRaw);
  if (!left || !right) return false;
  if (left === right) return true;
  const a = left.split(" ").filter((part) => part.length > 1);
  const b = right.split(" ").filter((part) => part.length > 1);
  if (!a.length || !b.length) return false;
  const setB = new Set(b);
  const overlap = a.filter((token) => setB.has(token));
  return (a[0] === b[0] && a[a.length - 1] === b[b.length - 1])
    || overlap.length >= Math.min(2, Math.min(a.length, b.length));
}

function phoneContacts(candidate: SignalHireCandidate) {
  const entries = (candidate.contacts || [])
    .filter((entry) => clean(entry.type).toLowerCase() === "phone" && Boolean(clean(entry.value)))
    .sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = clean(entry.value).replace(/\s+/g, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size));
  return out;
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

async function hubspotBatchUpdate(inputs: ContactUpdate[]) {
  if (!inputs.length) return;
  const token = clean(process.env.HUBSPOT_PRIVATE_APP_TOKEN, 2000);
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  for (const batch of chunks(inputs, 100)) {
    const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/batch/update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ inputs: batch }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HubSpot batch update failed (${response.status}): ${body.slice(0, 500)}`);
    }
  }
}

function enrichmentDate() {
  return new Date().toISOString().slice(0, 10);
}

async function targetTasks() {
  return searchAll(
    "tasks",
    ["hs_task_status", "hs_timestamp", "hubspot_owner_id", "hs_object_source_label", "hs_object_source_detail_1"],
    [
      { propertyName: "hubspot_owner_id", operator: "EQ", value: OWNER_ID },
      { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
      { propertyName: "hs_object_source_label", operator: "EQ", value: SOURCE_LABEL },
      { propertyName: "hs_object_source_detail_1", operator: "EQ", value: SOURCE_DETAIL },
      {
        propertyName: "hs_timestamp",
        operator: "BETWEEN",
        value: String(HOLDING_DAY_START),
        highValue: String(HOLDING_DAY_END),
      },
    ],
    ["hs_object_id"],
  );
}

async function loadTargetContacts() {
  const tasks = await targetTasks();
  const taskIds = tasks.map((task) => String(task.id));
  const taskContacts = await readAssociations("tasks", "contacts", taskIds);
  const contactIds = [...new Set([...taskContacts.values()].flat())];
  const contacts = await batchRead("contacts", contactIds, [
    "firstname", "lastname", "email", "phone", "mobilephone",
    "gtm_linkedin_url", "linkedin_profile_link", "hs_linkedin_url",
    "signalhire_last_enriched_at",
  ]);
  const missingPhone = contacts.filter((record) => !clean(record.properties.phone) && !clean(record.properties.mobilephone));
  const withLinkedIn = missingPhone.filter((record) => Boolean(linkedinFrom(record)));
  const unattempted = withLinkedIn.filter((record) => !clean(record.properties.signalhire_last_enriched_at));
  return {
    tasks,
    taskIds,
    contacts,
    missingPhone,
    withLinkedIn,
    unattempted,
    tasksWithoutContact: taskIds.filter((id) => !(taskContacts.get(id) || []).length).length,
  };
}

async function eligibilityPool(candidates: HubSpotRecord[]) {
  const ids = candidates.map((record) => String(record.id));
  const [companyAssociations, dealAssociations, callAssociations, meetingAssociations] = await Promise.all([
    readAssociations("contacts", "companies", ids),
    readAssociations("contacts", "deals", ids),
    readAssociations("contacts", "calls", ids),
    readAssociations("contacts", "meetings", ids),
  ]);
  const companyIds = [...new Set([...companyAssociations.values()].flat())];
  const dealIds = [...new Set([...dealAssociations.values()].flat())];
  const callIds = [...new Set([...callAssociations.values()].flat())];
  const [companies, deals, calls] = await Promise.all([
    batchRead("companies", companyIds, ["account_type", "hs_num_open_deals"]),
    batchRead("deals", dealIds, ["hs_is_closed"]),
    batchRead("calls", callIds, ["hs_call_disposition", "hs_connected_count"]),
  ]);
  const companyById = new Map(companies.map((row) => [String(row.id), row]));
  const dealById = new Map(deals.map((row) => [String(row.id), row]));
  const callById = new Map(calls.map((row) => [String(row.id), row]));
  const skipped = { retention: 0, companyOpenDeal: 0, contactOpenDeal: 0, connectedCall: 0, meeting: 0 };
  const eligible: HubSpotRecord[] = [];

  for (const record of candidates) {
    const id = String(record.id);
    const linkedCompanies = (companyAssociations.get(id) || []).map((x) => companyById.get(x)).filter(Boolean) as HubSpotRecord[];
    if (linkedCompanies.some((row) => clean(row.properties.account_type) === "Retention")) { skipped.retention++; continue; }
    if (linkedCompanies.some((row) => isPositiveNumber(row.properties.hs_num_open_deals))) { skipped.companyOpenDeal++; continue; }
    const linkedDeals = (dealAssociations.get(id) || []).map((x) => dealById.get(x)).filter(Boolean) as HubSpotRecord[];
    if (linkedDeals.some((row) => !isTrue(row.properties.hs_is_closed))) { skipped.contactOpenDeal++; continue; }
    const linkedCalls = (callAssociations.get(id) || []).map((x) => callById.get(x)).filter(Boolean) as HubSpotRecord[];
    if (linkedCalls.some((row) => clean(row.properties.hs_call_disposition) === CONNECTED_DISPOSITION || isPositiveNumber(row.properties.hs_connected_count))) { skipped.connectedCall++; continue; }
    if ((meetingAssociations.get(id) || []).length) { skipped.meeting++; continue; }
    eligible.push(record);
  }
  return { eligible, skipped };
}

async function stillEligible(contactId: string) {
  const [current] = await batchRead("contacts", [contactId], ["phone", "mobilephone"]);
  if (!current || clean(current.properties.phone) || clean(current.properties.mobilephone)) return false;
  const [companyAssociations, dealAssociations, callAssociations, meetingAssociations] = await Promise.all([
    readAssociations("contacts", "companies", [contactId]),
    readAssociations("contacts", "deals", [contactId]),
    readAssociations("contacts", "calls", [contactId]),
    readAssociations("contacts", "meetings", [contactId]),
  ]);
  if ((meetingAssociations.get(contactId) || []).length) return false;
  const companies = await batchRead("companies", companyAssociations.get(contactId) || [], ["account_type", "hs_num_open_deals"]);
  if (companies.some((row) => clean(row.properties.account_type) === "Retention" || isPositiveNumber(row.properties.hs_num_open_deals))) return false;
  const deals = await batchRead("deals", dealAssociations.get(contactId) || [], ["hs_is_closed"]);
  if (deals.some((row) => !isTrue(row.properties.hs_is_closed))) return false;
  const calls = await batchRead("calls", callAssociations.get(contactId) || [], ["hs_call_disposition", "hs_connected_count"]);
  if (calls.some((row) => clean(row.properties.hs_call_disposition) === CONNECTED_DISPOSITION || isPositiveNumber(row.properties.hs_connected_count))) return false;
  return true;
}

async function signalHireResolve(apiKey: string, linkedinUrl: string) {
  const response = await fetch("https://www.signalhire.com/api/v1/candidate/search", {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [linkedinUrl], withoutWaterfall: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(35_000),
  });
  const creditsRaw = response.headers.get("x-credits-left");
  const creditsLeft = creditsRaw && Number.isFinite(Number(creditsRaw)) ? Number(creditsRaw) : null;
  const payload = await response.json().catch(() => null) as SignalHireResult[] | null;
  if (!response.ok) throw new Error(`SignalHire failed: HTTP ${response.status}`);
  const item = Array.isArray(payload) ? payload[0] : null;
  if (!item || item.status !== "success" || !item.candidate) return { candidate: null as SignalHireCandidate | null, creditsLeft };
  return { candidate: item.candidate, creditsLeft };
}

async function enrichOne(record: HubSpotRecord, apiKey: string, execute: boolean): Promise<{ outcome: Outcome; update?: ContactUpdate }> {
  const contactId = String(record.id);
  try {
    const resolved = await signalHireResolve(apiKey, linkedinFrom(record));
    if (!resolved.candidate) {
      return {
        outcome: { contactId, status: "not_found", creditsLeft: resolved.creditsLeft },
        ...(execute ? { update: { id: contactId, properties: { signalhire_last_enriched_at: enrichmentDate() } } } : {}),
      };
    }
    if (!identityMatches(contactName(record), clean(resolved.candidate.fullName, 300))) {
      return {
        outcome: { contactId, status: "identity_mismatch", creditsLeft: resolved.creditsLeft },
        ...(execute ? { update: { id: contactId, properties: { signalhire_last_enriched_at: enrichmentDate() } } } : {}),
      };
    }
    const phones = phoneContacts(resolved.candidate);
    if (!phones.length) {
      return {
        outcome: { contactId, status: "no_phone", creditsLeft: resolved.creditsLeft },
        ...(execute ? { update: { id: contactId, properties: { signalhire_last_enriched_at: enrichmentDate() } } } : {}),
      };
    }
    if (execute && !await stillEligible(contactId)) {
      return {
        outcome: { contactId, status: "became_ineligible", creditsLeft: resolved.creditsLeft },
        update: { id: contactId, properties: { signalhire_last_enriched_at: enrichmentDate() } },
      };
    }
    const mobile = phones.find((entry) => /mobile|cell/i.test(clean(entry.subType)));
    const direct = phones.find((entry) => entry !== mobile && !/mobile|cell/i.test(clean(entry.subType)));
    const properties: Record<string, string> = { signalhire_last_enriched_at: enrichmentDate() };
    if (mobile?.value) properties.mobilephone = clean(mobile.value, 120);
    if (direct?.value) properties.phone = clean(direct.value, 120);
    if (!properties.phone && !properties.mobilephone) properties.phone = clean(phones[0]?.value, 120);
    return {
      outcome: { contactId, status: "updated", creditsLeft: resolved.creditsLeft },
      ...(execute ? { update: { id: contactId, properties } } : {}),
    };
  } catch {
    return { outcome: { contactId, status: "api_error" } };
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  try {
    const target = await loadTargetContacts();
    const eligibility = await eligibilityPool(target.unattempted);
    const selected = eligibility.eligible.slice(0, parsed.data.limit);
    const resolved = await mapConcurrent(selected, 3, (record) => enrichOne(record, clean(process.env.SIGNALHIRE_API_KEY, 1000), parsed.data.execute));
    const updates = resolved.flatMap((item) => item.update ? [item.update] : []);
    if (parsed.data.execute && updates.length) await hubspotBatchUpdate(updates);
    const outcomes = resolved.map((item) => item.outcome);
    const count = (status: Outcome["status"]) => outcomes.filter((item) => item.status === status).length;
    const creditsLeft = [...outcomes].reverse().find((item) => item.creditsLeft !== undefined)?.creditsLeft ?? null;

    return NextResponse.json({
      status: "completed",
      mode: parsed.data.execute ? "execute" : "dry_run",
      scope: {
        ownerId: OWNER_ID,
        sourceLabel: SOURCE_LABEL,
        sourceDetail: SOURCE_DETAIL,
        holdingDate: "2037-01-01",
      },
      totals: {
        targetTasks: target.tasks.length,
        tasksWithoutContact: target.tasksWithoutContact,
        uniqueContacts: target.contacts.length,
        missingPhoneContacts: target.missingPhone.length,
        missingPhoneWithLinkedIn: target.withLinkedIn.length,
        previouslyAttemptedMissingPhone: target.withLinkedIn.length - target.unattempted.length,
        unattemptedMissingPhone: target.unattempted.length,
        eligibleForSignalHire: eligibility.eligible.length,
        selectedForSignalHire: selected.length,
        updated: count("updated"),
        noPhone: count("no_phone"),
        notFound: count("not_found"),
        identityMismatch: count("identity_mismatch"),
        becameIneligible: count("became_ineligible"),
        apiErrors: count("api_error"),
      },
      skippedBeforeSignalHire: eligibility.skipped,
      creditsLeft,
      outcomes,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Enrichment failed" }, { status: 500 });
  }
}
