import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getHiringStore } from "@/lib/hiring-signals";
import { getOpenRouterStatus, openRouterCompletion } from "@/lib/openrouter-low-cost";
import { scoreTalenteraAccount } from "@/lib/talentera-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  companyId: z.string().trim().min(1).max(120),
  mode: z.enum(["fast", "deep"]).default("fast"),
});

type Brief = {
  whyNow: string;
  openingLine: string;
  outreachAngle: string;
  discoveryQuestions: string[];
  validationRisk: string;
};

function clean(value: unknown, max = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseBrief(raw: string): Brief | null {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const questions = Array.isArray(parsed.discoveryQuestions)
      ? parsed.discoveryQuestions.map((item) => clean(item, 240)).filter(Boolean).slice(0, 3)
      : [];
    const result: Brief = {
      whyNow: clean(parsed.whyNow, 420),
      openingLine: clean(parsed.openingLine, 420),
      outreachAngle: clean(parsed.outreachAngle, 420),
      discoveryQuestions: questions,
      validationRisk: clean(parsed.validationRisk, 320),
    };
    if (!result.whyNow || !result.openingLine || !result.outreachAngle) return null;
    return result;
  } catch {
    return null;
  }
}

function sameOrigin(request: NextRequest) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && !["same-origin", "same-site", "none"].includes(secFetchSite)) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.nextUrl.host;
  } catch {
    return false;
  }
}

export async function GET() {
  const status = await getOpenRouterStatus();
  return NextResponse.json({
    ok: true,
    feature: "account-brief",
    ...status,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site AI requests are not allowed." }, { status: 403 });
    if (process.env.DEMO_MODE === "true") return NextResponse.json({ error: "AI account briefs are disabled in DEMO_MODE." }, { status: 503 });

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid account brief request", details: parsed.error.flatten() }, { status: 400 });

    const store = await getHiringStore();
    const company = store.companies.find((item) => item.companyId === parsed.data.companyId);
    if (!company) return NextResponse.json({ error: "Company not found in Hiring Intelligence." }, { status: 404 });

    const account = scoreTalenteraAccount({
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
        .slice(0, 12)
        .map((job) => ({ title: job.title, location: job.location, department: job.department, postedAt: job.postedAt })),
    });

    if (parsed.data.mode === "deep" && !["A", "B"].includes(account.tier)) {
      return NextResponse.json({ error: "Deep mode is reserved for Tier A/B accounts to control cost." }, { status: 400 });
    }

    const evidence = {
      company: account.name,
      country: account.country,
      domain: account.domain,
      tier: account.tier,
      score: account.score,
      fitScore: account.fitScore,
      intentScore: account.intentScore,
      intentLevel: account.intentLevel,
      hiringVelocity: account.hiringVelocity,
      activeJobs: company.activeJobs,
      newJobs7d: company.newJobs7d,
      newJobs30d: company.newJobs30d,
      ats: account.competitorMotion.currentSystem,
      atsOpportunity: account.atsOpportunity,
      primaryPersona: account.personas.primary,
      secondaryPersona: account.personas.secondary,
      languageRoute: account.languageRoute,
      deterministicAngle: account.recommendedAngle,
      strongestSignals: account.signals.slice(0, 4).map((signal) => ({ label: signal.label, evidence: signal.evidence })),
      topLocations: company.topLocations.slice(0, 6),
      topDepartments: company.topDepartments.slice(0, 6),
      activeJobTitles: company.jobs.filter((job) => job.status === "active").slice(0, 10).map((job) => job.title),
      knownRisks: account.risks.slice(0, 4),
    };

    const system = [
      "You are the Talentera SDR account-brief assistant.",
      "Use ONLY the evidence supplied by the system. Never invent pain, budget, technology, headcount, decision makers, or intent.",
      "Do not change the recommended primary persona. Treat detected ATS as evidence only when it is supplied.",
      "Keep the output concise and commercially useful for a B2B SDR in KSA/UAE.",
      "Return ONLY valid JSON with keys: whyNow, openingLine, outreachAngle, discoveryQuestions, validationRisk.",
      "discoveryQuestions must be an array with exactly 3 short questions.",
      "For Saudi Arabia, the opening line may be natural Arabic-first business language; otherwise follow the supplied language route.",
    ].join(" ");

    const user = `Create a short evidence-backed SDR brief from this account object:\n${JSON.stringify(evidence)}`;
    const fingerprint = JSON.stringify(evidence);
    const completion = await openRouterCompletion({
      cacheKey: `account-brief:${company.companyId}:${fingerprint}`,
      system,
      user,
      mode: parsed.data.mode,
      maxOutputTokens: parsed.data.mode === "deep" ? 360 : 220,
      temperature: 0.1,
    });

    const brief = parseBrief(completion.content);
    const status = await getOpenRouterStatus();
    return NextResponse.json({
      account: {
        companyId: account.companyId,
        name: account.name,
        tier: account.tier,
        score: account.score,
        primaryPersona: account.personas.primary,
      },
      brief,
      raw: brief ? undefined : completion.content,
      ai: {
        model: completion.model,
        mode: completion.mode,
        cached: completion.cached,
        usage: completion.usage,
        today: status.today,
        limits: status.limits,
      },
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("AI account brief failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "AI account brief failed." }, { status: 500 });
  }
}
