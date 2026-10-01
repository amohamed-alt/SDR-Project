import { NextRequest, NextResponse } from "next/server";
import { getAcquisitionAccount, upsertAcquisitionAccounts, type AcquisitionAccount } from "@/lib/acquisition-data-api";
import { inventoryDomain, inventoryImportSchema } from "@/lib/lead-inventory-import";
import { isThirdPartyCompanyDomain } from "@/lib/company-domain-safety";
import { searchAll } from "@/lib/hubspot";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";
import { originMatchesRequestHosts } from "@/lib/request-origin";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Unlock Admin access first." }, { status: 401 });
  if (!originMatchesRequestHosts({ origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), requestHost: request.nextUrl.host })) return NextResponse.json({ error: "Cross-site imports are not allowed." }, { status: 403 });
  const text = await request.text();
  if (text.length > 250_000) return NextResponse.json({ error: "Import is too large. Use up to 100 companies per batch." }, { status: 413 });
  let json: unknown;
  try { json = JSON.parse(text); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = inventoryImportSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid company import", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  try {
    const seen = new Set<string>();
    const accounts: AcquisitionAccount[] = [];
    const rows: Array<{ domain: string; name: string; outcome: string; reason: string }> = [];
    async function inspectCompany(company: typeof input.companies[number]) {
      let domain: string;
      try { domain = inventoryDomain(company.domain); } catch (error) {
        rows.push({ domain: company.domain, name: company.name, outcome: "invalid", reason: error instanceof Error ? error.message : "Invalid domain" }); return;
      }
      if (seen.has(domain)) { rows.push({ domain, name: company.name, outcome: "duplicate", reason: "Repeated in this batch" }); return; }
      seen.add(domain);
      if (isThirdPartyCompanyDomain(domain, company.name)) { rows.push({ domain, name: company.name, outcome: "invalid", reason: "Use the company's own domain" }); return; }
      const existing = await getAcquisitionAccount(domain);
      if (existing) { rows.push({ domain, name: company.name, outcome: "duplicate", reason: "Already in inventory; existing data preserved" }); return; }
      // A failed CRM lookup aborts the import; it never means the company is new.
      const matches = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "EQ", value: domain }]);
      const nameMatches = matches.length ? [] : await searchAll("companies", ["name", "domain"], [{ propertyName: "name", operator: "EQ", value: company.name }]);
      const match = matches[0] || nameMatches[0];
      const government = /government|ministry|municipality|government agency|applicant tracking software|recruitment software|وزارة|بلدية|حكوم/i.test(`${company.name} ${company.industry} ${company.evidence}`);
      const excluded = Boolean(match || government);
      // Imported records require identity/ICP review before paid enrichment.
      const reason = match ? "Already exists in HubSpot" : government ? "Government signal detected" : "Imported company: verify identity, ownership and ICP before enrichment";
      const scored = scoreTalenteraAccount({ companyId: domain, name: company.name, domain, country: company.country, employeeCount: company.employeeCount, industry: company.industry, activeJobs: 0, newJobs30d: 0, ats: company.detectedAts });
      const evalufy = company.businessLine === "Evalufy";
      accounts.push({
        domain, name: company.name, source: input.source, sourceId: company.sourceUrl.slice(0, 160),
        country: scored.country || company.country, employeeCount: company.employeeCount, industry: company.industry,
        activeJobs: 0, headcountGrowth: 0, hrHeadcount: 0, careerPageUrl: company.careerPageUrl, detectedAts: company.detectedAts,
        gtmScore: evalufy ? 0 : scored.score, gtmTier: evalufy ? "Watch" : scored.tier,
        fitScore: evalufy ? 0 : scored.fitScore, intentScore: 0, atsOpportunityScore: evalufy ? 0 : scored.atsOpportunityScore,
        exclusionStatus: excluded ? "excluded" : "review", exclusionReason: reason, hubspotCompanyId: match?.id || "",
        status: match ? "existing_hubspot" : excluded ? "excluded" : "candidate",
        primaryPersona: evalufy ? "Assessment / Admissions Manager" : scored.personas.primary,
        secondaryPersona: evalufy ? "Examinations / Recruitment Manager" : scored.personas.secondary,
        economicBuyer: evalufy ? "Department Director" : scored.personas.economicBuyer,
        technicalInfluencer: evalufy ? "Assessment Operations" : scored.personas.technicalInfluencer,
        strongestSignal: company.evidence || "Company discovered; qualification pending", recommendedAngle: evalufy ? "Validate assessment, selection or admissions requirements" : scored.recommendedAngle,
        assignedOwnerId: "", assignedOwnerName: "",
        evidence: { businessLine: company.businessLine, sourceUrl: company.sourceUrl, companyLinkedIn: company.linkedinUrl, importedAt: new Date().toISOString(), sourceEvidence: company.evidence, atsVerified: false, inventoryImport: true },
      });
      rows.push({ domain, name: company.name, outcome: excluded ? "excluded" : "review", reason });
    }
    for (let index = 0; index < input.companies.length; index += 4) {
      await Promise.all(input.companies.slice(index, index + 4).map(inspectCompany));
    }
    const saved = input.execute && accounts.length ? await upsertAcquisitionAccounts(accounts, true) : { accounts: 0 };
    return NextResponse.json({ executed: input.execute, added: saved.accounts, candidates: accounts.length, duplicates: rows.filter((row) => row.outcome === "duplicate").length, invalid: rows.filter((row) => row.outcome === "invalid").length, rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Inventory import failed" }, { status: 502 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Unlock Admin access first." }, { status: 401 });
  if (!originMatchesRequestHosts({ origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), requestHost: request.nextUrl.host })) return NextResponse.json({ error: "Cross-site actions are not allowed." }, { status: 403 });
  const body = await request.json().catch(() => null) as { domain?: string; identityReviewed?: boolean; icpReviewed?: boolean } | null;
  if (!body || typeof body.domain !== "string" || body.identityReviewed !== true || body.icpReviewed !== true) return NextResponse.json({ error: "Confirm company identity and ICP review." }, { status: 400 });
  try {
    const domain = inventoryDomain(body.domain);
    const account = await getAcquisitionAccount(domain);
    if (!account) return NextResponse.json({ error: "Company not found" }, { status: 404 });
    if (account.exclusionStatus !== "review") return NextResponse.json({ error: "Only review records can be qualified." }, { status: 409 });
    const matches = await searchAll("companies", ["name", "domain"], [{ propertyName: "domain", operator: "EQ", value: domain }]);
    const names = matches.length ? [] : await searchAll("companies", ["name", "domain"], [{ propertyName: "name", operator: "EQ", value: account.name }]);
    if (matches.length || names.length) return NextResponse.json({ error: "Company now exists in HubSpot; keep it out of the new-company queue." }, { status: 409 });
    await upsertAcquisitionAccounts([{ ...account, exclusionStatus: "eligible", exclusionReason: "", status: "qualified", evidence: { ...account.evidence, identityReviewed: true, icpReviewed: true, reviewedAt: new Date().toISOString() } }]);
    return NextResponse.json({ qualified: true, domain });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Qualification failed" }, { status: 502 }); }
}
