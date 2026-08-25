import { NextRequest, NextResponse } from "next/server";
import { getMaritaExtensiveAccountScope, MARITA_EXTENSIVE_SCOPE } from "@/lib/marita-account-scope";
import {
  scoreTalenteraPortfolio,
  type TalenteraAccountTier,
  type TalenteraMarketTier,
} from "@/lib/talentera-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TIERS = new Set<TalenteraAccountTier>(["A", "B", "C", "Watch"]);
const ALLOWED_MARKET_TIERS = new Set<TalenteraMarketTier>(["Core", "Expansion A", "Expansion B", "Selective"]);

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(2_000, Math.max(1, Math.round(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const country = request.nextUrl.searchParams.get("country")?.trim() ?? "";
    const requestedTier = request.nextUrl.searchParams.get("tier")?.trim() as TalenteraAccountTier | "";
    const requestedMarketTier = request.nextUrl.searchParams.get("marketTier")?.trim() as TalenteraMarketTier | "";
    const tier = requestedTier && ALLOWED_TIERS.has(requestedTier) ? requestedTier : "";
    const marketTier = requestedMarketTier && ALLOWED_MARKET_TIERS.has(requestedMarketTier) ? requestedMarketTier : "";
    const minScore = Math.min(100, Math.max(0, Number(request.nextUrl.searchParams.get("minScore") ?? 0) || 0));
    const minIntent = Math.min(100, Math.max(0, Number(request.nextUrl.searchParams.get("minIntent") ?? 0) || 0));
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));
    const force = request.nextUrl.searchParams.get("refresh") === "1";

    const scope = await getMaritaExtensiveAccountScope({ force });
    const sourceById = new Map(scope.companies.map((company) => [String(company.companyId), company]));
    const scored = scoreTalenteraPortfolio(scope.companies);

    const filtered = scored.filter((account) => {
      if (tier && account.tier !== tier) return false;
      if (marketTier && account.market.tier !== marketTier) return false;
      if (country && account.country !== country) return false;
      if (account.score < minScore || account.intentScore < minIntent) return false;
      if (!query) return true;
      const source = sourceById.get(account.companyId);
      const searchable = [
        account.name,
        account.domain,
        account.country,
        account.market.tier,
        account.competitorMotion.currentSystem,
        account.personas.primary,
        account.personas.secondary,
        account.recommendedAngle,
        source?.industry,
        source?.hiringSignal,
        source?.reasonToReachOut,
        ...(source?.topDepartments ?? []),
        ...(source?.topLocations ?? []),
        ...account.signals.map((signal) => `${signal.label} ${signal.evidence}`),
      ].join(" ").toLowerCase();
      return searchable.includes(query);
    }).slice(0, limit);

    const tierCounts = scored.reduce<Record<TalenteraAccountTier, number>>((counts, account) => {
      counts[account.tier] += 1;
      return counts;
    }, { A: 0, B: 0, C: 0, Watch: 0 });

    const marketCounts = scored.reduce<Record<Exclude<TalenteraMarketTier, "Excluded">, number>>((counts, account) => {
      if (account.market.tier !== "Excluded") counts[account.market.tier] += 1;
      return counts;
    }, { Core: 0, "Expansion A": 0, "Expansion B": 0, Selective: 0 });

    return NextResponse.json({
      meta: {
        generatedAt: new Date().toISOString(),
        scopeGeneratedAt: scope.generatedAt,
        source: "Marita open Extensive-Lighter tasks + HubSpot company data + cached Hiring Intelligence + deterministic Talentera scoring",
        scope: {
          ownerId: MARITA_EXTENSIVE_SCOPE.ownerId,
          sourceLabel: MARITA_EXTENSIVE_SCOPE.sourceLabel,
          sourceDetail: MARITA_EXTENSIVE_SCOPE.sourceDetail,
          taskCount: scope.taskCount,
          uniqueCompaniesBeforeMarketFilter: scope.companyCountBeforeMarketFilter,
          approvedMarketCompanies: scope.companies.length,
          paidEnrichment: "off",
        },
        filters: { query, country, tier, marketTier, minScore, minIntent, limit },
        version: "talentera-marita-intelligence-v2",
      },
      summary: {
        totalScored: scored.length,
        returned: filtered.length,
        tierCounts,
        marketCounts,
        highIntent: scored.filter((account) => account.intentScore >= 65).length,
        highAtsOpportunity: scored.filter((account) => account.atsOpportunityScore >= 70).length,
        taOrHrisSignals: scored.filter((account) => account.signals.some((signal) => signal.key === "ta-team" || signal.key === "hr-systems")).length,
        withHiringEvidence: scope.companies.filter((company) => Number(company.activeJobs || 0) > 0 || Number(company.newJobs30d || 0) > 0).length,
      },
      accounts: filtered.map((account) => {
        const source = sourceById.get(account.companyId);
        return {
          ...account,
          source: source ? {
            taskCount: source.taskCount,
            contactCount: source.contactCount,
            hubspotUrl: source.hubspotUrl,
            careerPageUrl: source.careerPageUrl,
            sourceUrl: source.sourceUrl,
            lastCheckedAt: source.sourceLastCheckedAt,
            lastSuccessfulCheckAt: source.sourceLastSuccessfulCheckAt,
            activeJobs: source.activeJobs || 0,
            newJobs7d: source.newJobs7d || 0,
            newJobs30d: source.newJobs30d || 0,
            hiringStatus: source.hiringStatus,
            trend: source.trend,
            topDepartments: source.topDepartments || [],
            topLocations: source.topLocations || [],
            employeeCount: source.employeeCount || 0,
            industry: source.industry || "",
            atsStatus: source.atsStatus,
            atsCategory: source.atsCategory,
            atsConfidence: source.atsConfidence,
            hiringSignal: source.hiringSignal,
            reasonToReachOut: source.reasonToReachOut,
          } : null,
        };
      }),
    }, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Talentera-GTM-Brain-Version": "v2",
      },
    });
  } catch (error) {
    console.error("Account Intelligence failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Account Intelligence failed." }, { status: 500 });
  }
}
