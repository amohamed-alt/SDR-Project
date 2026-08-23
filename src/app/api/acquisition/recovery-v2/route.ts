import { timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as prospectingPushPost } from "@/app/api/prospecting/push/route";
import {
  listAcquisitionAccounts,
  listAcquisitionPeople,
  upsertAcquisitionAccounts,
  upsertAcquisitionPeople,
  type AcquisitionAccount,
  type AcquisitionPerson,
} from "@/lib/acquisition-data-api";
import {
  acquisitionOwners,
  chooseAcquisitionOwner,
  rankAcquisitionCandidates,
  signalHirePersonaQuery,
  type CandidateProfile,
} from "@/lib/acquisition-routing";
import { searchAll } from "@/lib/hubspot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({ limit: z.number().int().min(1).max(6).default(4) });
const MARKER_PATH = process.env.ACQUISITION_RECOVERY_V2_MARKER_PATH || "/app/data/acquisition-recovery-v2-2026-08-22.json";
const RECOVERY_DOMAINS = [
  "cc7international.com",
  "wynnalmarjanisland.com",
  "alhudacibe.com",
  "blueoceancorporation.com",
  "alaan.com",
  "jal.com.sa",
] as const;

type SignalHireSearchProfile = {
  uid?: string;
  fullName?: string;
  location?: string;
  experience?: Array<{ company?: string | null; title?: string | null; position?: string | null; current?: boolean }>;
  social?: Array<{ type?: string; link?: string; rating?: number }>;
};

type SignalHireSearchResponse = {
  total?: number;
  profiles?: SignalHireSearchProfile[];
  error?: string;
  message?: string;
};

type SignalHireContact = { type?: string; value?: string; rating?: number; subType?: string | null };
type SignalHireCandidate = {
  uid?: string;
  fullName?: string;
  headLine?: string | null;
  locations?: Array<{ name?: string }>;
  contacts?: SignalHireContact[];
  social?: Array<{ type?: string; link?: string; rating?: number }>;
  experience?: Array<{
    position?: string | null;
    company?: string | null;
    location?: string | null;
    current?: boolean;
  }>;
};
type SignalHirePersonResult = { status?: string; candidate?: SignalHireCandidate; error?: string };

function clean(value: unknown, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
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

function ownerBridge(workerKey: string) {
  if (!clean(process.env.ACQUISITION_OWNER_TOKEN, 500)) process.env.ACQUISITION_OWNER_TOKEN = workerKey;
  return clean(process.env.ACQUISITION_OWNER_TOKEN, 500);
}

async function completedMarker() {
  try {
    return JSON.parse(await readFile(/* turbopackIgnore: true */ MARKER_PATH, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentSearchExperience(profile: SignalHireSearchProfile) {
  const experiences = profile.experience || [];
  return experiences.find((item) => item.current) || experiences[0] || {};
}

function profileLinkedIn(profile: SignalHireSearchProfile) {
  return clean((profile.social || []).find((item) => /linkedin/i.test(clean(item.type)))?.link, 1200);
}

async function searchSignalHire(apiKey: string, body: Record<string, unknown>) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://www.signalhire.com/api/v1/candidate/searchByQuery", {
        method: "POST",
        headers: { apikey: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      const payload = await response.json().catch(() => ({})) as SignalHireSearchResponse;
      if (response.ok) return payload;
      const message = clean(payload.error || payload.message || `HTTP ${response.status}`);
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await sleep(1500 * attempt);
        continue;
      }
      throw new Error(`SignalHire Search failed (${response.status}): ${message}`);
    } catch (error) {
      lastError = error;
      if (attempt >= 2) break;
      await sleep(1500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SignalHire Search failed.");
}

function searchProfiles(payload: SignalHireSearchResponse) {
  return (payload.profiles || []).map((profile): CandidateProfile | null => {
    const current = currentSearchExperience(profile);
    const uid = clean(profile.uid, 160);
    const fullName = clean(profile.fullName, 300);
    if (!uid || !fullName) return null;
    return {
      uid,
      fullName,
      title: clean(current.title || current.position, 300),
      currentCompany: clean(current.company, 300),
      location: clean(profile.location, 300),
      linkedinUrl: profileLinkedIn(profile),
    };
  }).filter((profile): profile is CandidateProfile => Boolean(profile));
}

async function discoverPeople(account: AcquisitionAccount, apiKey: string) {
  const strongTitle = signalHirePersonaQuery(account.primaryPersona, account.secondaryPersona);
  const broadTitle = '("Talent Acquisition" OR Recruitment OR Recruiting OR "Human Resources" OR HR OR "People") AND (Head OR Director OR Manager OR Lead OR VP OR Chief)';
  const requests = [
    { currentTitle: strongTitle, currentCompany: `"${account.name.replace(/"/g, "")}"`, location: account.country || undefined, size: 10 },
    { currentTitle: broadTitle, currentCompany: account.name, size: 15 },
  ];

  const merged = new Map<string, CandidateProfile>();
  const errors: string[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    try {
      const payload = await searchSignalHire(apiKey, requests[index]);
      for (const profile of searchProfiles(payload)) merged.set(profile.uid, profile);
      if (merged.size >= 4) break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "SignalHire Search failed");
    }
  }

  const ranked = rankAcquisitionCandidates([...merged.values()], {
    accountName: account.name,
    country: account.country,
    primaryPersona: account.primaryPersona,
    secondaryPersona: account.secondaryPersona,
  }).filter((person) => person.score >= 30).slice(0, 8);

  const people: AcquisitionPerson[] = ranked.map((person, index) => ({
    uid: person.uid,
    accountDomain: account.domain,
    fullName: person.fullName,
    title: person.title,
    currentCompany: person.currentCompany,
    location: person.location,
    linkedinUrl: person.linkedinUrl || "",
    rankScore: person.score,
    fitReason: person.reason,
    emails: [],
    phones: [],
    enrichmentStatus: "search_only",
    selected: index === 0,
    meta: {
      provider: "SignalHire Search API · recovery-v2",
      searchPasses: requests.length,
      searchErrors: errors.slice(0, 2),
    },
  }));
  if (people.length) await upsertAcquisitionPeople(people);
  return people;
}

function uniqueContacts(candidate: SignalHireCandidate, type: "email" | "phone") {
  const preferred = type === "email" ? "work" : "mobile";
  const values = (candidate.contacts || [])
    .filter((item) => item.type === type && item.value)
    .sort((a, b) => (b.subType === preferred ? 1000 : 0) + Number(b.rating || 0) - (a.subType === preferred ? 1000 : 0) - Number(a.rating || 0))
    .map((item) => clean(item.value, type === "email" ? 320 : 120));
  return [...new Set(values.filter(Boolean))].slice(0, 20);
}

function candidateLinkedIn(candidate: SignalHireCandidate) {
  return clean((candidate.social || []).find((item) => /linkedin/i.test(clean(item.type)))?.link, 1200);
}

async function enrichOne(account: AcquisitionAccount, person: AcquisitionPerson, apiKey: string) {
  try {
    // One request only. A longer timeout avoids duplicate paid calls after an ambiguous timeout.
    const response = await fetch("https://www.signalhire.com/api/v1/candidate/search", {
      method: "POST",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ items: [person.uid], withoutWaterfall: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(90_000),
    });
    const payload = await response.json().catch(() => null) as SignalHirePersonResult[] | { error?: string } | null;
    if (!response.ok) {
      const message = payload && !Array.isArray(payload) ? clean(payload.error) : `HTTP ${response.status}`;
      throw new Error(`SignalHire Person enrichment failed: ${message || "Unknown error"}`);
    }
    const result = Array.isArray(payload) ? payload[0] : null;
    if (!result || result.status !== "success" || !result.candidate) throw new Error("SignalHire could not enrich the selected person.");

    const candidate = result.candidate;
    const current = candidate.experience?.find((item) => item.current) || candidate.experience?.[0];
    const verification = rankAcquisitionCandidates([{
      uid: person.uid,
      fullName: clean(candidate.fullName, 300) || person.fullName,
      title: clean(current?.position, 300) || person.title,
      currentCompany: clean(current?.company, 300) || person.currentCompany,
      location: clean(candidate.locations?.map((item) => item.name).filter(Boolean).join(" · ") || current?.location, 300),
      linkedinUrl: candidateLinkedIn(candidate) || person.linkedinUrl,
    }], {
      accountName: account.name,
      country: account.country,
      primaryPersona: account.primaryPersona,
      secondaryPersona: account.secondaryPersona,
    })[0];

    if (!verification || verification.score < 38 || !clean(current?.company)) {
      throw new Error("SignalHire current-company/persona verification was too weak to push safely.");
    }

    const enriched: AcquisitionPerson = {
      ...person,
      fullName: verification.fullName,
      title: verification.title,
      currentCompany: verification.currentCompany,
      location: verification.location,
      linkedinUrl: verification.linkedinUrl || person.linkedinUrl,
      rankScore: verification.score,
      fitReason: verification.reason,
      emails: uniqueContacts(candidate, "email"),
      phones: uniqueContacts(candidate, "phone"),
      enrichmentStatus: "enriched",
      selected: true,
      meta: { ...person.meta, provider: "SignalHire Person API · recovery-v2", verifiedCurrentCompany: true, attemptedAt: new Date().toISOString() },
    };
    await upsertAcquisitionPeople([enriched]);
    return enriched;
  } catch (error) {
    const failed: AcquisitionPerson = {
      ...person,
      enrichmentStatus: "failed",
      meta: { ...person.meta, recoveryV2FailedAt: new Date().toISOString(), recoveryV2Error: error instanceof Error ? error.message.slice(0, 300) : "Unknown enrichment error" },
    };
    await upsertAcquisitionPeople([failed]);
    throw error;
  }
}

function hasReachable(person: AcquisitionPerson) {
  return person.enrichmentStatus === "enriched" && Boolean(person.emails.length || person.phones.length);
}

function contactPriority(person: AcquisitionPerson) {
  return (person.phones.length ? 1000 : 0) + (person.emails.length ? 100 : 0) + person.rankScore;
}

async function stillNetNew(account: AcquisitionAccount) {
  const matches = await searchAll("companies", ["name", "domain", "hubspot_owner_id"], [
    { propertyName: "domain", operator: "EQ", value: account.domain },
  ]);
  if (!matches[0]) return true;
  await upsertAcquisitionAccounts([{
    ...account,
    exclusionStatus: "excluded",
    exclusionReason: "Already exists in HubSpot",
    hubspotCompanyId: String(matches[0].id),
    status: "excluded",
  }]);
  return false;
}

async function openTaskCounts() {
  const counts: Record<string, number> = {};
  await Promise.all(acquisitionOwners().map(async (owner) => {
    try {
      const tasks = await searchAll("tasks", ["hubspot_owner_id", "hs_task_status"], [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: owner.id },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
      ]);
      counts[owner.id] = tasks.length;
    } catch {
      counts[owner.id] = 9999;
    }
  }));
  return counts;
}

function accountPriority(account: AcquisitionAccount) {
  const recoveryIndex = RECOVERY_DOMAINS.indexOf(account.domain as typeof RECOVERY_DOMAINS[number]);
  const recoveryBoost = recoveryIndex >= 0 ? 2000 - recoveryIndex * 100 : 0;
  const phoneBoost = Number(account.phoneReadyCount || 0) > 0 ? 1200 : 0;
  const tier = account.gtmTier === "A" ? 400 : account.gtmTier === "B" ? 300 : account.gtmTier === "C" ? 200 : 100;
  return recoveryBoost + phoneBoost + tier + account.gtmScore * 2 + Math.max(-20, Math.min(40, account.headcountGrowth));
}

async function pushPerson(
  origin: string,
  ownerKey: string,
  account: AcquisitionAccount,
  person: AcquisitionPerson,
  taskCounts: Record<string, number>,
) {
  const owner = chooseAcquisitionOwner(account.domain, taskCounts, account.assignedOwnerId);
  await upsertAcquisitionAccounts([{ ...account, assignedOwnerId: owner.id, assignedOwnerName: owner.name }]);

  const request = new Request(`${origin}/api/prospecting/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-acquisition-owner-token": ownerKey },
    body: JSON.stringify({
      linkedinUrl: person.linkedinUrl,
      source: "Net-New Acquisition Recovery V2",
      signalHireUid: person.uid,
      assignmentMode: "acquisition",
      ownerId: owner.id,
      ownerName: owner.name,
      fullName: person.fullName,
      title: person.title,
      company: account.name,
      companyWebsite: `https://${account.domain}`,
      companyDomain: account.domain,
      careerPageUrl: account.careerPageUrl,
      detectedAts: account.detectedAts,
      atsConfidence: account.detectedAts ? "verified" : "",
      careerConfidence: 0,
      companyEvidenceUrl: account.careerPageUrl,
      companyVerificationReason: account.strongestSignal,
      hiring: {
        status: account.activeJobs > 0 ? "Hiring Now" : "Unknown",
        activeJobs: account.activeJobs,
        hiringScore: account.intentScore,
        hiringLabel: account.strongestSignal,
        hasHrJobs: false,
        source: account.source,
        sourceUrl: account.careerPageUrl,
        checkedAt: new Date().toISOString(),
        jobsSample: [],
      },
      location: person.location,
      email: person.emails[0] || "",
      emails: person.emails,
      phone: person.phones[0] || "",
      phones: person.phones,
      score: account.gtmScore,
      priority: person.phones.length ? "high" : account.gtmTier === "A" ? "high" : account.gtmTier === "B" ? "medium" : "normal",
      previousTitle: "",
      previousCompany: "",
      recentSignal: { type: "", label: account.strongestSignal },
      scoreReasons: [
        { label: `GTM Tier ${account.gtmTier}`, points: Math.min(100, account.gtmScore) },
        { label: "Intent score", points: Math.min(100, account.intentScore) },
        { label: "Persona match", points: Math.min(100, person.rankScore) },
      ],
    }),
  });
  const response = await prospectingPushPost(request);
  const result = await response.json() as Record<string, unknown> & { error?: string; duplicate?: boolean };
  if (!response.ok) throw new Error(result.error || `HubSpot push failed (${response.status}).`);
  taskCounts[owner.id] = Math.max(0, Number(taskCounts[owner.id] || 0)) + (result.duplicate ? 0 : 1);
  return { owner, result };
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return NextResponse.json({ error: "Internal recovery worker authorization failed." }, { status: 401 });
  const existingMarker = await completedMarker();
  if (existingMarker) return NextResponse.json({ status: "already_completed", marker: existingMarker }, { headers: { "Cache-Control": "no-store" } });

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid recovery request." }, { status: 400 });

  const workerKey = clean(request.headers.get("x-acquisition-worker-key"), 1000);
  const ownerKey = ownerBridge(workerKey);
  const apiKey = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  const startedAt = new Date().toISOString();
  const taskCounts = await openTaskCounts();

  try {
    const queue = await listAcquisitionAccounts({ limit: 1000, includeExcluded: false });
    const candidates = queue.accounts
      .filter((account) => account.exclusionStatus === "eligible" && account.status !== "pushed" && Number(account.pushCount || 0) === 0)
      .sort((a, b) => accountPriority(b) - accountPriority(a))
      .slice(0, parsed.data.limit);

    const outcomes: Array<Record<string, unknown>> = [];
    let paidPersonAttempts = 0;
    for (const account of candidates) {
      try {
        if (!(await stillNetNew(account))) {
          outcomes.push({ domain: account.domain, status: "existing_hubspot" });
          continue;
        }

        let people = (await listAcquisitionPeople(account.domain)).people;
        let reachable = people.filter(hasReachable).sort((a, b) => contactPriority(b) - contactPriority(a))[0];
        if (!reachable && people.filter((person) => person.enrichmentStatus === "search_only").length < 2) {
          await discoverPeople(account, apiKey);
          people = (await listAcquisitionPeople(account.domain)).people;
          reachable = people.filter(hasReachable).sort((a, b) => contactPriority(b) - contactPriority(a))[0];
        }

        if (!reachable) {
          const candidate = people
            .filter((person) => person.enrichmentStatus === "search_only" && person.rankScore >= 30)
            .sort((a, b) => b.rankScore - a.rankScore)[0];
          if (!candidate) {
            outcomes.push({ domain: account.domain, status: "no_person_found" });
            continue;
          }
          paidPersonAttempts += 1;
          reachable = await enrichOne(account, candidate, apiKey);
        }

        if (!hasReachable(reachable)) {
          outcomes.push({ domain: account.domain, status: "no_verified_contact" });
          continue;
        }

        const pushed = await pushPerson(request.nextUrl.origin, ownerKey, account, reachable, taskCounts);
        outcomes.push({
          domain: account.domain,
          account: account.name,
          channel: reachable.phones.length ? "phone" : "email",
          status: pushed.result.duplicate ? "duplicate_task" : "pushed",
          ownerId: pushed.owner.id,
          ownerName: pushed.owner.name,
          companyId: pushed.result.companyId,
          contactId: pushed.result.contactId,
          taskId: pushed.result.taskId,
        });
      } catch (error) {
        outcomes.push({
          domain: account.domain,
          account: account.name,
          status: "failed",
          error: error instanceof Error ? error.message.slice(0, 400) : "Unknown recovery error",
        });
      }
    }

    const result = {
      status: "completed",
      version: "signalhire-recovery-v2-2026-08-22",
      startedAt,
      completedAt: new Date().toISOString(),
      selected: candidates.length,
      paidPersonAttempts,
      pushed: outcomes.filter((item) => item.status === "pushed").length,
      duplicates: outcomes.filter((item) => item.status === "duplicate_task").length,
      existingHubSpot: outcomes.filter((item) => item.status === "existing_hubspot").length,
      unresolved: outcomes.filter((item) => item.status === "no_person_found" || item.status === "no_verified_contact").length,
      failed: outcomes.filter((item) => item.status === "failed").length,
      outcomes,
    };

    await mkdir(/* turbopackIgnore: true */ dirname(MARKER_PATH), { recursive: true });
    await writeFile(/* turbopackIgnore: true */ MARKER_PATH, JSON.stringify(result, null, 2), "utf8");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Acquisition recovery failed.", startedAt }, { status: 500 });
  }
}
