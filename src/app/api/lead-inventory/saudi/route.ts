import { createHash } from "node:crypto";
import { saudi200Candidate, saudiPolicyExcluded } from "@/lib/saudi-inventory-policy";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SaudiInventoryState, SAUDI_EMPLOYEE_RANGE, type SaudiPage } from "@/lib/saudi-inventory-state";
import { inventoryDomain } from "@/lib/lead-inventory-import";
import { isThirdPartyCompanyDomain } from "@/lib/company-domain-safety";
import { searchAll } from "@/lib/hubspot";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";
import { upsertAcquisitionAccounts, markSaudiInventoryMembership, type AcquisitionAccount } from "@/lib/acquisition-data-api";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";
import { originMatchesRequestHosts } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const state = new SaudiInventoryState();
const input = z.object({ page: z.number().int().min(1).max(500), confirmCredits: z.literal(true) }).strict();
const clean = (value: unknown, max = 300) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

export async function GET() {
  try { return NextResponse.json(await state.summary(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Cannot read crawl state" }, { status: 503 }); }
}

async function fetchPage(page: number): Promise<SaudiPage> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new Error("APOLLO_API_KEY is not configured");
  // Numeric ceiling exceeds any plausible global company headcount. Apollo's
  // documented API requires min,max; no practical upper-size cutoff is imposed.
  const query = new URLSearchParams({ "organization_locations[]": "Saudi Arabia", "organization_num_employees_ranges[]": SAUDI_EMPLOYEE_RANGE, per_page: "100", page: String(page) });
  await state.claim(page);
  const response = await fetch(`https://api.apollo.io/api/v1/mixed_companies/search?${query}`, {
    method: "POST", headers: { "x-api-key": key, "Content-Type": "application/json", Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Apollo search failed HTTP ${response.status}; page attempt retained to prevent accidental repeat spend`);
  const payload = await response.json() as Record<string, unknown>;
  const organizations = Array.isArray(payload.organizations) ? payload.organizations : Array.isArray(payload.accounts) ? payload.accounts : null;
  const pagination = payload.pagination as Record<string, unknown> | undefined;
  const total = Number(pagination?.total_entries ?? pagination?.total ?? payload.total_entries);
  if (!organizations || !Number.isSafeInteger(total) || total < 0 || organizations.length > 100) throw new Error("Apollo returned an unexpected search response; crawl stopped");
  const result = { organizations: organizations as Record<string, unknown>[], total };
  await state.write(page, "raw", result);
  return result;
}

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Admin authorization required" }, { status: 401 });
  if (!originMatchesRequestHosts({ origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), requestHost: request.nextUrl.host })) return NextResponse.json({ error: "Cross-site action rejected" }, { status: 403 });
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Supply page and confirmCredits:true" }, { status: 400 });
  const page = parsed.data.page;
  try {
    const completed = await state.read<Record<string, unknown>>(page, "result");
    if (completed) return NextResponse.json({ ...completed, reused: true, providerCreditsUsed: 0 });
    const progress = await state.summary();
    if (progress.nextPage !== page) return NextResponse.json({ error: "Process the next incomplete page", nextPage: progress.nextPage }, { status: 409 });
    if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN || !process.env.DASHBOARD_CACHE_API_URL) throw new Error("CRM/storage configuration missing; no provider call made");
    const storedRaw = await state.read<SaudiPage>(page, "raw");
    const raw = storedRaw || await fetchPage(page);
    const identities = raw.organizations.map((org) => {
      const name = clean(org.name);
      let domain = "";
      try { domain = inventoryDomain(clean(org.primary_domain || org.domain || org.website_url, 1000)); } catch { /* Preserve unresolved organizations in review. */ }
      if (domain && isThirdPartyCompanyDomain(domain, name)) domain = "";
      const uid = clean(org.organization_id || org.id, 160);
      return { org, name, domain, key: domain || `apollo-${createHash("sha256").update(uid || name).digest("hex").slice(0,24)}.invalid`, uid };
    });
    const realDomains = [...new Set(identities.map((item) => item.domain).filter(Boolean))];
    const aliases = realDomains.flatMap((domain) => [domain, `www.${domain}`, `https://${domain}`, `http://${domain}`, `https://www.${domain}`, `http://www.${domain}`]);
    const matches = new Map<string, string>();
    for (let index = 0; index < aliases.length; index += 100) {
      const rows = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "IN", values: aliases.slice(index, index + 100) }]);
      for (const row of rows) { try { matches.set(inventoryDomain(row.properties.domain || ""), row.id); } catch { /* Name matching follows. */ } }
    }
    const names = [...new Set(identities.map((item) => item.name).filter(Boolean))];
    const nameMatches = names.length ? await searchAll("companies", ["name", "domain"], [{ propertyName: "name", operator: "IN", values: names }]) : [];
    const byName = new Map(nameMatches.map((row) => [clean(row.properties.name).toLowerCase(), row.id]));
    const accounts: AcquisitionAccount[] = identities.map(({ org, name, domain, key, uid }) => {
      const count = Number(org.estimated_num_employees ?? org.employee_count ?? org.num_employees ?? 0);
      const employeeCount = Number.isFinite(count) && count > 0 ? Math.round(count) : 0;
      const country = clean(org.country || (org.location as Record<string, unknown> | undefined)?.country) || "Saudi Arabia";
      const industry = clean(org.industry);
      const text = clean([name, industry, org.short_description, org.seo_description, ...(Array.isArray(org.keywords) ? org.keywords : [])].join(" "), 3000);
      const hubspotCompanyId = matches.get(domain) || byName.get(name.toLowerCase()) || "";
      const excluded = saudiPolicyExcluded(domain, text) || !saudi200Candidate(country, employeeCount);
      const exclusionReason = hubspotCompanyId ? "Already exists in HubSpot" : excluded ? "Outside Saudi 200+ prospecting policy / government or job-board signal" : !domain ? "Resolve company domain before CRM creation" : "Net-new candidate: identity and ICP review required before contact enrichment";
      const scored = scoreTalenteraAccount({ companyId: uid || key, name, domain, country, employeeCount, industry, activeJobs: 0, newJobs30d: 0, ats: "" });
      return { domain: key, name: name || key, source: "Apollo · Saudi 200+", sourceId: uid, country, employeeCount, industry, activeJobs: 0, headcountGrowth: 0, hrHeadcount: 0, careerPageUrl: "", detectedAts: "", gtmScore: scored.score, gtmTier: scored.tier, fitScore: scored.fitScore, intentScore: 0, atsOpportunityScore: scored.atsOpportunityScore,
        exclusionStatus: hubspotCompanyId || excluded ? "excluded" : "review", exclusionReason, hubspotCompanyId, status: hubspotCompanyId ? "existing_hubspot" : excluded ? "excluded" : "candidate",
        primaryPersona: scored.personas.primary, secondaryPersona: scored.personas.secondary, economicBuyer: scored.personas.economicBuyer, technicalInfluencer: scored.personas.technicalInfluencer, strongestSignal: "Saudi headquarters / 200+ employees matched Apollo search; exact size shown only if returned", recommendedAngle: scored.recommendedAngle, assignedOwnerId: "", assignedOwnerName: "",
        evidence: { businessLine: "Talentera", saudi200: true, saudi200Page: page, saudi200CheckedAt: new Date().toISOString(), saudi200EmployeeRange: SAUDI_EMPLOYEE_RANGE, sourceText: text, companyLinkedIn: clean(org.linkedin_url, 2000), syntheticDomainKey: !domain, inventoryImport: true, atsVerified: false } };
    });
    const unique = [...new Map(accounts.map((account) => [account.domain, account])).values()];
    const saved = await upsertAcquisitionAccounts(unique, true);
    await markSaudiInventoryMembership(unique.filter((account) => saudi200Candidate(account.country, account.employeeCount)).map((account) => ({ domain: account.domain, employeeCount: account.employeeCount, hubspotCompanyId: account.hubspotCompanyId, policyExcluded: !account.hubspotCompanyId && account.exclusionStatus === "excluded", evidence: { saudi200: true, saudi200Page: page, saudi200CheckedAt: account.evidence.saudi200CheckedAt, saudi200EmployeeRange: SAUDI_EMPLOYEE_RANGE } })));
    const result = { page, total: raw.total, totalPages: Math.ceil(raw.total / 100), fetched: raw.organizations.length, newInventoryRows: saved.accounts, existingHubSpot: unique.filter((account) => account.hubspotCompanyId).length, notInHubSpot: unique.filter((account) => !account.hubspotCompanyId).length, review: unique.filter((account) => account.exclusionStatus === "review").length, providerCreditsUsed: storedRaw ? 0 : 1, signalHireCreditsUsed: 0, checkedAt: new Date().toISOString() };
    await state.write(page, "result", result);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Saudi inventory crawl failed", page }, { status: 502 }); }
}
