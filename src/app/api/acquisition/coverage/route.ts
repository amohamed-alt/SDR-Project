import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  upsertAcquisitionAccounts,
  type AcquisitionAccount,
} from "@/lib/acquisition-data-api";
import {
  ACQUISITION_COUNTRY_SECTORS,
  ACQUISITION_COVERAGE_COUNTRIES,
  ACQUISITION_COVERAGE_EMPLOYEE_RANGES,
  classifyCoverageSector,
  employeeCoverageTier,
} from "@/lib/acquisition-market-coverage";
import { verifiedActiveJobCount } from "@/lib/acquisition-job-count";
import { searchAll } from "@/lib/hubspot";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";
import { sdrAdminAuthorized, sdrAdminConfigured } from "@/lib/sdr-admin-auth";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.literal("discover"),
  startPage: z.number().int().min(1).max(500).default(1),
  pages: z.number().int().min(1).max(6).default(1),
  confirmCredits: z.boolean(),
});

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

const COMPETITOR_PATTERN = /\b(applicant tracking system|\bats\b software|recruitment software|recruiting software|talent acquisition platform|recruitment platform|recruiting platform|candidate tracking|job board|jobs marketplace|hiring software)\b/i;
const KNOWN_COMPETITOR_PATTERN = /\b(elevatus|manatal|workable|greenhouse|lever|recruitee|teamtailor|smartrecruiters|icims|jobvite|sniperhire|cazar|akhtaboot|bayt|naukrigulf)\b/i;
const RECRUITMENT_SERVICE_PATTERN = /\b(recruitment agency|staffing agency|staffing services|executive search|manpower|recruitment services|talent consultancy)\b/i;

function clean(value: unknown, max = 1_000) {
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
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

function configuration() {
  return {
    apolloConfigured: Boolean(clean(process.env.APOLLO_API_KEY, 1_000)),
    ownerActionsConfigured: sdrAdminConfigured(),
    apolloCost: "1 credit per results page; up to 100 companies per page",
    discoveryBatchLimit: 6,
    countries: ACQUISITION_COVERAGE_COUNTRIES,
    employeeRanges: ACQUISITION_COVERAGE_EMPLOYEE_RANGES,
    sweetPool: "251–5,000 employees",
    enterpriseExtension: "5,001–50,000 employees",
    sectorsByCountry: ACQUISITION_COUNTRY_SECTORS,
    governmentPolicy: "Government and semi-government accounts are targetable and remain in the coverage ledger.",
    unknownIndustryPolicy: "Store as review instead of dropping, so coverage gaps stay visible.",
    hubspotPolicy: "Existing HubSpot companies stay in the ledger but are blocked from net-new creation.",
  };
}

function accountText(org: ApolloOrganization) {
  const location = org.location && typeof org.location === "object" ? JSON.stringify(org.location) : "";
  const keywords = Array.isArray(org.keywords) ? org.keywords.join(" ") : "";
  const parent = [org.owned_by_organization, org.ultimate_parent_organization]
    .map((item) => typeof item === "object" ? JSON.stringify(item) : clean(item))
    .join(" ");
  return [
    org.name,
    org.industry,
    org.short_description,
    org.seo_description,
    keywords,
    location,
    parent,
  ].map((item) => clean(item, 2_500)).join(" ");
}

function organizationCountry(org: ApolloOrganization) {
  const location = org.location as Record<string, unknown> | undefined;
  return clean(location?.country || org.country || org.organization_location || "", 160);
}

function organizationDomain(org: ApolloOrganization) {
  return normalizeCompanyDomain(clean(org.primary_domain || org.domain || org.website_url, 1_000));
}

function classifyGuardrail(org: ApolloOrganization) {
  const text = accountText(org);
  if (COMPETITOR_PATTERN.test(text) || KNOWN_COMPETITOR_PATTERN.test(text)) {
    return { status: "excluded" as const, reason: "ATS / recruitment-tech / job-board competitor signal detected" };
  }
  if (RECRUITMENT_SERVICE_PATTERN.test(text)) {
    return { status: "review" as const, reason: "Recruitment/staffing service: manual review before prospecting" };
  }
  return null;
}

function apolloUrl(page: number) {
  const query = new URLSearchParams();
  for (const location of ACQUISITION_COVERAGE_COUNTRIES) {
    query.append("organization_locations[]", location);
  }
  for (const range of ACQUISITION_COVERAGE_EMPLOYEE_RANGES) {
    query.append("organization_num_employees_ranges[]", range);
  }
  query.set("page", String(page));
  query.set("per_page", "100");
  return `https://api.apollo.io/api/v1/mixed_companies/search?${query.toString()}`;
}

async function apolloPage(page: number) {
  const apiKey = clean(process.env.APOLLO_API_KEY, 1_000);
  if (!apiKey) throw new Error("APOLLO_API_KEY is not configured on the production server.");
  const response = await fetch(apolloUrl(page), {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = clean(
      (payload.error as Record<string, unknown> | undefined)?.message
        || payload.message
        || `HTTP ${response.status}`,
    );
    throw new Error(`Apollo coverage discovery failed: ${message}`);
  }
  const organizations = Array.isArray(payload.organizations)
    ? payload.organizations as ApolloOrganization[]
    : Array.isArray(payload.accounts)
      ? payload.accounts as ApolloOrganization[]
      : [];
  const pagination = (payload.pagination || {}) as Record<string, unknown>;
  return {
    organizations,
    total: numberValue(
      pagination.total_entries,
      pagination.total,
      payload.total_entries,
      organizations.length,
    ),
  };
}

async function existingHubSpotDomains(domains: string[]) {
  const result = new Map<string, string>();
  const unique = [...new Set(domains.filter(Boolean))];
  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    try {
      const matches = await searchAll(
        "companies",
        ["name", "domain"],
        [{ propertyName: "domain", operator: "IN", values: chunk }],
      );
      for (const match of matches) {
        const domain = normalizeCompanyDomain(clean(match.properties.domain));
        if (domain) result.set(domain, String(match.id));
      }
    } catch {
      for (const domain of chunk) {
        const matches = await searchAll(
          "companies",
          ["name", "domain"],
          [{ propertyName: "domain", operator: "EQ", value: domain }],
        );
        if (matches[0]) result.set(domain, String(matches[0].id));
      }
    }
  }
  return result;
}

function accountFromOrganization(
  org: ApolloOrganization,
  domain: string,
  page: number,
  hubspotCompanyId: string,
): AcquisitionAccount {
  const name = clean(org.name, 300) || domain;
  const rawCountry = organizationCountry(org);
  const rawIndustry = clean(org.industry, 300);
  const text = accountText(org);
  const employeeCount = Math.max(
    0,
    Math.round(numberValue(org.estimated_num_employees, org.employee_count, org.num_employees)),
  );
  const jobs = verifiedActiveJobCount(org);
  const coverage = classifyCoverageSector(rawCountry, text);
  const guardrail = classifyGuardrail(org);
  const coverageDecision = guardrail || {
    status: coverage.status,
    reason: coverage.reason,
  };
  const scored = scoreTalenteraAccount({
    companyId: clean(org.id || org.organization_id, 160) || domain,
    name,
    domain,
    country: coverage.country || rawCountry,
    employeeCount,
    industry: rawIndustry,
    activeJobs: jobs,
    newJobs30d: 0,
    ats: "",
  });

  const exclusionStatus = hubspotCompanyId ? "excluded" : coverageDecision.status;
  const exclusionReason = hubspotCompanyId ? "Already exists in HubSpot" : coverageDecision.reason;
  const status = hubspotCompanyId
    ? "existing_hubspot"
    : exclusionStatus === "excluded"
      ? "excluded"
      : "candidate";

  return {
    domain,
    name,
    source: "Apollo · GCC+Egypt market coverage",
    sourceId: clean(org.id || org.organization_id, 160),
    country: coverage.country || scored.country || rawCountry,
    employeeCount,
    industry: rawIndustry,
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
    exclusionStatus,
    exclusionReason,
    hubspotCompanyId,
    status,
    primaryPersona: scored.personas.primary,
    secondaryPersona: scored.personas.secondary,
    economicBuyer: scored.personas.economicBuyer,
    technicalInfluencer: scored.personas.technicalInfluencer,
    strongestSignal: scored.signals[0]?.evidence
      || `${coverage.sector || rawIndustry || "Unmapped industry"} · ${employeeCoverageTier(employeeCount)}`,
    recommendedAngle: scored.recommendedAngle,
    assignedOwnerId: "",
    assignedOwnerName: "",
    evidence: {
      coverageVersion: "gcc-egypt-sweet-pool-v1",
      apolloPage: page,
      rawCountry,
      rawIndustry,
      rawKeywords: org.keywords || [],
      coverageCountry: coverage.country || "",
      coverageSector: coverage.sector,
      targetIndustry: coverage.targeted,
      employeeCoverageTier: employeeCoverageTier(employeeCount),
      governmentTargetingAllowed: true,
      hubspotCoverageState: hubspotCompanyId ? "existing" : "net_new",
      guardrail: guardrail || null,
      sourceText: text.slice(0, 3_000),
    },
  };
}

async function discoverCoverage(startPage: number, pages: number) {
  const collected: Array<{ org: ApolloOrganization; page: number }> = [];
  let rawTotal = 0;
  let pagesFetched = 0;

  for (let offset = 0; offset < pages; offset += 1) {
    const page = startPage + offset;
    const result = await apolloPage(page);
    pagesFetched += 1;
    rawTotal = Math.max(rawTotal, result.total);
    collected.push(...result.organizations.map((org) => ({ org, page })));
    if (!result.organizations.length) break;
  }

  const unique = new Map<string, { org: ApolloOrganization; page: number }>();
  for (const item of collected) {
    const domain = organizationDomain(item.org);
    if (domain && !unique.has(domain)) unique.set(domain, item);
  }

  const hubspot = await existingHubSpotDomains([...unique.keys()]);
  const accounts = [...unique.entries()].map(([domain, item]) => accountFromOrganization(
    item.org,
    domain,
    item.page,
    hubspot.get(domain) || "",
  ));

  if (accounts.length) await upsertAcquisitionAccounts(accounts);

  const totalPages = rawTotal > 0 ? Math.ceil(rawTotal / 100) : 0;
  const lastPage = pagesFetched > 0 ? startPage + pagesFetched - 1 : startPage - 1;
  return {
    rawTotal,
    estimatedTotalPages: totalPages,
    estimatedSearchCreditsForFullUniverse: totalPages,
    startPage,
    lastPage,
    nextPage: totalPages && lastPage < totalPages ? lastPage + 1 : null,
    pagesFetched,
    creditsUsedUpperBound: pagesFetched,
    fetched: collected.length,
    uniqueDomains: accounts.length,
    stored: accounts.length,
    eligible: accounts.filter((account) => account.exclusionStatus === "eligible").length,
    review: accounts.filter((account) => account.exclusionStatus === "review").length,
    excluded: accounts.filter((account) => account.exclusionStatus === "excluded").length,
    existingHubSpot: accounts.filter((account) => account.status === "existing_hubspot").length,
    sweetPool: accounts.filter((account) => employeeCoverageTier(account.employeeCount) === "sweet_pool").length,
    enterpriseExtension: accounts.filter((account) => employeeCoverageTier(account.employeeCount) === "enterprise_extension").length,
    targetIndustry: accounts.filter((account) => account.evidence?.targetIndustry === true).length,
    unknownIndustryReview: accounts.filter((account) => account.exclusionReason.includes("target-sector matrix")).length,
    batch: accounts.map((account) => ({
      domain: account.domain,
      name: account.name,
      country: account.country,
      employeeCount: account.employeeCount,
      industry: account.industry,
      coverageSector: account.evidence?.coverageSector || "",
      employeeCoverageTier: account.evidence?.employeeCoverageTier || "",
      activeJobs: account.activeJobs,
      gtmScore: account.gtmScore,
      gtmTier: account.gtmTier,
      status: account.status,
      exclusionStatus: account.exclusionStatus,
      exclusionReason: account.exclusionReason,
      hubspotCompanyId: account.hubspotCompanyId,
    })),
  };
}

export async function GET() {
  return NextResponse.json({
    coverage: configuration(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) {
      return NextResponse.json({ error: "Cross-site acquisition actions are not allowed." }, { status: 403 });
    }
    if (!sdrAdminAuthorized(request)) {
      return NextResponse.json({ error: "Admin authorization is required for market coverage discovery." }, { status: 401 });
    }

    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid coverage discovery action", details: parsed.error.flatten() }, { status: 400 });
    }
    if (!parsed.data.confirmCredits) {
      return NextResponse.json({
        error: `Apollo coverage discovery requires explicit confirmation for up to ${parsed.data.pages} credit(s).`,
      }, { status: 400 });
    }

    const result = await discoverCoverage(parsed.data.startPage, parsed.data.pages);
    return NextResponse.json({
      action: "discover",
      creditsAuthorized: parsed.data.pages,
      ...result,
      coverage: configuration(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Market coverage discovery failed", error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Market coverage discovery failed.",
    }, { status: 500 });
  }
}
