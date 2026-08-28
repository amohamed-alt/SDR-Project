import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listAcquisitionAccounts,
  upsertAcquisitionAccounts,
  type AcquisitionAccount,
} from "@/lib/acquisition-data-api";
import { searchAll } from "@/lib/hubspot";
import { inspectProspectCompany } from "@/lib/prospecting-company-intelligence-gemini";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";
import { sdrAdminAuthorized, sdrAdminConfigured } from "@/lib/sdr-admin-auth";
import {
  TARGET_ACCOUNT_MARKETS,
  TARGET_ACCOUNT_TOTAL,
  TARGET_EMPLOYEE_RANGES,
  targetMarket,
  targetMarketNames,
  type TargetAccountCountry,
} from "@/lib/target-account-markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const marketEnum = z.enum(targetMarketNames() as [TargetAccountCountry, ...TargetAccountCountry[]]);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("discover_market"), country: marketEnum, pages: z.number().int().min(1).max(6).default(1), confirmCredits: z.literal(true) }),
  z.object({ action: z.literal("verify_account"), domain: z.string().trim().min(3).max(255) }),
  z.object({ action: z.literal("request_feed"), domain: z.string().trim().min(3).max(255) }),
  z.object({ action: z.literal("cancel_feed"), domain: z.string().trim().min(3).max(255) }),
  z.object({ action: z.literal("complete_feed"), domain: z.string().trim().min(3).max(255), taskId: z.string().trim().max(100).default("") }),
]);

type ApolloPeopleOrganization = {
  name?: string;
  has_industry?: boolean;
  has_employee_count?: boolean;
};

type ApolloPersonSearchRow = {
  id?: string;
  first_name?: string;
  last_name_obfuscated?: string;
  title?: string;
  organization?: ApolloPeopleOrganization;
};

type ApolloOrganization = Record<string, unknown> & {
  id?: string;
  organization_id?: string;
  name?: string;
  website_url?: string;
  primary_domain?: string;
  domain?: string;
  industry?: string;
  naics_codes?: string[];
  estimated_num_employees?: number;
  keywords?: string[];
  short_description?: string;
  seo_description?: string;
};

const GOVERNMENT_PATTERN = /\b(ministry|minister|government|govt|authority|municipality|municipal|public authority|federal authority|royal commission|central bank|ديوان|وزارة|هيئة حكومية|بلدية|أمانة)\b/i;
const SEMI_GOV_PATTERN = /\b(public investment fund|\bpif\b|sovereign wealth|state[- ]owned|government owned|government-backed|government backed)\b/i;
const COMPETITOR_PATTERN = /\b(applicant tracking system|\bats\b software|recruitment software|recruiting software|talent acquisition platform|recruitment platform|recruiting platform|candidate tracking|job board|jobs marketplace|hiring software|elevatus|manatal|workable|greenhouse|lever|recruitee|teamtailor|smartrecruiters|icims|jobvite|sniperhire|cazar|akhtaboot|bayt|naukrigulf)\b/i;
const RECRUITMENT_SERVICE_PATTERN = /\b(recruitment agency|staffing agency|staffing services|executive search|manpower|recruitment services|talent consultancy)\b/i;

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

function ownerAuthorized(request: NextRequest) {
  return sdrAdminAuthorized(request);
}

function configuration() {
  return {
    apolloConfigured: Boolean(clean(process.env.APOLLO_API_KEY, 1000)),
    signalHireConfigured: Boolean(clean(process.env.SIGNALHIRE_API_KEY, 1000)),
    ownerActionsConfigured: sdrAdminConfigured(),
    hubspotWritePolicy: "No HubSpot write from the pool. HubSpot write happens only after an explicit Marita feed request.",
    signalHirePolicy: "No SignalHire search/reveal for dormant pool accounts. Search and one-person reveal start only after explicit Marita feed selection.",
  };
}

function organizationDomain(org: ApolloOrganization) {
  return normalizeCompanyDomain(clean(org.primary_domain || org.domain || org.website_url, 1000));
}

function organizationCountry(org: ApolloOrganization) {
  const location = org.location && typeof org.location === "object" ? org.location as Record<string, unknown> : {};
  return clean(org.organization_country || org.country || location.country || org.organization_location, 160);
}

function accountText(org: ApolloOrganization) {
  const location = org.location && typeof org.location === "object" ? JSON.stringify(org.location) : "";
  const parent = [org.owned_by_organization, org.ultimate_parent_organization]
    .map((item) => typeof item === "object" ? JSON.stringify(item) : clean(item))
    .join(" ");
  return [org.name, org.domain, org.primary_domain, org.website_url, org.industry, org.short_description, org.seo_description, ...(org.keywords || []), location, parent]
    .map((item) => clean(item, 3000)).join(" ");
}

function classifyExclusion(org: ApolloOrganization, domain: string) {
  const text = accountText(org);
  if (/\.gov\.[a-z]{2}$|\.gov$/i.test(domain) || GOVERNMENT_PATTERN.test(text) || SEMI_GOV_PATTERN.test(text)) {
    return { status: "excluded" as const, reason: "Government / semi-government signal detected" };
  }
  if (COMPETITOR_PATTERN.test(text)) {
    return { status: "excluded" as const, reason: "ATS / recruitment-tech / job-board competitor signal detected" };
  }
  if (RECRUITMENT_SERVICE_PATTERN.test(text)) {
    return { status: "review" as const, reason: "Recruitment/staffing service: manual review required" };
  }
  return { status: "eligible" as const, reason: "" };
}

function inferredIndustry(org: ApolloOrganization) {
  const codes = (org.naics_codes || []).map(String);
  const code = codes[0] || "";
  if (/^(31|32|33)/.test(code)) return "Manufacturing";
  if (/^(44|45)/.test(code)) return "Retail";
  if (/^(48|49)/.test(code)) return /^481/.test(code) ? "Aviation" : "Logistics & Transportation";
  if (/^62/.test(code)) return "Healthcare";
  if (/^72/.test(code)) return "Hospitality";
  if (/^23/.test(code)) return "Construction";
  if (/^531/.test(code)) return "Real Estate";
  if (/^52/.test(code)) return "Financial Services";
  if (/^61/.test(code)) return "Education";
  if (/^517/.test(code)) return "Telecommunications";
  if (/^5415/.test(code)) return "Technology";
  if (/^5614/.test(code)) return "BPO / Contact Center";
  return clean(org.industry, 300) || "Target industry";
}

function industryBucket(value: string) {
  const text = value.toLowerCase();
  if (/manufactur|industrial|fmcg|consumer goods|food production/.test(text)) return "manufacturing";
  if (/retail|supermarket|consumer retail|e-?commerce/.test(text)) return "retail";
  if (/logistic|transport|supply chain|freight|shipping/.test(text)) return "logistics";
  if (/aviation|airline|airport|air transport/.test(text)) return "aviation";
  if (/health|hospital|medical|pharma|clinic/.test(text)) return "healthcare";
  if (/hotel|hospitality|restaurant|food & beverages|leisure|travel/.test(text)) return "hospitality";
  if (/construction|civil engineering|building materials|engineering & construction/.test(text)) return "construction";
  if (/real estate|property|facilities services/.test(text)) return "real estate";
  if (/bank|financial|fintech|insurance|investment|capital markets/.test(text)) return "financial services";
  if (/education|university|college|school|higher education/.test(text)) return "education";
  if (/telecom|wireless|communications/.test(text)) return "telecommunications";
  if (/software|information technology|internet|technology|computer/.test(text)) return "technology";
  if (/bpo|outsourcing|contact center|call center/.test(text)) return "bpo";
  return text.replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesTargetIndustry(org: ApolloOrganization, country: TargetAccountCountry) {
  const market = targetMarket(country);
  if (!market) return false;
  const targetCodes = market.naics.map(String);
  const codes = (org.naics_codes || []).map(String);
  if (codes.some((code) => targetCodes.some((target) => code.startsWith(target) || target.startsWith(code)))) return true;

  const observed = industryBucket([
    inferredIndustry(org),
    clean(org.industry, 300),
    ...(org.keywords || []).map((value) => clean(value, 160)),
    clean(org.short_description, 700),
    clean(org.seo_description, 700),
  ].join(" "));
  const targets = new Set(market.industries.map((value) => industryBucket(value)));
  if (targets.has(observed)) return true;

  const text = accountText(org).toLowerCase();
  return [...targets].some((target) => target.length >= 4 && text.includes(target));
}

async function existingHubSpotDomains(domains: string[]) {
  const result = new Map<string, string>();
  const unique = [...new Set(domains.map(normalizeCompanyDomain).filter(Boolean))];
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    try {
      const matches = await searchAll("companies", ["name", "domain", "account_type", "account_status", "hs_num_open_deals"], [
        { propertyName: "domain", operator: "IN", values: chunk },
      ]);
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

async function getAccount(domain: string) {
  const normalized = normalizeCompanyDomain(domain);
  const data = await listAcquisitionAccounts({ limit: 1000, includeExcluded: true });
  const account = data.accounts.find((item) => item.domain === normalized);
  if (!account) throw new Error(`Account ${normalized || domain} is not stored in Target Account Pool.`);
  return account;
}

const TARGET_PERSON_TITLES = [
  "talent acquisition",
  "human resources",
  "hr director",
  "head of hr",
  "recruitment",
  "chief human resources officer",
  "chief people officer",
] as const;

const TARGET_PERSON_SENIORITIES = ["manager", "director", "vp", "head", "c_suite"] as const;

async function apolloPeoplePage(country: TargetAccountCountry, page: number) {
  const market = targetMarket(country);
  if (!market) throw new Error(`Unsupported target market: ${country}`);
  const apiKey = clean(process.env.APOLLO_API_KEY, 1000);
  if (!apiKey) throw new Error("APOLLO_API_KEY is not configured.");

  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    },
    body: JSON.stringify({
      organization_locations: [country],
      organization_num_employees_ranges: [...TARGET_EMPLOYEE_RANGES],
      organization_naics_codes: market.naics.map(String),
      person_seniorities: [...TARGET_PERSON_SENIORITIES],
      person_titles: [...TARGET_PERSON_TITLES],
      include_similar_titles: true,
      page,
      per_page: 100,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = clean((payload.error as Record<string, unknown> | undefined)?.message || payload.message || `HTTP ${response.status}`);
    throw new Error(`Apollo zero-credit people search failed: ${message}`);
  }
  const people = Array.isArray(payload.people) ? payload.people as ApolloPersonSearchRow[] : [];
  return { people, total: numberValue(payload.total_entries, people.length) };
}

async function existingHubSpotCompanyNames(names: string[]) {
  const result = new Map<string, string>();
  const unique = [...new Set(names.map((name) => clean(name, 300)).filter(Boolean))];
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    try {
      const matches = await searchAll("companies", ["name", "domain", "account_type", "account_status"], [
        { propertyName: "name", operator: "IN", values: chunk },
      ]);
      for (const match of matches) {
        const name = clean(match.properties.name, 300).toLowerCase();
        if (name) result.set(name, String(match.id));
      }
    } catch {
      for (const name of chunk) {
        const matches = await searchAll("companies", ["name", "domain"], [
          { propertyName: "name", operator: "EQ", value: name },
        ]);
        if (matches[0]) result.set(name.toLowerCase(), String(matches[0].id));
      }
    }
  }
  return result;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return results;
}

async function discoverMarket(country: TargetAccountCountry, pages: number) {
  const market = targetMarket(country);
  if (!market) throw new Error(`Unsupported target market: ${country}`);

  const existingPool = await listAcquisitionAccounts({ limit: 1000, country, includeExcluded: true });
  const previousPages = existingPool.accounts
    .map((account) => Number(account.evidence?.apolloPeoplePage || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  const startPage = previousPages.length ? Math.max(...previousPages) + 1 : 1;
  const configuredResolveLimit = Number(process.env.TARGET_POOL_RESOLVE_LIMIT || 12);
  const resolveLimit = Math.max(5, Math.min(30, Number.isFinite(configuredResolveLimit) ? Math.round(configuredResolveLimit) : 12));

  const people: Array<ApolloPersonSearchRow & { __page: number }> = [];
  let peopleTotal = 0;
  let pagesUsed = 0;
  const companyNames = new Set<string>();

  for (let offset = 0; offset < pages; offset += 1) {
    const page = startPage + offset;
    const result = await apolloPeoplePage(country, page);
    peopleTotal = Math.max(peopleTotal, result.total);
    pagesUsed += 1;
    for (const person of result.people) {
      const companyName = clean(person.organization?.name, 300);
      if (!companyName) continue;
      people.push({ ...person, __page: page });
      companyNames.add(companyName.toLowerCase());
    }
    if (!result.people.length || companyNames.size >= resolveLimit) break;
  }

  const seedByCompany = new Map<string, ApolloPersonSearchRow & { __page: number }>();
  for (const person of people) {
    const companyName = clean(person.organization?.name, 300);
    const key = companyName.toLowerCase();
    if (!companyName || seedByCompany.has(key)) continue;
    seedByCompany.set(key, person);
    if (seedByCompany.size >= resolveLimit) break;
  }

  const names = [...seedByCompany.values()]
    .map((person) => clean(person.organization?.name, 300))
    .filter(Boolean);
  const hubspotByName = await existingHubSpotCompanyNames(names);
  const netNewSeeds = [...seedByCompany.values()].filter((person) => {
    const name = clean(person.organization?.name, 300).toLowerCase();
    return name && !hubspotByName.has(name);
  });

  const resolved = await mapWithConcurrency(netNewSeeds, 6, async (person) => {
    const name = clean(person.organization?.name, 300);
    if (!name) return null;
    try {
      const intelligence = await inspectProspectCompany({ companyName: name, website: "", emails: [] });
      const domain = normalizeCompanyDomain(intelligence.domain || intelligence.website);
      if (!domain) return null;
      return { person, name, domain, intelligence };
    } catch {
      return null;
    }
  });

  const uniqueResolved = new Map<string, NonNullable<(typeof resolved)[number]>>();
  for (const item of resolved) {
    if (!item || uniqueResolved.has(item.domain)) continue;
    uniqueResolved.set(item.domain, item);
  }

  const hubspotByDomain = await existingHubSpotDomains([...uniqueResolved.keys()]);
  const accounts: AcquisitionAccount[] = [...uniqueResolved.values()].map(({ person, name, domain, intelligence }) => {
    const industry = "Target industry";
    const exclusion = classifyExclusion({
      name,
      website_url: intelligence.website,
      seo_description: intelligence.verificationReason,
    }, domain);
    const hubspotCompanyId = hubspotByDomain.get(domain) || "";
    const finalExclusion = hubspotCompanyId
      ? { status: "excluded" as const, reason: "Already exists in HubSpot" }
      : exclusion;
    const scored = scoreTalenteraAccount({
      companyId: clean(person.id, 160) || domain,
      name,
      domain,
      country,
      employeeCount: 0,
      industry,
      activeJobs: 0,
      newJobs30d: 0,
      ats: intelligence.detectedAts || "",
    });
    const marketBonus = market.priority >= 88 ? 8 : market.priority >= 74 ? 5 : 2;
    const gtmScore = Math.min(100, scored.score + marketBonus + 5);
    const gtmTier = gtmScore >= 75 ? "A" : gtmScore >= 55 ? "B" : gtmScore >= 40 ? "C" : "Watch";

    return {
      domain,
      name,
      source: `Apollo People Target Pool · ${country}`,
      sourceId: clean(person.id, 160),
      country,
      employeeCount: 0,
      industry,
      activeJobs: 0,
      headcountGrowth: 0,
      hrHeadcount: 0,
      careerPageUrl: intelligence.careerPageUrl || "",
      detectedAts: intelligence.detectedAts || "",
      gtmScore,
      gtmTier,
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
      strongestSignal: `${country} target · 201+ employee filter · senior HR/TA persona present${intelligence.careerPageUrl ? " · career verified" : ""}`,
      recommendedAngle: scored.recommendedAngle,
      assignedOwnerId: "",
      assignedOwnerName: "",
      evidence: {
        targetPool: true,
        targetCountry: country,
        marketPhase: market.phase,
        marketPriority: market.priority,
        marketUniverse: market.marketSize,
        targetIndustries: market.industries,
        targetNaics: market.naics,
        apolloPeopleDiscovery: true,
        apolloPeoplePage: Number(person.__page || startPage),
        apolloPeopleTotal: peopleTotal,
        apolloSeedPersonId: clean(person.id, 160),
        apolloSeedFirstName: clean(person.first_name, 120),
        apolloSeedLastNameMasked: clean(person.last_name_obfuscated, 120),
        apolloSeedTitle: clean(person.title, 300),
        resolvedOfficialDomain: domain,
        officialWebsite: intelligence.website,
        careerEvidenceUrl: intelligence.evidenceUrl,
        careerConfidence: intelligence.careerConfidence,
        atsConfidence: intelligence.atsConfidence,
        verificationReason: intelligence.verificationReason,
        rawHiringObservation: intelligence.hiring,
        targetPoolVerifiedAt: new Date().toISOString(),
        targetPoolVerificationStatus: hubspotCompanyId ? "hubspot-existing" : "verified",
        discoveredAt: new Date().toISOString(),
        discoveryPolicy: "Apollo People Search (0 search credits): target country + 201+ employees + target NAICS + senior HR/TA; official domain and Career/ATS checked before storage",
        hiringCountPolicy: "Hiring observation stored as evidence only; raw Apollo job counts do not boost Target Pool score",
        feedMaritaRequested: false,
      },
    };
  });

  await upsertAcquisitionAccounts(accounts);
  const existingByDomain = accounts.filter((item) => item.exclusionReason === "Already exists in HubSpot").length;
  return {
    country,
    marketTotal: market.marketSize,
    peopleTotal,
    startPage,
    pagesUsed,
    peopleScanned: people.length,
    companyCandidates: seedByCompany.size,
    existingHubSpotByName: hubspotByName.size,
    resolvedDomains: uniqueResolved.size,
    unresolvedCompanies: Math.max(0, netNewSeeds.length - uniqueResolved.size),
    uniqueDomains: accounts.length,
    eligible: accounts.filter((item) => item.exclusionStatus === "eligible").length,
    review: accounts.filter((item) => item.exclusionStatus === "review").length,
    excluded: accounts.filter((item) => item.exclusionStatus === "excluded").length,
    existingHubSpot: hubspotByName.size + existingByDomain,
    discoveryMode: "apollo_people_zero_credit",
  };
}

async function verifyAccount(account: AcquisitionAccount) {
  const intelligence = await inspectProspectCompany({
    companyName: account.name,
    website: `https://${account.domain}`,
    emails: [],
  });
  const resolvedDomain = normalizeCompanyDomain(intelligence.domain || intelligence.website || account.domain) || account.domain;
  const hubspot = await existingHubSpotDomains([account.domain, resolvedDomain]);
  const hubspotCompanyId = hubspot.get(account.domain) || hubspot.get(resolvedDomain) || "";
  const excluded = Boolean(hubspotCompanyId);
  const scored = scoreTalenteraAccount({
    companyId: account.sourceId || account.domain,
    name: account.name,
    domain: resolvedDomain,
    country: account.country,
    employeeCount: account.employeeCount,
    industry: account.industry,
    activeJobs: 0,
    newJobs30d: 0,
    ats: intelligence.detectedAts || "",
  });
  const market = targetMarket(account.country);
  const marketBonus = market ? (market.priority >= 88 ? 8 : market.priority >= 74 ? 5 : 2) : 0;
  const gtmScore = Math.min(100, scored.score + marketBonus);
  const gtmTier = gtmScore >= 75 ? "A" : gtmScore >= 55 ? "B" : gtmScore >= 40 ? "C" : "Watch";
  const next: AcquisitionAccount = {
    ...account,
    careerPageUrl: intelligence.careerPageUrl || "",
    detectedAts: intelligence.detectedAts || "",
    gtmScore,
    gtmTier,
    fitScore: scored.fitScore,
    intentScore: scored.intentScore,
    atsOpportunityScore: scored.atsOpportunityScore,
    exclusionStatus: excluded ? "excluded" : account.exclusionStatus,
    exclusionReason: excluded ? "Already exists in HubSpot after live domain verification" : account.exclusionReason,
    hubspotCompanyId: hubspotCompanyId || account.hubspotCompanyId,
    status: excluded ? "excluded" : account.status,
    primaryPersona: scored.personas.primary,
    secondaryPersona: scored.personas.secondary,
    economicBuyer: scored.personas.economicBuyer,
    technicalInfluencer: scored.personas.technicalInfluencer,
    recommendedAngle: scored.recommendedAngle,
    strongestSignal: intelligence.careerPageUrl
      ? `${account.industry} target · career page verified${intelligence.detectedAts ? ` · ${intelligence.detectedAts}` : " · ATS unknown"}`
      : `${account.industry} target · official site checked · career/ATS still inconclusive`,
    evidence: {
      ...account.evidence,
      targetPoolVerifiedAt: new Date().toISOString(),
      targetPoolVerificationStatus: excluded ? "hubspot-existing" : "verified",
      resolvedOfficialDomain: resolvedDomain,
      officialWebsite: intelligence.website,
      careerEvidenceUrl: intelligence.evidenceUrl,
      careerConfidence: intelligence.careerConfidence,
      atsConfidence: intelligence.atsConfidence,
      verificationReason: intelligence.verificationReason,
      rawHiringObservation: intelligence.hiring,
      hiringCountPolicy: "Hiring observation stored as evidence only; Apollo/generic raw job counts do not boost Target Pool score",
    },
  };
  await upsertAcquisitionAccounts([next]);
  return next;
}

async function recheckBeforeFeed(account: AcquisitionAccount) {
  const resolved = normalizeCompanyDomain(clean(account.evidence?.resolvedOfficialDomain)) || account.domain;
  const hubspot = await existingHubSpotDomains([account.domain, resolved]);
  const companyId = hubspot.get(account.domain) || hubspot.get(resolved) || "";
  if (!companyId) return account;
  const next: AcquisitionAccount = {
    ...account,
    exclusionStatus: "excluded",
    exclusionReason: "Already exists in HubSpot at Marita feed recheck",
    hubspotCompanyId: companyId,
    status: "excluded",
    evidence: { ...account.evidence, feedMaritaRequested: false, hubspotRecheckedAt: new Date().toISOString() },
  };
  await upsertAcquisitionAccounts([next]);
  return next;
}

async function setFeedState(account: AcquisitionAccount, requested: boolean, taskId = "") {
  const next: AcquisitionAccount = {
    ...account,
    status: taskId ? "pushed" : account.status,
    evidence: {
      ...account.evidence,
      feedMaritaRequested: requested,
      feedMaritaRequestedAt: requested ? new Date().toISOString() : account.evidence?.feedMaritaRequestedAt || "",
      feedMaritaCompletedAt: taskId ? new Date().toISOString() : account.evidence?.feedMaritaCompletedAt || "",
      feedMaritaTaskId: taskId || account.evidence?.feedMaritaTaskId || "",
    },
  };
  await upsertAcquisitionAccounts([next]);
  return next;
}

export async function GET(request: NextRequest) {
  const country = clean(request.nextUrl.searchParams.get("country"), 160);
  const includeExcluded = request.nextUrl.searchParams.get("includeExcluded") === "1";
  const limit = Math.max(1, Math.min(1000, Number(request.nextUrl.searchParams.get("limit") || 1000)));
  const data = await listAcquisitionAccounts({ limit, country, includeExcluded });
  const accounts = data.accounts.filter((account) => account.evidence?.targetPool === true || /Target Pool/i.test(account.source));
  return NextResponse.json({
    ...data,
    accounts,
    markets: TARGET_ACCOUNT_MARKETS,
    targetUniverse: TARGET_ACCOUNT_TOTAL,
    configuration: configuration(),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site Target Pool action blocked." }, { status: 403 });
  if (!ownerAuthorized(request)) return NextResponse.json({ error: "Admin password access is required." }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Target Pool action.", details: parsed.error.flatten() }, { status: 400 });

  try {
    if (parsed.data.action === "discover_market") {
      return NextResponse.json(await discoverMarket(parsed.data.country, parsed.data.pages), { headers: { "Cache-Control": "no-store" } });
    }

    const account = await getAccount(parsed.data.domain);

    if (parsed.data.action === "verify_account") {
      const verified = await verifyAccount(account);
      return NextResponse.json({ status: "verified", account: verified }, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "request_feed") {
      if (account.exclusionStatus !== "eligible") return NextResponse.json({ error: account.exclusionReason || "Account is not eligible for Marita." }, { status: 409 });
      if (!account.evidence?.targetPoolVerifiedAt) {
        return NextResponse.json({ error: "Verify the company/career/ATS before requesting Marita feed." }, { status: 409 });
      }
      const rechecked = await recheckBeforeFeed(account);
      if (rechecked.exclusionStatus !== "eligible") {
        return NextResponse.json({ error: rechecked.exclusionReason, account: rechecked }, { status: 409 });
      }
      const next = await setFeedState(rechecked, true);
      return NextResponse.json({ status: "queued_for_marita", account: next }, { headers: { "Cache-Control": "no-store" } });
    }

    if (parsed.data.action === "cancel_feed") {
      const next = await setFeedState(account, false);
      return NextResponse.json({ status: "feed_cancelled", account: next }, { headers: { "Cache-Control": "no-store" } });
    }

    const next = await setFeedState(account, false, parsed.data.taskId);
    return NextResponse.json({ status: "feed_completed", account: next }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Target Account Pool action failed." }, { status: 500 });
  }
}
