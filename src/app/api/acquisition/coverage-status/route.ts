import { NextResponse } from "next/server";
import { listAcquisitionAccounts } from "@/lib/acquisition-data-api";
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
  note: "Approved 100-company probe completed. Page 1 surfaced HubSpot-linked account records, so existing CRM coverage is preserved instead of duplicated.",
};

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET() {
  try {
    const data = await listAcquisitionAccounts({ limit: 1000, includeExcluded: true });
    const accounts = data.accounts || [];
    const discoveredPages = new Set<number>(APOLLO_PROBE.initialCompletedPages);

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

    const existingHubSpot = accounts.filter((account) => account.status === "existing_hubspot" || Boolean(account.hubspotCompanyId)).length;
    const eligible = accounts.filter((account) => account.exclusionStatus === "eligible").length;
    const review = accounts.filter((account) => account.exclusionStatus === "review").length;
    const excluded = accounts.filter((account) => account.exclusionStatus === "excluded" && !account.hubspotCompanyId).length;
    const sweetPool = accounts.filter((account) => account.employeeCount >= 251 && account.employeeCount <= 5_000).length;
    const enterpriseExtension = accounts.filter((account) => account.employeeCount > 5_000 && account.employeeCount <= 50_000).length;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      storage: {
        database: data.database || "postgresql",
        mode: "persistent",
        autoLoad: true,
        sourceOfTruth: "Postgres acquisition ledger + HubSpot dedupe",
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
      },
      ledger: {
        stored: accounts.length,
        eligible,
        existingHubSpot,
        review,
        excluded,
        sweetPool,
        enterpriseExtension,
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
