import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getMaritaExtensiveAccountScope } from "@/lib/marita-account-scope";
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
    if (!result.whyNow || !result.openingLine || !result.outreachAngle || result.discoveryQuestions.length !== 3) return null;
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
    scope: "Marita open Extensive-Lighter accounts in approved markets only",
    ...status,
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-site AI requests are not allowed." }, { status: 403 });
    if (process.env.DEMO_MODE === "true") return NextResponse.json({ error: "AI account briefs are disabled in DEMO_MODE." }, { status: 503 });

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid account brief request", details: parsed.error.flatten() }, { status: 400 });

    const scope = await getMaritaExtensiveAccountScope();
    const company = scope.companies.find((item) => String(item.companyId) === parsed.data.companyId);
    if (!company) return NextResponse.json({ error: "Company is outside the active Marita Extensive-Lighter intelligence scope." }, { status: 404 });

    const account = scoreTalenteraAccount(company);
    if (parsed.data.mode === "deep" && !["A", "B"].includes(account.tier)) {
      return NextResponse.json({ error: "Deep mode is reserved for Tier A/B accounts to control cost." }, { status: 400 });
    }

    const evidence = {
      company: account.name,
      country: account.country,
      marketTier: account.market.tier,
      domain: account.domain,
      tier: account.tier,
      score: account.score,
      fitScore: account.fitScore,
      intentScore: account.intentScore,
      intentLevel: account.intentLevel,
      hiringVelocity: account.hiringVelocity,
      activeJobs: company.activeJobs || 0,
      newJobs7d: company.newJobs7d || 0,
      newJobs30d: company.newJobs30d || 0,
      employeeCount: company.employeeCount || 0,
      industry: company.industry || "",
      taskCount: company.taskCount,
      contactCount: company.contactCount,
      ats: account.competitorMotion.currentSystem,
      atsStatus: company.atsStatus,
      atsConfidence: company.atsConfidence,
      atsOpportunity: account.atsOpportunity,
      primaryPersona: account.personas.primary,
      secondaryPersona: account.personas.secondary,
      languageRoute: account.languageRoute,
      deterministicAngle: account.recommendedAngle,
      deterministicReasonToReachOut: company.reasonToReachOut,
      strongestSignals: account.signals.slice(0, 5).map((signal) => ({ label: signal.label, evidence: signal.evidence })),
      topLocations: (company.topLocations || []).slice(0, 6),
      topDepartments: (company.topDepartments || []).slice(0, 6),
      activeJobTitles: (company.jobs || []).slice(0, 10).map((job) => job.title),
      knownRisks: account.risks.slice(0, 5),
    };

    const system = [
      "You are the Talentera SDR account-brief assistant.",
      "Use ONLY the supplied evidence. Never invent pain, budget, technology, headcount, decision makers, intent, job counts, expansion or market facts.",
      "Do not change the recommended primary persona. Treat detected ATS as evidence only when supplied and respect validation risks.",
      "Write for a professional B2B SDR selling Talentera in the approved Middle East / North Africa territory, with South Africa as an English-first expansion experiment.",
      "For Arabic-first routes, use concise natural business Arabic for the opener without slang or exaggerated familiarity. For Morocco, keep the opener neutral and usable in Arabic/French context. For South Africa, use English.",
      "Return ONLY valid JSON with keys: whyNow, openingLine, outreachAngle, discoveryQuestions, validationRisk.",
      "discoveryQuestions must contain exactly 3 short evidence-led questions.",
      "If evidence is weak, say what must be validated instead of fabricating a hook.",
    ].join(" ");

    const user = `Create a concise evidence-backed SDR brief from this account object:\n${JSON.stringify(evidence)}`;
    const fingerprint = JSON.stringify(evidence);
    const completion = await openRouterCompletion({
      cacheKey: `marita-account-brief:v2:${company.companyId}:${fingerprint}`,
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
        marketTier: account.market.tier,
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
