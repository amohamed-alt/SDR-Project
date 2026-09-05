import { NextRequest, NextResponse } from "next/server";
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
  note: "All 89 authorized Apollo page calls are accounted for. Page 30 is retained as a spent/partial coverage page and is never retried automatically.",
};

function integer(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    const page = integer(request.nextUrl.searchParams.get("page"), 1, 1, 100_000);
    const limit = integer(request.nextUrl.searchParams.get("limit"), 100, 20, 200);
    const country = String(request.nextUrl.searchParams.get("country") || "").trim();
    const q = String(request.nextUrl.searchParams.get("q") || "").trim();
    const requestedStatus = String(request.nextUrl.searchParams.get("status") || "all").trim();
    const status = requestedStatus === "hubspot" ? "existing_hubspot" : "";
    const exclusionStatus = requestedStatus === "net-new"
      ? "eligible"
      : requestedStatus === "review"
        ? "review"
        : requestedStatus === "excluded"
          ? "excluded"
          : "";

    const [data, progress] = await Promise.all([
      listAcquisitionAccounts({
        limit,
        offset: (page - 1) * limit,
        includeExcluded: true,
        country,
        q,
        status,
        exclusionStatus,
      }),
      readAcquisitionCoverageProgress(),
    ]);

    const completedPages = [...new Set([
      ...APOLLO_PROBE.initialCompletedPages,
      ...progress.completedPages.filter((item) => item >= 1 && item <= APOLLO_PROBE.totalPages),
    ])].sort((a, b) => a - b);
    const partialSpentPages = progress.failedSpentPages
      .filter((item) => item >= 1 && item <= APOLLO_PROBE.totalPages && !completedPages.includes(item))
      .sort((a, b) => a - b);
    const spentPages = new Set([...completedPages, ...partialSpentPages]);
    const dataCoveragePercent = Math.round((completedPages.length / APOLLO_PROBE.totalPages) * 10_000) / 100;
    const spendCoveragePercent = Math.round((spentPages.size / APOLLO_PROBE.totalPages) * 10_000) / 100;

    const facetByCountry = new Map((data.countries || []).map((row) => [row.country, row]));
    const countryRows = ACQUISITION_COVERAGE_COUNTRIES.map((market) => {
      const row = facetByCountry.get(market);
      return {
        country: market,
        stored: Number(row?.stored || 0),
        eligible: Number(row?.eligible || 0),
        review: Number(row?.review || 0),
        excluded: Number(row?.excluded || 0),
        existingHubSpot: Number(row?.existingHubSpot || 0),
        targetSectors: ACQUISITION_COUNTRY_SECTORS[market].length,
      };
    });

    const filteredTotal = Number(data.pagination?.filteredTotal || data.accounts.length);
    const totalPages = Math.max(1, Math.ceil(filteredTotal / limit));
    const summary = data.summary;
    const stored = Number(summary.total || 0);
    const sizePending = Number(summary.size_pending || 0);

    return NextResponse.json({
      version: "coverage-ledger-v3",
      generatedAt: new Date().toISOString(),
      storage: {
        database: data.database || "postgresql",
        mode: "persistent",
        autoLoad: true,
        sourceOfTruth: "Postgres acquisition ledger + HubSpot dedupe",
        paginated: true,
      },
      scope: {
        countries: ACQUISITION_COVERAGE_COUNTRIES,
        employeeRanges: ACQUISITION_COVERAGE_EMPLOYEE_RANGES,
        sweetPool: "251–5,000 employees",
        enterpriseExtension: "5,001–50,000 employees",
        governmentIncluded: true,
        unknownIndustryPolicy: "In-scope Apollo accounts remain targetable; unmapped sector is metadata, not a hard exclusion.",
        sizePolicy: "Apollo discovery was filtered to 251–50,000 employees. Exact headcount is shown only when returned by the source; missing exact counts are never guessed.",
      },
      probe: {
        ...APOLLO_PROBE,
        completedPages,
        completedPageCount: completedPages.length,
        partialSpentPages,
        spentPageCount: spentPages.size,
        pageCoveragePercent: dataCoveragePercent,
        dataCoveragePercent,
        spendCoveragePercent,
        estimatedAdditionalSearchCreditsToFinish: Math.max(0, APOLLO_PROBE.totalPages - spentPages.size),
        unresolvedCoveragePages: partialSpentPages,
        checkpointUpdatedAt: progress.updatedAt,
      },
      ledger: {
        stored,
        eligible: Number(summary.eligible || 0),
        existingHubSpot: Number(summary.existing_hubspot || 0),
        review: Number(summary.review || 0),
        excluded: Number(summary.excluded || 0),
        sweetPool: Number(summary.sweet_pool || 0),
        enterpriseExtension: Number(summary.enterprise_extension || 0),
        apolloSizeQualified: stored,
        sizePending,
        exactHeadcountKnown: Math.max(0, stored - sizePending),
        domainPending: Number(summary.domain_pending || 0),
        ready: Number(summary.ready || 0),
        needsPeople: Number(summary.needs_people || 0),
        searchOnly: Number(summary.search_only || 0),
        pushed: Number(summary.pushed || 0),
      },
      countries: countryRows,
      pagination: {
        page,
        limit,
        filteredTotal,
        totalPages,
        returned: data.accounts.length,
      },
      accounts: data.accounts,
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Unable to load acquisition coverage status.",
    }, { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } });
  }
}
