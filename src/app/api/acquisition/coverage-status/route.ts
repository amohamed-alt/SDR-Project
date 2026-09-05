import { NextResponse } from "next/server";
import { listAcquisitionAccounts } from "@/lib/acquisition-data-api";
import { readAcquisitionCoverageProgress } from "@/lib/acquisition-coverage-progress";
import {
  ACQUISITION_COUNTRY_SECTORS,
  ACQUISITION_COVERAGE_COUNTRIES,
  ACQUISITION_COVERAGE_EMPLOYEE_RANGES,
} from "@/lib/acquisition-market-coverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APOLLO_PROBE = {
  provider: "Apollo",
  probedAt: "2026-09-05",
  totalEntries: 8_884,
  perPage: 100,
  totalPages: 89,
  initialCompletedPages: [1],
  initialCreditsUsed: 1,
  note: "Approved 100-company probe completed. Persistent crawl checkpoints prevent re-spending credits on pages already captured.",
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  try {
    const [data, progress] = await Promise.all([
      listAcquisitionAccounts({ limit: 1000, includeExcluded: true }),
      readAcquisitionCoverageProgress(),
    ]);
    const accounts = data.accounts || [];
    const discoveredPages = new Set<number>([
      ...APOLLO_PROBE.initialCompletedPages,
      ...progress.completedPages,
    ]);

    for (const account of accounts) {
      const page = numberValue(account.evidence?.apolloPage);
      if (page > 0 && page <= APOLLO_PROBE.totalPages) discoveredPages.add(page);
    }

    const completedPages = [...discoveredPages].sort((a, b) => a - b);
    const pageCoveragePercent = Math.min(100, Math.round((completedPages.length / APOLLO_PROBE.totalPages) * 10_000) / 100);
    const countryRows = ACQUISITION_COVERAGE_COUNTRIES.map((country) => {
      const rows = accounts.filter((account) => account.country === country);
      return {
        country,
        stored: rows.length,
        eligible: rows.filter((account) => account.exclusionStatus === "eligible").length,
        review: rows.filter((account) => account.exclusionStatus === "review").length,
        existingHubSpot: rows.filter((account) => account.status === "existing_hubspot" || Boolean(account.hubspotCompanyId)).length,
        targetSectors: ACQUISITION_COUNTRY_SECTORS[country].length,
      };
    });

    const visibleExistingHubSpot = accounts.filter((account) => account.status === "existing_hubspot" || Boolean(account.hubspotCompanyId)).length;
    const visibleReview = accounts.filter((account) => account.exclusionStatus === "review").length;
    const visibleExcluded = accounts.filter((account) => account.exclusionStatus === "excluded" && !account.hubspotCompanyId).length;
    const visibleSweetPool = accounts.filter((account) => account.employeeCount >= 251 && account.employeeCount <= 5_000).length;
    const visibleEnterpriseExtension = accounts.filter((account) => account.employeeCount > 5_000 && account.employeeCount <= 50_000).length;
    const fullEligible = Number(data.summary?.eligible || 0);
    const fullNonEligible = Number(data.summary?.excluded || 0);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      storage: {
        database: data.database || "postgresql",
        mode: "persistent",
        autoLoad: true,
        sourceOfTruth: "Postgres acquisition ledger + HubSpot dedupe",
        visibleAccountLimit: accounts.length,
      },
      scope: {
        countries: ACQUISITION_COVERAGE_COUNTRIES,
        employeeRanges: ACQUISITION_COVERAGE_EMPLOYEE_RANGES,
        sweetPool: "251–5,000 employees",
        enterpriseExtension: "5,001–50,000 employees",
        governmentIncluded: true,
        unknownIndustryPolicy: "review",
      },
      probe: {
        ...APOLLO_PROBE,
        completedPages,
        completedPageCount: completedPages.length,
        pageCoveragePercent,
        estimatedAdditionalSearchCreditsToFinish: Math.max(0, APOLLO_PROBE.totalPages - completedPages.length),
        checkpointUpdatedAt: progress.updatedAt,
      },
      ledger: {
        stored: fullEligible + fullNonEligible,
        eligible: fullEligible,
        existingHubSpot: visibleExistingHubSpot,
        review: visibleReview,
        excluded: visibleExcluded,
        sweetPool: visibleSweetPool,
        enterpriseExtension: visibleEnterpriseExtension,
      },
      countries: countryRows,
      accounts,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load acquisition coverage status.",
    }, { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
