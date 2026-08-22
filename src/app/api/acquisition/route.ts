import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listAcquisitionAccounts,
  listAcquisitionPeople,
  upsertAcquisitionAccounts,
  upsertAcquisitionPeople,
  type AcquisitionAccount,
  type AcquisitionPerson,
} from "@/lib/acquisition-data-api";
import {
  chooseAcquisitionOwner,
  rankAcquisitionCandidates,
  signalHirePersonaQuery,
  type CandidateProfile,
} from "@/lib/acquisition-routing";
import { searchAll } from "@/lib/hubspot";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("discover"), pages: z.number().int().min(1).max(6).default(1), confirmCredits: z.boolean() }),
  z.object({ action: z.literal("find_people"), domain: z.string().trim().min(3).max(255) }),
  z.object({ action: z.literal("enrich_person"), domain: z.string().trim().min(3).max(255), uid: z.string().trim().min(1).max(160) }),
  z.object({ action: z.literal("assign"), domain: z.string().trim().min(3).max(255) }),
]);

type ApolloOrganization = Record<string, unknown> & {
  id?: string;
  organization_id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  domain?: string;
  industry?: string;
  estimated_num_employees?: number;
  num_current_jobs?: number;
  organization_num_jobs?: number;
  keywords?: string[];
  short_description?: string;
  seo_description?: string;
};

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
    started?: string | null;
    companyUrl?: string | null;
  }>;
};

type SignalHirePersonResult = { status?: string; candidate?: SignalHireCandidate };

const GOVERNMENT_PATTERN = /\b(ministry|minister|government|govt|authority|municipality|municipal|public authority|federal authority|royal commission|council of ministers|ديوان|وزارة|هيئة حكومية|بلدية|أمانة)\b/i;
const SEMI_GOV_PATTERN = /\b(public investment fund|\bpif\b|sovereign wealth|state[- ]owned|government owned|government-backed|government backed)\b/i;
const COMPETITOR_PATTERN = /\b(applicant tracking system|\bats\b software|recruitment software|recruiting software|talent acquisition platform|recruitment platform|recruiting platform|candidate tracking|job board|jobs marketplace|hiring software)\b/i;
const RECRUITMENT_SERVICE_PATTERN = /\b(recruitment agency|staffing agency|staffing services|executive search|manpower|recruitment services|talent consultancy)\b/i;
const KNOWN_COMPETITOR_PATTERN = /\b(elevatus|manatal|workable|greenhouse|lever|recruitee|teamtailor|smartrecruiters|icims|jobvite|sniperhire|cazar|akhtaboot|bayt|naukrigulf)\b/i;

function clean(value: unknown, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function numberValue(...values: unknown[]) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function sameOrigin(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  if (site && !["same-origin", "same-site", "none"].includes(site)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function ownerAuthorized(request: NextRequest) {
  const configured = clean(process.env.ACQUISITION_OWNER_TOKEN, 500);
  if (!configured) return { ok: false as const, status: 503, error: "Owner actions are locked until ACQUISITION_OWNER_TOKEN is configured." };
  const supplied = clean(request.headers.get("x-acquisition-owner-token"), 500);
  if (!supplied || !safeEqual(supplied, configured)) return { ok: false as const, status: 401, error: "Owner authorization is required for this action." };
  return { ok: true as const };
}

function configuration() {
  return {
    apolloConfigured: Boolean(clean(process.env.APOLLO_API_KEY, 1000)),
    signalHireConfigured: Boolean(clean(process.env.SIGNALHIRE_API_KEY, 1000)),
    ownerActionsConfigured: Boolean(clean(process.env.ACQUISITION_OWNER_TOKEN, 500)),
    apolloCost: "1 credit per results page; up to 100 companies per page",
    signalHirePolicy: "Search first; spend Person API credits only on the selected persona",
  };
}

function accountText(org: ApolloOrganization) {
  const location = org.location && typeof org.location === "object" ? JSON.stringify(org.location) : "";
  const keywords = Array.isArray(org.keywords) ? org.keywords.join(" ") : "";
  const parent = [org.owned_by_organization, org.ultimate_parent_organization]
    .map((item) => typeof item === "object" ? JSON.stringify(item) : clean(item))
    .join(" ");
  return [org.name, org.industry, org.short_description, org.seo_description, keywords, location, parent].map((item) => clean(item, 2500)).join(" ");
}

function classifyExclusion(org: ApolloOrganization) {
  const text = accountText(org);
  if (GOVERNMENT_PATTERN.test(text) || SEMI_GOV_PATTERN.test(text)) {
    return { status: "excluded" as const, reason: "Government / semi-government signal detected" };
  }
  if (COMPETITOR_PATTERN.test(text) || KNOWN_COMPETITOR_PATTERN.test(text)) {
    return { status: "excluded" as const, reason: "ATS / recruitment-tech / job-board competitor signal detected" };
  }
  if (RECRUITMENT_SERVICE_PATTERN.test(text)) {
    return { status: "review" as const, reason: "Recruitment/staffing service: manual review before prospecting" };
  }
  return { status: "eligible" as const, reason: "" };
}

function organizationCountry(org: ApolloOrganization) {
  const location = org.location as Record<string, unknown> | undefined;
  return clean(location?.country || org.country || org.organization_location || "", 160);
}

function organizationDomain(org: ApolloOrganization) {
  return normalizeCompanyDomain(clean(org.primary_domain || org.domain || org.website_url, 1000));
}

function activeJobs(org: ApolloOrganization) {
  return Math.max(5, Math.round(numberValue(
    org.num_current_jobs,
    org.organization_num_jobs,
    org.current_jobs,
    org.job_postings_count,
    org.num_jobs,
  )));
}

async function existingHubSpotDomains(domains: string[]) {
  const result = new Map<string, string>();
  const unique = [...new Set(domains.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    try {
      const matches = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "IN", values: chunk }]);
      for (const match of matches) {
        const domain = normalizeCompanyDomain(clean(match.properties.domain));
        if (domain) result.set(domain, String(match.id));
      }
    } catch {
      for (const domain of chunk) {
        const matches = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "EQ", value: domain }]);
        if (matches[0]) result.set(domain, String(matches[0].id));
      }
    }
  }
  return result;
}

function apolloUrl(page: number) {
  const query = new URLSearchParams();
  for (const location of ["Saudi Arabia", "United Arab Emirates"]) query.append("organization_locations[]", location);
  for (const range of ["201,500", "501,1000", "1001,2000"]) query.append("organization_num_employees_ranges[]", range);
  query.set("organization_num_jobs_range[min]", "5");
  query.set("page", String(page));
  query.set("per_page", "100");
  return `https://api.apollo.io/api/v1/mixed_companies/search?${query.toString()}`;
}

async function apolloPage(page: number) {
  const apiKey = clean(process.env.APOLLO_API_KEY, 1000);
  if (!apiKey) throw new Error("APOLLO_API_KEY is not configured on the production server.");
  const response = await fetch(apolloUrl(page), {
    method: "POST",
    headers: { "x-api-key": apiKey, Accept: "application/json", "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = clean((payload.error as Record<string, unknown> | undefined)?.message || payload.message || `HTTP ${response.status}`);
    throw new Error(`Apollo organization search failed: ${message}`);
  }
  const organizations = Array.isArray(payload.organizations)
    ? payload.organizations as ApolloOrganization[]
    : Array.isArray(payload.accounts)
      ? payload.accounts as ApolloOrganization[]
      : [];
  const pagination = (payload.pagination || {}) as Record<string, unknown>;
  return {
    organizations,
    total: numberValue(pagination.total_entries, pagination.total, payload.total_entries, organizations.length),
  };
}

async function discoverAccounts(pages: number) {
  const organizations: ApolloOrganization[] = [];
  let rawTotal = 0;
  for (let page = 1; page <= pages; page += 1) {
    const result = await apolloPage(page);
    rawTotal = Math.max(rawTotal, result.total);
    organizations.push(...result.organizations);
    if (!result.organizations.length) break;
  }

  const normalized = organizations
    .map((org) => ({ org, domain: organizationDomain(org) }))
    .filter((item): item is { org: ApolloOrganization; domain: string } => Boolean(item.domain));
  const hubspot = await existingHubSpotDomains(normalized.map((item) => item.domain));

  const accounts: AcquisitionAccount[] = normalized.map(({ org, domain }) => {
    const name = clean(org.name, 300) || domain;
    const employeeCount = Math.max(0, Math.round(numberValue(org.estimated_num_employees, org.employee_count, org.num_employees)));
    const jobs = activeJobs(org);
    const exclusion = classifyExclusion(org);
    const hubspotCompanyId = hubspot.get(domain) || "";
    const finalExclusion = hubspotCompanyId
      ? { status: "excluded" as const, reason: "Already exists in HubSpot" }
      : exclusion;
    const scored = scoreTalenteraAccount({
      companyId: clean(org.id || org.organization_id, 160) || domain,
      name,
      domain,
      country: organizationCountry(org),
      employeeCount,
      industry: clean(org.industry, 300),
      activeJobs: jobs,
      newJobs30d: 0,
      ats: "",
    });
    return {
      domain,
      name,
      source: "Apollo",
      sourceId: clean(org.id || org.organization_id, 160),
      country: scored.country,
      employeeCount,
      industry: clean(org.industry, 300),
      activeJobs: jobs,
      headcountGrowth: numberValue(org.organization_headcount_growth, org.headcount_growth),
      hrHeadcount: Math.max(0, Math.round(numberValue(org.hr_headcount, org.human_resources_headcount))),
      careerPageUrl: "",
      detectedAts: "",
      gtmScore: scored.score,
      gtmTier: scored.tier,
      fitScore: scored.fitScore,
      intentScore: scored.intentScore,
      atsOpportunityScore: scored.atsOpportunityScore,
      exclusionStatus: finalExclusion.status,
      exclusionReason: finalExclusion.reason,
      hubspotCompanyId,
      status: finalExclusion.status === "excluded" ? "excluded" : "candidate",
      primaryPersona: scored.personas.primary,
      secondaryPersona: scored.personas.secondary,
      economicBuyer: scored.personas.economicBuyer,
      technicalInfluencer: scored.personas.technicalInfluencer,
      strongestSignal: scored.signals[0]?.evidence || `${jobs}+ active jobs matched the Apollo discovery filter`,
      recommendedAngle: scored.recommendedAngle,
      assignedOwnerId: "",
      assignedOwnerName: "",
      evidence: {
        apolloMinimumActiveJobs: 5,
        rawIndustry: org.industry || "",
        rawKeywords: org.keywords || [],
        exclusionSourceText: accountText(org).slice(0, 3000),
      },
    };
  });

  await upsertAcquisitionAccounts(accounts);
  return {
    rawTotal,
    fetched: organizations.length,
    stored: accounts.length,
    eligible: accounts.filter((account) => account.exclusionStatus === "eligible").length,
    review: accounts.filter((account) => account.exclusionStatus === "review").length,
    excluded: accounts.filter((account) => account.exclusionStatus === "excluded").length,
    existingHubSpot: accounts.filter((account) => account.exclusionReason === "Already exists in HubSpot").length,
  };
}

async function getAccount(domain: string) {
  const normalized = normalizeCompanyDomain(domain);
  const data = await listAcquisitionAccounts({ limit: 1000, includeExcluded: true });
  const account = data.accounts.find((item) => item.domain === normalized);
  if (!account) throw new Error(`Account ${normalized || domain} is not in the acquisition queue.`);
  return account;
}

function profileLinkedIn(profile: SignalHireSearchProfile) {
  return clean((profile.social || []).find((item) => /linkedin/i.test(clean(item.type)))?.link, 1200);
}

function currentSearchExperience(profile: SignalHireSearchProfile) {
  const experiences = profile.experience || [];
  return experiences.find((item) => item.current) || experiences[0] || {};
}

async function findPeople(account: AcquisitionAccount) {
  const apiKey = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  if (!apiKey) throw new Error("SIGNALHIRE_API_KEY is not configured on the server.");
  const query = signalHirePersonaQuery(account.primaryPersona, account.secondaryPersona);
  const response = await fetch("https://www.signalhire.com/api/v1/candidate/searchByQuery", {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      currentTitle: query,
      currentCompany: `\"${account.name.replace(/\"/g, "")}\"`,
      location: account.country || undefined,
      size: 10,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const creditsLeft = response.headers.get("x-credits-left");
  const payload = await response.json().catch(() => ({})) as SignalHireSearchResponse & { message?: string; error?: string };
  if (!response.ok) throw new Error(`SignalHire Search failed (${response.status}): ${clean(payload.error || payload.message || "Unknown error")}`);

  const candidates: CandidateProfile[] = (payload.profiles || []).map((profile) => {
    const current = currentSearchExperience(profile);
    return {
      uid: clean(profile.uid, 160),
      fullName: clean(profile.fullName, 300),
      title: clean(current.title || current.position, 300),
      currentCompany: clean(current.company, 300),
      location: clean(profile.location, 300),
      linkedinUrl: profileLinkedIn(profile),
    };
  }).filter((profile) => profile.uid && profile.fullName);

  const ranked = rankAcquisitionCandidates(candidates, {
    accountName: account.name,
    country: account.country,
    primaryPersona: account.primaryPersona,
    secondaryPersona: account.secondaryPersona,
  }).slice(0, 8);

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
    meta: { provider: "SignalHire Search API", searchTotal: Number(payload.total || 0), personaQuery: query },
  }));
  if (people.length) await upsertAcquisitionPeople(people);
  return { total: Number(payload.total || 0), returned: people.length, people, creditsLeft: creditsLeft ? Number(creditsLeft) : null };
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

async function enrichPerson(account: AcquisitionAccount, person: AcquisitionPerson) {
  const apiKey = clean(process.env.SIGNALHIRE_API_KEY, 1000);
  if (!apiKey) throw new Error("SIGNALHIRE_API_KEY is not configured on the server.");
  const response = await fetch("https://www.signalhire.com/api/v1/candidate/search", {
    method: "POST",
    headers: { apikey: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ items: [person.uid], withoutWaterfall: true }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const creditsLeft = response.headers.get("x-credits-left");
  const payload = await response.json().catch(() => null) as SignalHirePersonResult[] | { error?: string } | null;
  if (!response.ok) {
    const message = payload && !Array.isArray(payload) ? payload.error : `HTTP ${response.status}`;
    throw new Error(`SignalHire Person enrichment failed: ${clean(message || "Unknown error")}`);
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
    throw new Error("SignalHire enriched the person, but current-company/persona verification was too weak to push safely.");
  }
  const enriched: AcquisitionPerson = {
    uid: person.uid,
    accountDomain: account.domain,
    fullName: verification.fullName,
    title: verification.title,
    currentCompany: verification.currentCompany,
    location: verification.location,
    linkedinUrl: verification.linkedinUrl || "",
    rankScore: verification.score,
    fitReason: verification.reason,
    emails: uniqueContacts(candidate, "email"),
    phones: uniqueContacts(candidate, "phone"),
    enrichmentStatus: "enriched",
    selected: true,
    meta: { ...person.meta, provider: "SignalHire Person API", verifiedCurrentCompany: true },
  };
  await upsertAcquisitionPeople([enriched]);
  return { person: enriched, creditsLeft: creditsLeft ? Number(creditsLeft) : null };
}

let workloadCache: { at: number; counts: Record<string, number> } | null = null;

async function openTaskCounts() {
  if (workloadCache && Date.now() - workloadCache.at < 5 * 60 * 1000) return workloadCache.counts;
  const ownerIds = ["31644369", "76369997", "31558980", "76370000", "76369995", "76369998"];
  const counts: Record<string, number> = {};
  await Promise.all(ownerIds.map(async (ownerId) => {
    try {
      const tasks = await searchAll("tasks", ["hubspot_owner_id", "hs_task_status"], [
        { propertyName: "hubspot_owner_id", operator: "EQ", value: ownerId },
        { propertyName: "hs_task_status", operator: "NEQ", value: "COMPLETED" },
      ]);
      counts[ownerId] = tasks.length;
    } catch {
      counts[ownerId] = 9999;
    }
  }));
  workloadCache = { at: Date.now(), counts };
  return counts;
}

async function assignAccount(account: AcquisitionAccount) {
  if (account.assignedOwnerId) return { ownerId: account.assignedOwnerId, ownerName: account.assignedOwnerName, reason: "Existing acquisition assignment preserved" };
  const counts = await openTaskCounts();
  const owner = chooseAcquisitionOwner(account.domain, counts);
  await upsertAcquisitionAccounts([{ ...account, assignedOwnerId: owner.id, assignedOwnerName: owner.name }]);
  const refreshed = await getAccount(account.domain);
  return {
    ownerId: refreshed.assignedOwnerId || owner.id,
    ownerName: refreshed.assignedOwnerName || owner.name,
    reason: refreshed.assignedOwnerId === owner.id ? owner.reason : "Another concurrent assignment was preserved",
    openTaskCounts: counts,
  };
}

export async function GET(request: NextRequest) {
  try {
    const domain = normalizeCompanyDomain(request.nextUrl.searchParams.get("domain") || "");
    if (domain) {
      const people = await listAcquisitionPeople(domain);
      return NextResponse.json({ ...people, configuration: configuration() }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const data = await listAcquisitionAccounts({
      limit: Number(request.nextUrl.searchParams.get("limit") || 300),
      country: clean(request.nextUrl.searchParams.get("country"), 160),
      tier: clean(request.nextUrl.searchParams.get("tier"), 20),
      status: clean(request.nextUrl.searchParams.get("status"), 40),
      includeExcluded: request.nextUrl.searchParams.get("includeExcluded") === "1",
    });
    return NextResponse.json({ ...data, configuration: configuration() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load acquisition data." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site acquisition actions are not allowed." }, { status: 403 });
    const auth = ownerAuthorized(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error, ownerSetupRequired: auth.status === 503 }, { status: auth.status });
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid acquisition action", details: parsed.error.flatten() }, { status: 400 });

    if (parsed.data.action === "discover") {
      if (!parsed.data.confirmCredits) return NextResponse.json({ error: `Apollo discovery requires explicit confirmation for up to ${parsed.data.pages} credit(s).` }, { status: 400 });
      const result = await discoverAccounts(parsed.data.pages);
      return NextResponse.json({ action: "discover", creditsAuthorized: parsed.data.pages, ...result, configuration: configuration() });
    }

    const account = await getAccount(parsed.data.domain);
    if (account.exclusionStatus === "excluded") return NextResponse.json({ error: `This account is excluded: ${account.exclusionReason}` }, { status: 409 });

    if (parsed.data.action === "find_people") {
      const result = await findPeople(account);
      return NextResponse.json({ action: "find_people", account: { domain: account.domain, name: account.name }, ...result });
    }

    if (parsed.data.action === "enrich_person") {
      const stored = await listAcquisitionPeople(account.domain);
      const person = stored.people.find((item) => item.uid === parsed.data.uid);
      if (!person) return NextResponse.json({ error: "Select a person from the account search results first." }, { status: 404 });
      const result = await enrichPerson(account, person);
      return NextResponse.json({ action: "enrich_person", account: { domain: account.domain, name: account.name }, ...result });
    }

    const assignment = await assignAccount(account);
    return NextResponse.json({ action: "assign", account: { domain: account.domain, name: account.name }, assignment });
  } catch (error) {
    console.error("Acquisition action failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Acquisition action failed." }, { status: 500 });
  }
}
