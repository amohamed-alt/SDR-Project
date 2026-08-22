import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listAcquisitionAccounts,
  upsertAcquisitionAccounts,
  upsertAcquisitionPeople,
  type AcquisitionAccount,
  type AcquisitionPerson,
} from "@/lib/acquisition-data-api";
import {
  rankAcquisitionCandidates,
  signalHirePersonaQuery,
  type CandidateProfile,
} from "@/lib/acquisition-routing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  limit: z.number().int().min(1).max(20).default(12),
  retryEmpty: z.boolean().default(false),
});

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentExperience(profile: SignalHireSearchProfile) {
  const experiences = profile.experience || [];
  return experiences.find((item) => item.current) || experiences[0] || {};
}

function linkedin(profile: SignalHireSearchProfile) {
  return clean((profile.social || []).find((item) => /linkedin/i.test(clean(item.type)))?.link, 1200);
}

function profiles(payload: SignalHireSearchResponse) {
  return (payload.profiles || []).map((profile): CandidateProfile | null => {
    const current = currentExperience(profile);
    const uid = clean(profile.uid, 160);
    const fullName = clean(profile.fullName, 300);
    if (!uid || !fullName) return null;
    return {
      uid,
      fullName,
      title: clean(current.title || current.position, 300),
      currentCompany: clean(current.company, 300),
      location: clean(profile.location, 300),
      linkedinUrl: linkedin(profile),
    };
  }).filter((profile): profile is CandidateProfile => Boolean(profile));
}

async function signalHireSearch(apiKey: string, body: Record<string, unknown>) {
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
        await sleep(1200 * attempt);
        continue;
      }
      throw new Error(`SignalHire Search failed (${response.status}): ${message}`);
    } catch (error) {
      lastError = error;
      if (attempt >= 2) break;
      await sleep(1200 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("SignalHire Search failed.");
}

async function discoverPeople(account: AcquisitionAccount, apiKey: string) {
  const focusedTitle = signalHirePersonaQuery(account.primaryPersona, account.secondaryPersona);
  const broadTitle = '("Talent Acquisition" OR Recruitment OR Recruiting OR "Human Resources" OR HR OR People) AND (Head OR Director OR Manager OR Lead OR VP OR Chief)';
  const searches = [
    { currentTitle: focusedTitle, currentCompany: `"${account.name.replace(/"/g, "")}"`, location: account.country || undefined, size: 10 },
    { currentTitle: broadTitle, currentCompany: account.name, size: 15 },
  ];

  const merged = new Map<string, CandidateProfile>();
  const errors: string[] = [];
  let reportedTotal = 0;

  for (const search of searches) {
    try {
      const payload = await signalHireSearch(apiKey, search);
      reportedTotal = Math.max(reportedTotal, Number(payload.total || 0));
      for (const profile of profiles(payload)) merged.set(profile.uid, profile);
      if (merged.size >= 4) break;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "SignalHire Search failed");
    }
  }

  if (!merged.size && errors.length === searches.length) {
    throw new Error(errors[0] || "SignalHire Search failed.");
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
      provider: "SignalHire Search API · people-scan-v1",
      searchPasses: searches.length,
      reportedTotal,
      searchedAt: new Date().toISOString(),
      searchErrors: errors.slice(0, 2),
    },
  }));

  if (people.length) await upsertAcquisitionPeople(people);
  return { people, reportedTotal };
}

function priority(account: AcquisitionAccount) {
  const tier = account.gtmTier === "A" ? 400 : account.gtmTier === "B" ? 300 : account.gtmTier === "C" ? 200 : 100;
  return tier + account.gtmScore * 2 + account.intentScore + Math.min(50, account.activeJobs * 2);
}

async function markScan(account: AcquisitionAccount, status: "empty" | "error", detail = "") {
  await upsertAcquisitionAccounts([{
    ...account,
    evidence: {
      ...account.evidence,
      peopleScanStatus: status,
      peopleScanAt: new Date().toISOString(),
      peopleScanDetail: clean(detail, 400),
    },
  }]);
}

async function processAccount(account: AcquisitionAccount, apiKey: string) {
  try {
    const result = await discoverPeople(account, apiKey);
    if (!result.people.length) {
      await markScan(account, "empty", `SignalHire returned ${result.reportedTotal} raw matches but no candidate passed company/persona verification.`);
      return { domain: account.domain, account: account.name, status: "empty", people: 0, reportedTotal: result.reportedTotal };
    }
    return {
      domain: account.domain,
      account: account.name,
      status: "people_ready",
      people: result.people.length,
      bestPerson: result.people[0]?.fullName || "",
      bestTitle: result.people[0]?.title || "",
      reportedTotal: result.reportedTotal,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "SignalHire people scan failed";
    await markScan(account, "error", message);
    return { domain: account.domain, account: account.name, status: "failed", error: message };
  }
}

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) {
    return NextResponse.json({ error: "Internal people-scan authorization failed." }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid people-scan request." }, { status: 400 });

  const apiKey = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  const startedAt = new Date().toISOString();

  try {
    const queue = await listAcquisitionAccounts({ limit: 1000, includeExcluded: false });
    const candidates = queue.accounts
      .filter((account) => {
        if (account.exclusionStatus !== "eligible" || account.status === "pushed") return false;
        if (Number(account.peopleCount || 0) > 0) return false;
        const scanStatus = clean(account.evidence?.peopleScanStatus, 20);
        if (!parsed.data.retryEmpty && (scanStatus === "empty" || scanStatus === "error")) return false;
        return true;
      })
      .sort((a, b) => priority(b) - priority(a))
      .slice(0, parsed.data.limit);

    const outcomes: Array<Record<string, unknown>> = [];
    const concurrency = 3;
    for (let index = 0; index < candidates.length; index += concurrency) {
      const batch = candidates.slice(index, index + concurrency);
      outcomes.push(...await Promise.all(batch.map((account) => processAccount(account, apiKey))));
      if (index + concurrency < candidates.length) await sleep(400);
    }

    return NextResponse.json({
      status: "completed",
      version: "people-scan-v1",
      startedAt,
      completedAt: new Date().toISOString(),
      selected: candidates.length,
      accountsWithPeople: outcomes.filter((item) => item.status === "people_ready").length,
      peopleStored: outcomes.reduce((sum, item) => sum + Number(item.people || 0), 0),
      empty: outcomes.filter((item) => item.status === "empty").length,
      failed: outcomes.filter((item) => item.status === "failed").length,
      remainingBeforeNextPass: Math.max(0, Number(queue.summary?.eligible || 0) - Number(queue.summary?.people_ready || 0) - candidates.length),
      outcomes,
      costGuard: {
        apolloCalls: 0,
        personEnrichmentCalls: 0,
        mode: "SignalHire Search API only",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "People scan failed.",
      startedAt,
    }, { status: 500 });
  }
}
