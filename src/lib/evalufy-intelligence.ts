import {
  getTalenteraMarket,
  type TalenteraAccountTier,
  type TalenteraConfidence,
  type TalenteraJobInput,
  type TalenteraMarket,
} from "./talentera-intelligence.ts";

export type EvalufyAccountInput = {
  companyId?: string;
  name?: string;
  domain?: string;
  country?: string;
  employeeCount?: number;
  industry?: string;
  careerPageUrl?: string;
  ats?: string;
  activeJobs?: number;
  previousActiveJobs?: number;
  newJobs7d?: number;
  newJobs30d?: number;
  hiringScore?: number;
  hrHeadcount?: number;
  topDepartments?: string[];
  topLocations?: string[];
  jobs?: TalenteraJobInput[];
};

export type EvalufySignal = {
  key: string;
  label: string;
  strength: "strong" | "medium" | "supporting";
  evidence: string;
  score: number;
};

export type EvalufyPersonas = {
  primary: string;
  secondary: string;
  economicBuyer: string;
  technicalInfluencer: string;
  reason: string;
};

export type EvalufyAccountIntelligence = {
  companyId: string;
  name: string;
  domain: string;
  country: string;
  market: TalenteraMarket;
  score: number;
  tier: TalenteraAccountTier;
  fitScore: number;
  intentScore: number;
  integrationReadinessScore: number;
  assessmentNeedScore: number;
  complexityScore: number;
  confidence: TalenteraConfidence;
  signals: EvalufySignal[];
  personas: EvalufyPersonas;
  recommendedAngle: string;
  recommendedChannels: string[];
  reasons: string[];
  risks: string[];
  nextActions: string[];
};

const ENTERPRISE_ATS = /\b(workday|oracle|taleo|successfactors|success factors|sap recruiting|icims|avature|smartrecruiters|smart recruiters|eightfold|pageup|cornerstone|phenom|ukg)\b/i;
const MODERN_ATS = /\b(greenhouse|lever|ashby|workable|recruitee|teamtailor|team tailor|zoho recruit|manatal|freshteam|bamboohr|bamboo hr|jobvite)\b/i;
const REGIONAL_ATS = /\b(elevatus|menaitech|jisr|bayzat|kayanhr|people365|peoplestrong|webhr|sniperhire|cazar|akhtaboot)\b/i;
const TALENTERA_ATS = /\btalentera\b/i;
const DIRECT_APPLICATION = /direct application|application form|email application/i;
const HIGH_ASSESSMENT_INDUSTRY = /retail|hospitality|hotel|restaurant|food|fmcg|logistic|transport|aviation|airline|health|hospital|medical|bank|financial|fintech|telecom|technology|software|construction|engineering|manufactur|industrial|education|school|university|college|graduate|outsourc|bpo|contact center|call center/i;
const MEDIUM_ASSESSMENT_INDUSTRY = /insurance|automotive|pharma|consumer|distribution|real estate|energy|oil|gas|mining|professional service|consult/i;
const TA_SIGNAL = /talent acquisition|recruit|recruitment|sourc|staffing|people acquisition|employer brand|assessment|selection/i;
const SYSTEMS_SIGNAL = /hris|hr system|hcm|people system|talent system|recruitment operation|recruiting operation|hr transformation|people technology|hr technology/i;
const EDUCATION_SIGNAL = /education|school|university|college|academy|admission|student/i;

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function weightedAverage(parts: Array<{ score: number | null; weight: number }>) {
  const available = parts.filter((part): part is { score: number; weight: number } =>
    part.score !== null && Number.isFinite(part.score),
  );
  const weight = available.reduce((sum, part) => sum + part.weight, 0);
  if (!weight) return 0;
  return clamp(available.reduce((sum, part) => sum + part.score * part.weight, 0) / weight);
}

function employeeFit(employeeCount: number) {
  if (!employeeCount) return null;
  if (employeeCount >= 1_000 && employeeCount <= 20_000) return 100;
  if (employeeCount > 20_000) return 94;
  if (employeeCount >= 500) return 92;
  if (employeeCount >= 200) return 78;
  if (employeeCount >= 100) return 58;
  return 30;
}

function industryAssessmentFit(industry: string) {
  if (!industry) return null;
  if (HIGH_ASSESSMENT_INDUSTRY.test(industry)) return 100;
  if (MEDIUM_ASSESSMENT_INDUSTRY.test(industry)) return 76;
  return 56;
}

function hiringVolume(activeJobs: number, newJobs30d: number, newJobs7d: number) {
  let score = activeJobs >= 60 ? 100
    : activeJobs >= 35 ? 94
      : activeJobs >= 20 ? 84
        : activeJobs >= 10 ? 72
          : activeJobs >= 5 ? 58
            : activeJobs > 0 ? 38 : 0;
  if (newJobs30d >= 25) score += 10;
  else if (newJobs30d >= 10) score += 6;
  else if (newJobs30d >= 4) score += 3;
  if (newJobs7d >= 10) score += 7;
  else if (newJobs7d >= 4) score += 4;
  return clamp(score);
}

function sourceText(input: EvalufyAccountInput) {
  return [
    input.industry,
    ...(input.topDepartments ?? []),
    ...(input.jobs ?? []).map((job) => `${job.title ?? ""} ${job.department ?? ""}`),
  ].join(" ");
}

function integrationReadiness(ats: string) {
  const value = clean(ats, 300);
  if (!value) return 52;
  if (DIRECT_APPLICATION.test(value)) return 44;
  if (TALENTERA_ATS.test(value)) return 96;
  if (ENTERPRISE_ATS.test(value)) return 100;
  if (MODERN_ATS.test(value)) return 94;
  if (REGIONAL_ATS.test(value)) return 90;
  return 82;
}

function complexityScore(input: EvalufyAccountInput, hasTaSignal: boolean, hasSystemsSignal: boolean) {
  const activeJobs = numberOrZero(input.activeJobs);
  const locations = new Set((input.topLocations ?? []).map((value) => clean(value, 180)).filter(Boolean)).size;
  const hrHeadcount = numberOrZero(input.hrHeadcount);
  let score = 24;
  if (activeJobs >= 60) score += 32;
  else if (activeJobs >= 30) score += 25;
  else if (activeJobs >= 15) score += 18;
  else if (activeJobs >= 5) score += 10;
  if (locations >= 5) score += 17;
  else if (locations >= 3) score += 12;
  else if (locations >= 2) score += 7;
  if (hrHeadcount >= 15) score += 15;
  else if (hrHeadcount >= 5) score += 9;
  if (hasTaSignal) score += 12;
  if (hasSystemsSignal) score += 10;
  return clamp(score);
}

function confidence(input: EvalufyAccountInput): TalenteraConfidence {
  let evidence = 0;
  if (clean(input.country)) evidence += 1;
  if (clean(input.ats)) evidence += 1;
  if (clean(input.careerPageUrl)) evidence += 1;
  if (numberOrZero(input.activeJobs) > 0 || numberOrZero(input.newJobs30d) > 0) evidence += 1;
  if (numberOrZero(input.employeeCount) > 0) evidence += 1;
  if (clean(input.industry)) evidence += 1;
  if ((input.jobs ?? []).length > 0 || (input.topLocations ?? []).length > 0) evidence += 1;
  if (evidence >= 6) return "high";
  if (evidence >= 3) return "medium";
  return "low";
}

function tier(score: number): TalenteraAccountTier {
  if (score >= 75) return "A";
  if (score >= 58) return "B";
  if (score >= 42) return "C";
  return "Watch";
}

function personas(input: EvalufyAccountInput, education: boolean, hasSystemsSignal: boolean): EvalufyPersonas {
  const activeJobs = numberOrZero(input.activeJobs);
  if (education) {
    return {
      primary: "Head of Talent Acquisition / Assessment",
      secondary: "Recruitment or Admissions Assessment Lead",
      economicBuyer: "HR Director / CHRO",
      technicalInfluencer: "HRIS / IT",
      reason: "The account combines education/admissions-style selection with assessment needs, so start with the owner of selection quality and screening throughput.",
    };
  }
  if (hasSystemsSignal) {
    return {
      primary: "Head / Director of Talent Acquisition",
      secondary: "Recruitment Operations / HR Systems Manager",
      economicBuyer: "CHRO / HR Director",
      technicalInfluencer: "HRIS / IT",
      reason: "The account shows recruiting-systems ownership, making ATS integration and assessment workflow fit part of the buying committee.",
    };
  }
  if (activeJobs >= 20) {
    return {
      primary: "Head / Director of Talent Acquisition",
      secondary: "Recruitment Manager / Talent Assessment Lead",
      economicBuyer: "CHRO / HR Director",
      technicalInfluencer: "HRIS / IT",
      reason: "High hiring volume makes screening capacity, quality and recruiter time the most credible first conversation.",
    };
  }
  return {
    primary: "Talent Acquisition Manager",
    secondary: "Recruitment Manager / HR Director",
    economicBuyer: "HR Director / CHRO",
    technicalInfluencer: "HRIS / IT",
    reason: "The account has assessment potential but limited evidence of mass hiring, so start with the recruiting owner and validate screening pain.",
  };
}

export function scoreEvalufyAccount(input: EvalufyAccountInput): EvalufyAccountIntelligence {
  const name = clean(input.name, 300) || clean(input.domain, 300) || "Unknown company";
  const domain = clean(input.domain, 300);
  const country = clean(input.country, 180);
  const market = getTalenteraMarket(country);
  const activeJobs = numberOrZero(input.activeJobs);
  const newJobs30d = numberOrZero(input.newJobs30d);
  const newJobs7d = numberOrZero(input.newJobs7d);
  const employeeScore = employeeFit(numberOrZero(input.employeeCount));
  const industryScore = industryAssessmentFit(clean(input.industry, 500));
  const hiringScore = hiringVolume(activeJobs, newJobs30d, newJobs7d);
  const text = sourceText(input);
  const hasTaSignal = TA_SIGNAL.test(text);
  const hasSystemsSignal = SYSTEMS_SIGNAL.test(text);
  const education = EDUCATION_SIGNAL.test(text);
  const complexity = complexityScore(input, hasTaSignal, hasSystemsSignal);
  const integration = integrationReadiness(clean(input.ats, 300));
  const assessmentNeed = weightedAverage([
    { score: industryScore, weight: 0.45 },
    { score: hiringScore, weight: 0.35 },
    { score: complexity, weight: 0.20 },
  ]);
  const effectiveHiring = numberOrZero(input.hiringScore)
    ? weightedAverage([
        { score: numberOrZero(input.hiringScore), weight: 0.50 },
        { score: hiringScore, weight: 0.50 },
      ])
    : hiringScore;
  const fitScore = weightedAverage([
    { score: market.score, weight: 0.30 },
    { score: employeeScore, weight: 0.25 },
    { score: industryScore, weight: 0.25 },
    { score: complexity, weight: 0.20 },
  ]);
  const intentScore = weightedAverage([
    { score: effectiveHiring, weight: 0.55 },
    { score: complexity, weight: 0.20 },
    { score: integration, weight: 0.15 },
    { score: hasTaSignal ? 100 : 48, weight: 0.10 },
  ]);

  let score = weightedAverage([
    { score: effectiveHiring, weight: 0.25 },
    { score: assessmentNeed, weight: 0.25 },
    { score: integration, weight: 0.20 },
    { score: market.score, weight: 0.12 },
    { score: employeeScore, weight: 0.10 },
    { score: complexity, weight: 0.08 },
  ]);
  if (!market.eligible) score = Math.min(score, 35);

  const signals: EvalufySignal[] = [];
  if (activeJobs >= 35) signals.push({ key: "screening-volume", label: "High screening volume", strength: "strong", evidence: `${activeJobs} active roles create material candidate-screening load.`, score: 20 });
  else if (activeJobs >= 10) signals.push({ key: "active-hiring", label: "Active hiring", strength: "medium", evidence: `${activeJobs} active roles support a live assessment use case.`, score: 12 });
  if (clean(input.ats)) signals.push({ key: "ats-ready", label: "ATS integration opportunity", strength: integration >= 90 ? "strong" : "medium", evidence: `${clean(input.ats, 180)} is detected, so Evalufy can be positioned as an assessment layer rather than an ATS replacement.`, score: integration >= 90 ? 18 : 10 });
  if (hasTaSignal) signals.push({ key: "ta-team", label: "TA / recruiting signal", strength: "strong", evidence: "Recruiting or Talent Acquisition language is present in the verified hiring evidence.", score: 16 });
  if (education) signals.push({ key: "selection-assessment", label: "Selection / assessment fit", strength: "strong", evidence: "Education, admissions or selection context increases structured-assessment relevance.", score: 18 });
  if (complexity >= 75) signals.push({ key: "recruiting-complexity", label: "Recruiting complexity", strength: "medium", evidence: `Recruiting complexity scores ${complexity}/100 from hiring volume, locations and team/system signals.`, score: 12 });
  if (market.eligible) signals.push({ key: "market-fit", label: `${market.tier} market`, strength: market.tier === "Core" ? "strong" : "supporting", evidence: `${market.canonicalCountry} is an approved outbound market.`, score: market.tier === "Core" ? 12 : 6 });

  const targetPersonas = personas(input, education, hasSystemsSignal);
  const ats = clean(input.ats, 300);
  const recommendedAngle = ats
    ? `Keep the existing ATS in place and position Evalufy as the structured screening and assessment layer that reduces recruiter review load and improves evidence before interviews.`
    : activeJobs >= 20
      ? "Lead with faster, more consistent candidate screening for high-volume hiring; validate the current ATS before discussing integration."
      : "Validate how candidates are screened today, then position structured assessment around recruiter time, consistency and quality of shortlist.";

  const reasons = [
    `${market.canonicalCountry} market fit is ${market.score}/100.`,
    `${activeJobs} active jobs produce a hiring-volume score of ${hiringScore}/100.`,
    `Assessment need is ${assessmentNeed}/100 from industry, hiring volume and recruiting complexity.`,
    `ATS / integration readiness is ${integration}/100${ats ? ` with ${ats} detected` : " with the current ATS still unverified"}.`,
  ];

  const risks: string[] = [];
  if (!market.eligible) risks.push("Country is outside the approved outbound territory; do not spend enrichment credits.");
  if (!activeJobs) risks.push("No active hiring signal is visible, so timing is weak until another trigger appears.");
  if (!ats) risks.push("ATS is not verified yet; do not claim an integration path before confirming the current recruiting stack.");
  if (!input.employeeCount) risks.push("Employee count is missing; company-size fit is excluded rather than guessed.");
  if (!input.industry) risks.push("Industry is missing; assessment-use-case fit is normalized without inventing a sector.");

  const channels = market.canonicalCountry === "Saudi Arabia"
    ? ["Phone", "LinkedIn", "Email", "WhatsApp after a valid business context / consent path"]
    : ["LinkedIn", "Email", "Phone"];

  return {
    companyId: clean(input.companyId, 300),
    name,
    domain,
    country: market.canonicalCountry || country,
    market,
    score,
    tier: tier(score),
    fitScore,
    intentScore,
    integrationReadinessScore: integration,
    assessmentNeedScore: assessmentNeed,
    complexityScore: complexity,
    confidence: confidence(input),
    signals: signals.sort((left, right) => right.score - left.score),
    personas: targetPersonas,
    recommendedAngle,
    recommendedChannels: channels,
    reasons,
    risks,
    nextActions: [
      `Target ${targetPersonas.primary} first; use ${targetPersonas.secondary} as the second contact.`,
      ats ? `Validate whether ${ats} owns the application workflow and where assessment happens today.` : "Confirm the ATS / application workflow before writing integration-specific messaging.",
      score >= 75 ? "Prioritize for decision-maker discovery; spend paid contact credits only after CRM dedupe passes." : "Keep in research/search-only mode until a stronger hiring or assessment signal appears.",
    ],
  };
}
