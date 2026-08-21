import { NextRequest, NextResponse } from "next/server";
import { getHiringStore } from "@/lib/hiring-signals";
import { scoreTalenteraPortfolio, type TalenteraAccountTier } from "@/lib/talentera-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TIERS = new Set<TalenteraAccountTier>(["A", "B", "C", "Watch"]);

function parseLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(2000, Math.max(1, Math.round(parsed)));
}

export async function GET(request: NextRequest) {
  const store = await getHiringStore();
  const query = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const country = request.nextUrl.searchParams.get("country")?.trim() ?? "";
  const requestedTier = request.nextUrl.searchParams.get("tier")?.trim() as TalenteraAccountTier | "";
  const tier = requestedTier && ALLOWED_TIERS.has(requestedTier) ? requestedTier : "";
  const minScore = Math.min(100, Math.max(0, Number(request.nextUrl.searchParams.get("minScore") ?? 0) || 0));
  const minIntent = Math.min(100, Math.max(0, Number(request.nextUrl.searchParams.get("minIntent") ?? 0) || 0));
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  const byId = new Map(store.companies.map((company) => [company.companyId, company]));
  const scored = scoreTalenteraPortfolio(store.companies.map((company) => ({
    companyId: company.companyId,
    name: company.name,
    domain: company.domain,
    country: company.country,
    careerPageUrl: company.careerPageUrl,
    ats: company.ats,
    activeJobs: company.activeJobs,
    previousActiveJobs: company.previousActiveJobs,
    newJobs7d: company.newJobs7d,
    newJobs30d: company.newJobs30d,
    closedJobs7d: company.closedJobs7d,
    hiringScore: company.hiringScore,
    topDepartments: company.topDepartments,
    topLocations: company.topLocations,
    jobs: company.jobs
      .filter((job) => job.status === "active")
      .slice(0, 50)
      .map((job) => ({
        title: job.title,
        location: job.location,
        department: job.department,
        postedAt: job.postedAt,
      })),
  })));

  const filtered = scored.filter((account) => {
    if (tier && account.tier !== tier) return false;
    if (country && account.country !== country) return false;
    if (account.score < minScore || account.intentScore < minIntent) return false;
    if (query) {
      const source = byId.get(account.companyId);
      const searchable = [
        account.name,
        account.domain,
        account.country,
        account.competitorMotion.currentSystem,
        account.personas.primary,
        account.recommendedAngle,
        ...(source?.topDepartments ?? []),
        ...(source?.topLocations ?? []),
        ...account.signals.map((signal) => `${signal.label} ${signal.evidence}`),
      ].join(" ").toLowerCase();
      if (!searchable.includes(query)) return false;
    }
    return true;
  }).slice(0, limit);

  const tierCounts = scored.reduce<Record<TalenteraAccountTier, number>>((counts, account) => {
    counts[account.tier] += 1;
    return counts;
  }, { A: 0, B: 0, C: 0, Watch: 0 });

  return NextResponse.json({
    meta: {
      generatedAt: new Date().toISOString(),
      hiringGeneratedAt: store.generatedAt,
      source: "Talentera Hiring Intelligence + deterministic GTM scoring",
      filters: { query, country, tier, minScore, minIntent, limit },
      version: "talentera-gtm-brain-v1",
    },
    summary: {
      totalScored: scored.length,
      returned: filtered.length,
      tierCounts,
      highIntent: scored.filter((account) => account.intentScore >= 65).length,
      highAtsOpportunity: scored.filter((account) => account.atsOpportunityScore >= 60).length,
      taOrHrisSignals: scored.filter((account) => account.signals.some((signal) => signal.key === "ta-team" || signal.key === "hr-systems")).length,
    },
    accounts: filtered.map((account) => {
      const source = byId.get(account.companyId);
      return {
        ...account,
        source: source ? {
          hubspotUrl: source.hubspotUrl,
          careerPageUrl: source.careerPageUrl,
          sourceUrl: source.sourceUrl,
          lastCheckedAt: source.lastCheckedAt,
          lastSuccessfulCheckAt: source.lastSuccessfulCheckAt,
          activeJobs: source.activeJobs,
          newJobs7d: source.newJobs7d,
          newJobs30d: source.newJobs30d,
          hiringStatus: source.hiringStatus,
          trend: source.trend,
          topDepartments: source.topDepartments,
          topLocations: source.topLocations,
        } : null,
      };
    }),
  }, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "X-Talentera-GTM-Brain-Version": "v1",
    },
  });
}
