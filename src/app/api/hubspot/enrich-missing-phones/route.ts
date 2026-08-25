import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { batchRead, readAssociations, searchAll } from "@/lib/hubspot";
import type { HubSpotRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNALHIRE_CONNECTED_DISPOSITION = "f240bbac-87c9-4f6e-bf70-924b57d47db7";
const HUBSPOT_API_BASE = "https://api.hubapi.com";
const DEFAULT_CREATED_AFTER = "2026-07-10T00:00:00.000Z";

const inputSchema = z.object({
  execute: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(30),
  scanLimit: z.number().int().min(50).max(2000).default(600),
  createdAfter: z.string().trim().default(DEFAULT_CREATED_AFTER),
  retryPreviouslyEnriched: z.boolean().default(false),
});

type SignalHireContact = {
  type?: string;
  value?: string;
  rating?: number;
  subType?: string | null;
};

type SignalHireCandidate = {
  uid?: string;
  fullName?: string;
  contacts?: SignalHireContact[];
};

type SignalHireResult = {
  item?: string;
  status?: string;
  candidate?: SignalHireCandidate;
};

type EnrichmentOutcome = {
  contactId: string;
  name: string;
  linkedinUrl: string;
  status:
    | "updated"
    | "found_dry_run"
    | "no_phone"
    | "not_found"
    | "identity_mismatch"
    | "became_ineligible"
    | "api_error";
  phone?: string;
  mobilephone?: string;
  phoneConfidence?: number | null;
  mobileConfidence?: number | null;
  signalHireUid?: string;
  creditsLeft?: number | null;
  detail?: string;
};

type ContactUpdate = { id: string; properties: Record<string, string> };

function clean(value: unknown, max = 2000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function workerAuthorized(request: Request) {
  const expected = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  const supplied = clean(request.headers.get("x-acquisition-worker-key"), 1000);
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function createdAfterMillis(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("createdAfter must be a valid ISO date/time.");
  return String(parsed);
}

function enrichmentDate() {
  return new Date().toISOString().slice(0, 10);
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

function contactName(record: HubSpotRecord) {
  return clean([record.properties.firstname, record.properties.lastname].filter(Boolean).join(" "), 300)
    || clean(record.properties.email, 300)
    || String(record.id);
}

function linkedinFrom(record: HubSpotRecord) {
  return normalizeLinkedInUrl(
    clean(record.properties.gtm_linkedin_url)
    || clean(record.properties.linkedin_profile_link)
    || clean(record.properties.hs_linkedin_url),
  );
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

function identityMatches(hubspotName: string, signalHireName: string) {
  const left = normalizeName(hubspotName);
  const right = normalizeName(signalHireName);
  if (!left || !right) return false;
  if (left === right) return true;

  const a = left.split(" ").filter((part) => part.length > 1);
  const b = right.split(" ").filter((part) => part.length > 1);
  if (!a.length || !b.length) return false;

  const setB = new Set(b);
  const overlap = a.filter((token) => setB.has(token));
  const firstMatch = a[0] === b[0];
  const lastMatch = a[a.length - 1] === b[b.length - 1];
  return (firstMatch && lastMatch) || overlap.length >= Math.min(2, Math.min(a.length, b.length));
}

function isTrue(value: unknown) {
  const normalized = clean(value, 20).toLowerCase();
  return normalized === "true" || normalized === "1";
}

function isPositiveNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  fn: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      output[index] = await fn(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

async function hubspotBatchUpdate(inputs: ContactUpdate[]) {
  if (!inputs.length) return;
  const token = clean(process.env.HUBSPOT_PRIVATE_APP_TOKEN, 2000);
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");

  for (const batch of chunks(inputs, 100)) {
    const response = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts/batch/update`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: batch }),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HubSpot batch update failed (${response.status}): ${body.slice(0, 700)}`);
    }
  }
}

async function loadCandidateContacts(createdAfter: string, retryPreviouslyEnriched: boolean) {
  const properties = [
    "firstname",
    "lastname",
    "email",
    "phone",
    "mobilephone",
    "createdate",
    "gtm_linkedin_url",
    "linkedin_profile_link",
    "hs_linkedin_url",
    "signalhire_last_enriched_at",
  ];
  const linkedinFields = ["gtm_linkedin_url", "linkedin_profile_link", "hs_linkedin_url"];
  const merged = new Map<string, HubSpotRecord>();
  const minimum = createdAfterMillis(createdAfter);

  for (const field of linkedinFields) {
    const filters: Array<{ propertyName: string; operator: string; value?: string }> = [
      { propertyName: "createdate", operator: "GTE", value: minimum },
      { propertyName: "phone", operator: "NOT_HAS_PROPERTY" },
      { propertyName: "mobilephone", operator: "NOT_HAS_PROPERTY" },
      { propertyName: field, operator: "HAS_PROPERTY" },
    ];
    if (!retryPreviouslyEnriched) {
      filters.push({ propertyName: "signalhire_last_enriched_at", operator: "NOT_HAS_PROPERTY" });
    }
    const rows = await searchAll("contacts", properties, filters);
    for (const row of rows) merged.set(String(row.id), row);
  }

  return [...merged.values()]
    .filter((record) => Boolean(linkedinFrom(record)))
    .sort((a, b) => Date.parse(clean(b.properties.createdate)) - Date.parse(clean(a.properties.createdate)));
}

async function buildEligibilityPool(candidates: HubSpotRecord[], scanLimit: number) {
  const pool = candidates.slice(0, scanLimit);
  const ids = pool.map((record) => String(record.id));

  const [companyAssociations, dealAssociations, callAssociations, meetingAssociations] = await Promise.all([
    readAssociations("contacts", "companies", ids),
    readAssociations("contacts", "deals", ids),
    readAssociations("contacts", "calls", ids),
    readAssociations("contacts", "meetings", ids),
  ]);

  const companyIds = unique([...companyAssociations.values()].flat());
  const dealIds = unique([...dealAssociations.values()].flat());
  const callIds = unique([...callAssociations.values()].flat());

  const [companies, deals, calls] = await Promise.all([
    batchRead("companies", companyIds, ["name", "account_type", "account_status", "hs_num_open_deals"]),
    batchRead("deals", dealIds, ["dealname", "dealstage", "hs_is_closed"]),
    batchRead("calls", callIds, ["hs_call_disposition", "hs_connected_count", "hs_call_status"]),
  ]);

  const companyById = new Map(companies.map((record) => [String(record.id), record]));
  const dealById = new Map(deals.map((record) => [String(record.id), record]));
  const callById = new Map(calls.map((record) => [String(record.id), record]));

  const skipCounts: Record<string, number> = {
    retention: 0,
    company_open_deal: 0,
    contact_open_deal: 0,
    connected_call: 0,
    meeting: 0,
  };

  const eligible: HubSpotRecord[] = [];
  for (const record of pool) {
    const id = String(record.id);
    const associatedCompanies = (companyAssociations.get(id) || [])
      .map((companyId) => companyById.get(companyId))
      .filter((company): company is HubSpotRecord => Boolean(company));

    if (associatedCompanies.some((company) => clean(company.properties.account_type) === "Retention")) {
      skipCounts.retention += 1;
      continue;
    }
    if (associatedCompanies.some((company) => isPositiveNumber(company.properties.hs_num_open_deals))) {
      skipCounts.company_open_deal += 1;
      continue;
    }

    const associatedDeals = (dealAssociations.get(id) || [])
      .map((dealId) => dealById.get(dealId))
      .filter((deal): deal is HubSpotRecord => Boolean(deal));
    if (associatedDeals.some((deal) => !isTrue(deal.properties.hs_is_closed))) {
      skipCounts.contact_open_deal += 1;
      continue;
    }

    const associatedCalls = (callAssociations.get(id) || [])
      .map((callId) => callById.get(callId))
      .filter((call): call is HubSpotRecord => Boolean(call));
    const hasConnectedCall = associatedCalls.some((call) =>
      clean(call.properties.hs_call_disposition) === SIGNALHIRE_CONNECTED_DISPOSITION
      || isPositiveNumber(call.properties.hs_connected_count),
    );
    if (hasConnectedCall) {
      skipCounts.connected_call += 1;
      continue;
    }

    if ((meetingAssociations.get(id) || []).length > 0) {
      skipCounts.meeting += 1;
      continue;
    }

    eligible.push(record);
  }

  return { eligible, skipCounts, scanned: pool.length };
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
  const payload = await response.json().catch(() => null) as SignalHireResult[] | { error?: string; message?: string } | null;

  if (!response.ok) {
    const detail = payload && !Array.isArray(payload)
      ? clean(payload.error || payload.message || `HTTP ${response.status}`, 500)
      : `HTTP ${response.status}`;
    throw new Error(`SignalHire failed: ${detail}`);
  }

  const item = Array.isArray(payload) ? payload[0] : null;
  if (!item || item.status !== "success" || !item.candidate) {
    return { candidate: null as SignalHireCandidate | null, creditsLeft };
  }
  return { candidate: item.candidate, creditsLeft };
}

async function stillEligible(contactId: string) {
  const [current] = await batchRead("contacts", [contactId], ["phone", "mobilephone"]);
  if (!current) return false;
  if (clean(current.properties.phone) || clean(current.properties.mobilephone)) return false;

  const [companyAssociations, dealAssociations, callAssociations, meetingAssociations] = await Promise.all([
    readAssociations("contacts", "companies", [contactId]),
    readAssociations("contacts", "deals", [contactId]),
    readAssociations("contacts", "calls", [contactId]),
    readAssociations("contacts", "meetings", [contactId]),
  ]);

  if ((meetingAssociations.get(contactId) || []).length > 0) return false;

  const companyIds = companyAssociations.get(contactId) || [];
  if (companyIds.length) {
    const companies = await batchRead("companies", companyIds, ["account_type", "hs_num_open_deals"]);
    if (companies.some((company) => clean(company.properties.account_type) === "Retention")) return false;
    if (companies.some((company) => isPositiveNumber(company.properties.hs_num_open_deals))) return false;
  }

  const dealIds = dealAssociations.get(contactId) || [];
  if (dealIds.length) {
    const deals = await batchRead("deals", dealIds, ["hs_is_closed"]);
    if (deals.some((deal) => !isTrue(deal.properties.hs_is_closed))) return false;
  }

  const callIds = callAssociations.get(contactId) || [];
  if (callIds.length) {
    const calls = await batchRead("calls", callIds, ["hs_call_disposition", "hs_connected_count"]);
    if (calls.some((call) =>
      clean(call.properties.hs_call_disposition) === SIGNALHIRE_CONNECTED_DISPOSITION
      || isPositiveNumber(call.properties.hs_connected_count),
    )) return false;
  }

  return true;
}

async function enrichOne(
  record: HubSpotRecord,
  apiKey: string,
  execute: boolean,
): Promise<{ outcome: EnrichmentOutcome; update?: ContactUpdate }> {
  const contactId = String(record.id);
  const name = contactName(record);
  const linkedinUrl = linkedinFrom(record);

  try {
    const resolved = await signalHireResolve(apiKey, linkedinUrl);
    if (!resolved.candidate) {
      return {
        outcome: { contactId, name, linkedinUrl, status: "not_found", creditsLeft: resolved.creditsLeft },
        ...(execute
          ? { update: { id: contactId, properties: { signalhire_last_enriched_at: enrichmentDate() } } }
          : {}),
      };
    }

    const signalHireName = clean(resolved.candidate.fullName, 300);
    if (!identityMatches(name, signalHireName)) {
      return {
        outcome: {
          contactId,
          name,
          linkedinUrl,
          status: "identity_mismatch",
          signalHireUid: clean(resolved.candidate.uid, 160),
          creditsLeft: resolved.creditsLeft,
          detail: `HubSpot=${name}; SignalHire=${signalHireName || "unknown"}`,
        },
      };
    }

    const phones = phoneContacts(resolved.candidate);
    if (!phones.length) {
      return {
        outcome: {
          contactId,
          name,
          linkedinUrl,
          status: "no_phone",
          signalHireUid: clean(resolved.candidate.uid, 160),
          creditsLeft: resolved.creditsLeft,
        },
        ...(execute
          ? { update: { id: contactId, properties: { signalhire_last_enriched_at: enrichmentDate() } } }
          : {}),
      };
    }

    const mobile = phones.find((entry) => /mobile|cell/i.test(clean(entry.subType)));
    const direct = phones.find((entry) => entry !== mobile && !/mobile|cell/i.test(clean(entry.subType)));
    const fallback = phones[0];
    const mobilephone = clean(mobile?.value, 120);
    const phone = clean(direct?.value || (!mobile ? fallback?.value : ""), 120);
    const mobileConfidence = mobile?.rating ?? null;
    const phoneConfidence = (direct || (!mobile ? fallback : undefined))?.rating ?? null;

    if (!execute) {
      return {
        outcome: {
          contactId,
          name,
          linkedinUrl,
          status: "found_dry_run",
          phone,
          mobilephone,
          phoneConfidence,
          mobileConfidence,
          signalHireUid: clean(resolved.candidate.uid, 160),
          creditsLeft: resolved.creditsLeft,
        },
      };
    }

    if (!await stillEligible(contactId)) {
      return {
        outcome: {
          contactId,
          name,
          linkedinUrl,
          status: "became_ineligible",
          signalHireUid: clean(resolved.candidate.uid, 160),
          creditsLeft: resolved.creditsLeft,
          detail: "HubSpot changed during enrichment; no phone was written.",
        },
      };
    }

    const properties: Record<string, string> = {
      signalhire_last_enriched_at: enrichmentDate(),
    };
    if (phone) properties.phone = phone;
    if (mobilephone) properties.mobilephone = mobilephone;
    if (!properties.phone && !properties.mobilephone) {
      properties.phone = clean(fallback.value, 120);
    }

    return {
      outcome: {
        contactId,
        name,
        linkedinUrl,
        status: "updated",
        phone: properties.phone || "",
        mobilephone: properties.mobilephone || "",
        phoneConfidence,
        mobileConfidence,
        signalHireUid: clean(resolved.candidate.uid, 160),
        creditsLeft: resolved.creditsLeft,
      },
      update: { id: contactId, properties },
    };
  } catch (error) {
    return {
      outcome: {
        contactId,
        name,
        linkedinUrl,
        status: "api_error",
        detail: error instanceof Error ? error.message : "Unknown SignalHire error",
      },
    };
  }
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Internal enrichment authorization failed." }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid enrichment request.", issues: parsed.error.issues }, { status: 400 });
  }

  const apiKey = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  const startedAt = new Date().toISOString();

  try {
    const candidates = await loadCandidateContacts(parsed.data.createdAfter, parsed.data.retryPreviouslyEnriched);
    const eligibility = await buildEligibilityPool(candidates, parsed.data.scanLimit);
    const selected = eligibility.eligible.slice(0, parsed.data.limit);

    const resolved = await mapConcurrent(selected, 3, (record) => enrichOne(record, apiKey, parsed.data.execute));
    const updates = resolved.flatMap((item) => item.update ? [item.update] : []);
    if (parsed.data.execute && updates.length) await hubspotBatchUpdate(updates);

    const outcomes = resolved.map((item) => item.outcome);
    const updated = outcomes.filter((item) => item.status === "updated").length;
    const foundDryRun = outcomes.filter((item) => item.status === "found_dry_run").length;
    const noPhone = outcomes.filter((item) => item.status === "no_phone").length;
    const notFound = outcomes.filter((item) => item.status === "not_found").length;
    const identityMismatch = outcomes.filter((item) => item.status === "identity_mismatch").length;
    const becameIneligible = outcomes.filter((item) => item.status === "became_ineligible").length;
    const apiErrors = outcomes.filter((item) => item.status === "api_error").length;
    const creditsLeft = [...outcomes].reverse().find((item) => item.creditsLeft !== undefined)?.creditsLeft ?? null;

    return NextResponse.json({
      status: "completed",
      mode: parsed.data.execute ? "execute" : "dry_run",
      createdAfter: new Date(Date.parse(parsed.data.createdAfter)).toISOString(),
      retryPreviouslyEnriched: parsed.data.retryPreviouslyEnriched,
      startedAt,
      completedAt: new Date().toISOString(),
      totals: {
        rawCandidates: candidates.length,
        scannedForEligibility: eligibility.scanned,
        eligibleInScan: eligibility.eligible.length,
        selectedForSignalHire: selected.length,
        updated,
        foundDryRun,
        noPhone,
        notFound,
        identityMismatch,
        becameIneligible,
        apiErrors,
      },
      skippedBeforeSignalHire: eligibility.skipCounts,
      creditsLeft,
      outcomes,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Missing-phone enrichment failed.",
      startedAt,
    }, { status: 500 });
  }
}
