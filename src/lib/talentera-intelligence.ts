export type TalenteraAccountTier = "A" | "B" | "C" | "Watch";
export type TalenteraIntentLevel = "Very High" | "High" | "Medium" | "Low";
export type TalenteraOpportunityLevel = "Very High" | "High" | "Medium" | "Low";
export type TalenteraConfidence = "high" | "medium" | "low";
export type TalenteraHiringVelocity = "Surging" | "Growing" | "New hiring" | "Stable" | "Cooling" | "No signal";
export type TalenteraLanguageRoute = "Arabic-first bilingual" | "English-first bilingual" | "Arabic/French bilingual" | "English-first";
export type TalenteraMarketTier = "Core" | "Expansion A" | "Expansion B" | "Selective" | "Excluded";
export type TalenteraAtsFamily = "enterprise-suite" | "modern-ats" | "regional-hrtech" | "greenfield" | "unknown";

export type TalenteraJobInput = {
  title?: string;
  location?: string;
  department?: string;
  postedAt?: string;
};

export type TalenteraAccountInput = {
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
  closedJobs7d?: number;
  hiringScore?: number;
  topDepartments?: string[];
  topLocations?: string[];
  jobs?: TalenteraJobInput[];
};

export type TalenteraMarket = {
  canonicalCountry: string;
  tier: TalenteraMarketTier;
  score: number;
  eligible: boolean;
};

export type TalenteraBuyingSignal = {
  key: string;
  label: string;
  strength: "strong" | "medium" | "supporting";
  evidence: string;
  score: number;
};

export type TalenteraPersonas = {
  primary: string;
  secondary: string;
  economicBuyer: string;
  technicalInfluencer: string;
  reason: string;
};

export type TalenteraCompetitorMotion = {
  family: TalenteraAtsFamily;
  currentSystem: string;
  displacementAngle: string;
  discoveryQuestion: string;
};

export type TalenteraAccountIntelligence = {
  companyId: string;
  name: string;
  domain: string;
  country: string;
  market: TalenteraMarket;
  score: number;
  tier: TalenteraAccountTier;
  intentScore: number;
  intentLevel: TalenteraIntentLevel;
  fitScore: number;
  complexityScore: number;
  atsOpportunityScore: number;
  atsOpportunity: TalenteraOpportunityLevel;
  confidence: TalenteraConfidence;
  hiringVelocity: TalenteraHiringVelocity;
  languageRoute: TalenteraLanguageRoute;
  signals: TalenteraBuyingSignal[];
  personas: TalenteraPersonas;
  competitorMotion: TalenteraCompetitorMotion;
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
const HIGH_VOLUME_PATTERN = /health|hospital|medical|retail|hospitality|hotel|restaurant|food|fmcg|logistic|transport|aviation|airline|construction|engineering|manufactur|industrial|education|school|university|bank|financial|fintech|telecom|technology|software|staffing|recruit|outsourc|bpo|real estate|energy|oil|gas|mining/i;
const MEDIUM_FIT_PATTERN = /insurance|automotive|professional service|consult|media|entertainment|pharma|consumer|distribution/i;
const HR_RECRUITING_PATTERN = /talent acquisition|recruit|recruitment|sourc|staffing|people acquisition|employer brand/i;
const HR_SYSTEMS_PATTERN = /hris|hr system|hcm|people system|talent system|recruitment operation|recruiting operation|hr transformation|people technology|hr technology/i;

function clean(value: unknown, max = 2_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function text(value: unknown) {
  return clean(value, 600);
}

function numberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function countryMatches(country: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(country));
}

export function getTalenteraMarket(rawCountry: string): TalenteraMarket {
  const country = clean(rawCountry, 180).toLowerCase();
  if (countryMatches(country, [/saudi arabia|\bsaudi\b|\bksa\b|السعود/])) return { canonicalCountry: "Saudi Arabia", tier: "Core", score: 100, eligible: true };
  if (countryMatches(country, [/united arab emirates|\buae\b|\bemirates\b|الإمارات/])) return { canonicalCountry: "United Arab Emirates", tier: "Core", score: 94, eligible: true };
  if (countryMatches(country, [/\begypt\b|مصر/])) return { canonicalCountry: "Egypt", tier: "Expansion A", score: 88, eligible: true };
  if (countryMatches(country, [/\bmorocco\b|\bmaroc\b|المغرب/])) return { canonicalCountry: "Morocco", tier: "Expansion A", score: 84, eligible: true };
  if (countryMatches(country, [/\biraq\b|العراق/])) return { canonicalCountry: "Iraq", tier: "Expansion A", score: 82, eligible: true };
  if (countryMatches(country, [/south africa|\bza\b/])) return { canonicalCountry: "South Africa", tier: "Expansion A", score: 86, eligible: true };
  if (countryMatches(country, [/\bqatar\b|قطر/])) return { canonicalCountry: "Qatar", tier: "Expansion B", score: 76, eligible: true };
  if (countryMatches(country, [/\bkuwait\b|الكويت/])) return { canonicalCountry: "Kuwait", tier: "Expansion B", score: 72, eligible: true };
  if (countryMatches(country, [/\bjordan\b|الأردن|الاردن/])) return { canonicalCountry: "Jordan", tier: "Expansion B", score: 70, eligible: true };
  if (countryMatches(country, [/\boman\b|سلطنة عمان/])) return { canonicalCountry: "Oman", tier: "Selective", score: 58, eligible: true };
  if (countryMatches(country, [/\bbahrain\b|البحرين/])) return { canonicalCountry: "Bahrain", tier: "Selective", score: 56, eligible: true };
  return { canonicalCountry: text(rawCountry) || "Unknown", tier: "Excluded", score: country ? 20 : 10, eligible: false };
}

function marketScore(country: string) {
  return getTalenteraMarket(country).score;
}

function employeeFitScore(employeeCount: number) {
  if (!employeeCount) return null;
  if (employeeCount >= 1_000 && employeeCount <= 20_000) return 100;
  if (employeeCount > 20_000) return 92;
  if (employeeCount >= 500) return 90;
  if (employeeCount >= 200) return 74;
  if (employeeCount >= 100) return 55;
  return 28;
}

function industryFitScore(industry: string) {
  const value = text(industry);
  if (!value) return null;
  if (HIGH_VOLUME_PATTERN.test(value)) return 100;
  if (MEDIUM_FIT_PATTERN.test(value)) return 76;
  return 55;
}

function atsFamily(ats: string): TalenteraAtsFamily {
  const value = text(ats);
  if (!value) return "greenfield";
  if (ENTERPRISE_ATS.test(value)) return "enterprise-suite";
  if (MODERN_ATS.test(value)) return "modern-ats";
  if (REGIONAL_ATS.test(value)) return "regional-hrtech";
  return "unknown";
}

function hasHrRecruitingSignal(input: TalenteraAccountInput) {
  const source = [
    ...(input.topDepartments ?? []),
    ...(input.jobs ?? []).map((job) => `${job.title ?? ""} ${job.department ?? ""}`),
  ].join(" ");
  return HR_RECRUITING_PATTERN.test(source);
}

function hasHrSystemsSignal(input: TalenteraAccountInput) {
  const source = [
    ...(input.topDepartments ?? []),
    ...(input.jobs ?? []).map((job) => `${job.title ?? ""} ${job.department ?? ""}`),
  ].join(" ");
  return HR_SYSTEMS_PATTERN.test(source);
}

function hiringVelocity(activeJobs: number, previousActiveJobs: number): TalenteraHiringVelocity {
  if (!activeJobs && !previousActiveJobs) return "No signal";
  if (activeJobs > 0 && !previousActiveJobs) return "New hiring";
  if (previousActiveJobs > 0) {
    const change = (activeJobs - previousActiveJobs) / previousActiveJobs;
    if (change >= 0.45 && activeJobs >= 10) return "Surging";
    if (change >= 0.15) return "Growing";
    if (change <= -0.2) return "Cooling";
  }
  return "Stable";
}

function hiringVolumeScore(activeJobs: number, newJobs30d: number, newJobs7d: number) {
  let score = activeJobs >= 50 ? 100 : activeJobs >= 30 ? 92 : activeJobs >= 15 ? 78 : activeJobs >= 7 ? 62 : activeJobs >= 3 ? 44 : activeJobs > 0 ? 28 : 0;
  if (newJobs30d >= 25) score += 12;
  else if (newJobs30d >= 10) score += 8;
  else if (newJobs30d >= 4) score += 4;
  if (newJobs7d >= 10) score += 8;
  else if (newJobs7d >= 4) score += 5;
  return clampScore(score);
}

function recruitmentComplexityScore(input: TalenteraAccountInput, hrSignal: boolean, systemsSignal: boolean) {
  const activeJobs = numberOrZero(input.activeJobs);
  const locationCount = new Set((input.topLocations ?? []).map(text).filter(Boolean)).size;
  let score = 28;
  if (activeJobs >= 50) score += 30;
  else if (activeJobs >= 25) score += 24;
  else if (activeJobs >= 10) score += 16;
  else if (activeJobs >= 3) score += 9;
  if (locationCount >= 5) score += 18;
  else if (locationCount >= 3) score += 13;
  else if (locationCount >= 2) score += 7;
  if (hrSignal) score += 13;
  if (systemsSignal) score += 18;
  return clampScore(score);
}

function atsOpportunityScore(ats: string, activeJobs: number, locations: number, systemsSignal: boolean) {
  if (TALENTERA_ATS.test(ats)) return 5;
  const family = atsFamily(ats);
  let score = family === "greenfield"
    ? 94
    : family === "regional-hrtech"
      ? 78
      : family === "modern-ats"
        ? 68
        : family === "enterprise-suite"
          ? 42
          : 56;

  if (activeJobs >= 50) score += family === "enterprise-suite" ? 15 : 8;
  else if (activeJobs >= 20) score += family === "enterprise-suite" ? 10 : 5;
  if (locations >= 3) score += family === "enterprise-suite" ? 9 : 5;
  if (systemsSignal) score += family === "enterprise-suite" ? 14 : 7;
  return clampScore(score);
}

function tierFromScore(score: number): TalenteraAccountTier {
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "Watch";
}

function intentLevel(score: number): TalenteraIntentLevel {
  if (score >= 80) return "Very High";
  if (score >= 65) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function opportunityLevel(score: number): TalenteraOpportunityLevel {
  if (score >= 85) return "Very High";
  if (score >= 70) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function recommendedPersonas(input: TalenteraAccountInput, hrSignal: boolean, systemsSignal: boolean): TalenteraPersonas {
  const activeJobs = numberOrZero(input.activeJobs);
  const locations = new Set((input.topLocations ?? []).filter(Boolean)).size;
  if (systemsSignal) {
    return {
      primary: "HRIS / HR Systems Manager",
      secondary: "Head / Director of Talent Acquisition",
      economicBuyer: "CHRO / VP Human Resources",
      technicalInfluencer: "IT / Enterprise Applications",
      reason: "The account is showing an HR systems or recruitment-operations signal, so the buying committee likely includes HR technology ownership alongside Talent Acquisition.",
    };
  }
  if (hrSignal || activeJobs >= 25 || locations >= 3) {
    return {
      primary: "Head / Director of Talent Acquisition",
      secondary: "Recruitment Manager / Talent Operations",
      economicBuyer: "CHRO / HR Director",
      technicalInfluencer: "HRIS / IT",
      reason: "The account has enough hiring volume or recruitment-team activity to justify starting with the owner of recruiting outcomes rather than a generic HR contact.",
    };
  }
  return {
    primary: "Talent Acquisition Manager",
    secondary: "HR Director",
    economicBuyer: "CHRO / HR Director",
    technicalInfluencer: "HRIS / IT",
    reason: "The available signal is real but not yet complex enough to require an enterprise buying-committee motion on the first touch.",
  };
}

function competitorMotion(ats: string): TalenteraCompetitorMotion {
  const currentSystem = ats || "No ATS confidently detected";
  if (TALENTERA_ATS.test(ats)) {
    return {
      family: "unknown",
      currentSystem,
      displacementAngle: "Do not prospect this account as an ATS replacement. Validate whether the record is an existing Talentera customer or an old/incorrect technology signal.",
      discoveryQuestion: "Is Talentera currently the active recruitment platform for this organization?",
    };
  }
  const family = atsFamily(ats);
  if (family === "enterprise-suite") {
    return {
      family,
      currentSystem,
      displacementAngle: "Lead with MENA recruiting localization, recruiter usability, workflow fit and implementation agility. Do not attack the suite; uncover where recruiting teams work around it.",
      discoveryQuestion: "Where does the recruiting team still rely on manual steps or workarounds despite the current enterprise HCM/ATS?",
    };
  }
  if (family === "modern-ats") {
    return {
      family,
      currentSystem,
      displacementAngle: "Position around enterprise recruiting depth, multi-location governance, MENA requirements, Arabic candidate experience and complex approvals/integrations.",
      discoveryQuestion: "As hiring scales across teams or locations, which workflows are becoming hard to standardize in the current ATS?",
    };
  }
  if (family === "regional-hrtech") {
    return {
      family,
      currentSystem,
      displacementAngle: "Differentiate on recruitment specialization, enterprise TA workflows, automation, reporting and candidate experience while keeping the conversation locally relevant.",
      discoveryQuestion: "Is the current HR platform meeting the Talent Acquisition team's recruiting-specific workflow and reporting needs, or mainly the broader HR use case?",
    };
  }
  if (family === "greenfield") {
    return {
      family,
      currentSystem,
      displacementAngle: "Treat this as a greenfield candidate, not a confirmed no-ATS account. Validate the system first, then lead with eliminating fragmented spreadsheets, inboxes and manual coordination if confirmed.",
      discoveryQuestion: "What system currently owns the recruitment process from requisition through offer, and where does the team still work manually?",
    };
  }
  return {
    family,
    currentSystem,
    displacementAngle: "Validate the actual ATS and ownership before choosing a displacement message. Use hiring growth as the opening signal, not an unsupported competitor claim.",
    discoveryQuestion: "Which ATS or recruitment platform is the team using today, and what would you most want to improve about the current process?",
  };
}

function languageRoute(country: string): TalenteraLanguageRoute {
  const market = getTalenteraMarket(country).canonicalCountry;
  if (["Saudi Arabia", "Egypt", "Iraq", "Jordan", "Kuwait"].includes(market)) return "Arabic-first bilingual";
  if (market === "Morocco") return "Arabic/French bilingual";
  if (["United Arab Emirates", "Qatar", "Oman", "Bahrain"].includes(market)) return "English-first bilingual";
  return "English-first";
}

function recommendedAngle(input: TalenteraAccountInput, systemsSignal: boolean, hrSignal: boolean, atsScore: number) {
  const activeJobs = numberOrZero(input.activeJobs);
  const locations = new Set((input.topLocations ?? []).filter(Boolean)).size;
  const industry = `${input.industry ?? ""} ${(input.topDepartments ?? []).join(" ")}`;
  if (TALENTERA_ATS.test(text(input.ats))) return "Validate account status before outreach; the current evidence indicates Talentera may already be present.";
  if (systemsSignal) return "HR technology change window: connect the current systems/operations investment to a stronger end-to-end recruiting workflow and measurable recruiter productivity.";
  if (activeJobs >= 50 || (activeJobs >= 25 && locations >= 3)) return "High-volume, multi-location hiring: reduce manual coordination, standardize approvals and give Talent Acquisition one operating view across the hiring funnel.";
  if (hrSignal) return "Recruitment-team investment: the company is adding recruiting capacity, so lead with recruiter productivity, automation and faster execution rather than generic HR transformation.";
  if (atsScore >= 80) return "ATS modernization / greenfield opportunity: validate the current stack, then position Talentera around MENA fit, Arabic candidate experience and recruiting-specific workflow depth.";
  if (HIGH_VOLUME_PATTERN.test(industry)) return "Operational hiring complexity: focus on repeatable high-volume workflows, visibility and recruiter efficiency across business units or locations.";
  return "Hiring/process fit: validate the current recruitment workflow and use only verified hiring or technology evidence as the reason to engage.";
}

function confidence(input: TalenteraAccountInput): TalenteraConfidence {
  let evidence = 0;
  if (text(input.country)) evidence += 1;
  if (text(input.ats)) evidence += 1;
  if (text(input.careerPageUrl)) evidence += 1;
  if (numberOrZero(input.activeJobs) > 0 || numberOrZero(input.newJobs30d) > 0) evidence += 1;
  if ((input.jobs ?? []).length > 0) evidence += 1;
  if ((input.topLocations ?? []).length > 0 || (input.topDepartments ?? []).length > 0) evidence += 1;
  if (numberOrZero(input.employeeCount) > 0) evidence += 1;
  if (text(input.industry)) evidence += 1;
  if (evidence >= 6) return "high";
  if (evidence >= 3) return "medium";
  return "low";
}

function weightedAverage(parts: Array<{ score: number | null; weight: number }>) {
  const available = parts.filter((part): part is { score: number; weight: number } => part.score !== null && Number.isFinite(part.score));
  const weight = available.reduce((sum, part) => sum + part.weight, 0);
  if (!weight) return 0;
  return clampScore(available.reduce((sum, part) => sum + part.score * part.weight, 0) / weight);
}

export function scoreTalenteraAccount(input: TalenteraAccountInput): TalenteraAccountIntelligence {
  const name = text(input.name) || text(input.domain) || "Unknown company";
  const domain = text(input.domain);
  const country = text(input.country);
  const market = getTalenteraMarket(country);
  const ats = text(input.ats);
  const activeJobs = numberOrZero(input.activeJobs);
  const previousActiveJobs = numberOrZero(input.previousActiveJobs);
  const newJobs7d = numberOrZero(input.newJobs7d);
  const newJobs30d = numberOrZero(input.newJobs30d);
  const hiringScore = numberOrZero(input.hiringScore);
  const locationCount = new Set((input.topLocations ?? []).filter(Boolean)).size;
  const hrSignal = hasHrRecruitingSignal(input);
  const systemsSignal = hasHrSystemsSignal(input);
  const velocity = hiringVelocity(activeJobs, previousActiveJobs);
  const volumeScore = hiringVolumeScore(activeJobs, newJobs30d, newJobs7d);
  const complexityScore = recruitmentComplexityScore(input, hrSignal, systemsSignal);
  const atsScore = atsOpportunityScore(ats, activeJobs, locationCount, systemsSignal);
  const employeeScore = employeeFitScore(numberOrZero(input.employeeCount));
  const industryScore = industryFitScore(text(input.industry));
  const effectiveHiringScore = hiringScore ? weightedAverage([{ score: hiringScore, weight: 0.55 }, { score: volumeScore, weight: 0.45 }]) : volumeScore;

  const fitScore = weightedAverage([
    { score: market.score, weight: 0.35 },
    { score: employeeScore, weight: 0.30 },
    { score: industryScore, weight: 0.15 },
    { score: complexityScore, weight: 0.20 },
  ]);

  const velocityScore = velocity === "Surging" ? 100 : velocity === "Growing" ? 80 : velocity === "New hiring" ? 72 : velocity === "Stable" ? 55 : velocity === "Cooling" ? 28 : 0;
  const intentScore = weightedAverage([
    { score: effectiveHiringScore, weight: 0.65 },
    { score: velocityScore, weight: 0.20 },
    { score: systemsSignal ? 100 : hrSignal ? 78 : 35, weight: 0.15 },
  ]);

  let score = weightedAverage([
    { score: effectiveHiringScore, weight: 0.25 },
    { score: atsScore, weight: 0.25 },
    { score: market.score, weight: 0.15 },
    { score: employeeScore, weight: 0.15 },
    { score: industryScore, weight: 0.10 },
    { score: complexityScore, weight: 0.10 },
  ]);

  if (!market.eligible) score = Math.min(score, 35);
  if (TALENTERA_ATS.test(ats)) score = Math.min(score, 20);

  const signals: TalenteraBuyingSignal[] = [];
  if (velocity === "Surging") signals.push({ key: "hiring-surge", label: "Hiring surge", strength: "strong", evidence: `Active jobs increased from ${previousActiveJobs} to ${activeJobs}.`, score: 20 });
  else if (velocity === "Growing" || velocity === "New hiring") signals.push({ key: "hiring-growth", label: "Hiring growth", strength: "medium", evidence: `${activeJobs} active jobs with ${newJobs7d} newly detected in the last 7 days.`, score: 12 });
  if (activeJobs >= 50) signals.push({ key: "high-volume", label: "High-volume hiring", strength: "strong", evidence: `${activeJobs} active vacancies create material recruiting-process complexity.`, score: 18 });
  else if (activeJobs >= 15) signals.push({ key: "active-volume", label: "Meaningful hiring volume", strength: "medium", evidence: `${activeJobs} active vacancies indicate an active recruiting operation.`, score: 10 });
  if (systemsSignal) signals.push({ key: "hr-systems", label: "HR systems / transformation signal", strength: "strong", evidence: "Current vacancies or departments include HR systems, HRIS, talent systems or recruitment operations language.", score: 20 });
  if (hrSignal) signals.push({ key: "ta-team", label: "TA / recruiting team investment", strength: systemsSignal ? "medium" : "strong", evidence: "Current vacancies or department data indicate Talent Acquisition / recruiting capacity investment.", score: systemsSignal ? 10 : 16 });
  if (locationCount >= 3) signals.push({ key: "multi-location", label: "Multi-location recruiting", strength: "medium", evidence: `Hiring is distributed across at least ${locationCount} locations.`, score: 10 });
  if (ats) signals.push({ key: "ats-detected", label: "Current ATS detected", strength: "supporting", evidence: `Detected ATS / career technology: ${ats}.`, score: 6 });
  if (market.eligible) signals.push({ key: "market-fit", label: `${market.tier} market`, strength: market.tier === "Core" ? "strong" : market.tier === "Expansion A" ? "medium" : "supporting", evidence: `${market.canonicalCountry} is in the approved Talentera prospecting territory.`, score: market.tier === "Core" ? 12 : market.tier === "Expansion A" ? 9 : 5 });

  const reasons = [
    `${market.canonicalCountry} is classified as ${market.tier} with market fit ${market.score}/100.`,
    `${activeJobs} active jobs and ${newJobs30d} new jobs in 30 days produce a hiring-volume score of ${volumeScore}/100.`,
    `Recruitment complexity is ${complexityScore}/100 based on hiring volume, locations and TA/HR-systems signals.`,
    `ATS opportunity is ${atsScore}/100${ats ? ` with ${ats} detected` : " with no ATS confidently detected"}.`,
  ];

  const risks: string[] = [];
  if (!market.eligible) risks.push("Country is outside the currently approved Talentera outbound territory; do not spend enrichment credits on this account.");
  if (TALENTERA_ATS.test(ats)) risks.push("Talentera is detected in the current stack; verify customer/account status before any replacement outreach.");
  if (!ats) risks.push("ATS is not confidently detected yet; treat this as a greenfield candidate, not proof that the company has no ATS.");
  if (!activeJobs) risks.push("No active vacancies are visible in the current hiring feed, so timing intent is weak until another trigger appears.");
  if (!input.employeeCount) risks.push("Employee count is missing, so account fit is normalized across the evidence that is available rather than assuming company size.");
  if (!input.industry) risks.push("Industry is missing, so the industry component is excluded instead of guessed.");
  if (!country) risks.push("Country is missing; market priority and language routing must be validated before outreach.");
  if (velocity === "Cooling") risks.push("Hiring is cooling versus the previous snapshot; prioritize only if another strong trigger exists.");

  const personas = recommendedPersonas(input, hrSignal, systemsSignal);
  const competitor = competitorMotion(ats);
  const language = languageRoute(country);
  const channels = market.canonicalCountry === "Saudi Arabia"
    ? ["Phone", "Email", "LinkedIn", "WhatsApp after a valid business context / consent path"]
    : ["Email", "LinkedIn", "Phone"];
  const tier = tierFromScore(score);

  const nextActions = [
    ats ? `Validate ${ats} usage and identify whether it owns the full recruitment process or only the career layer.` : "Confirm the current ATS / recruitment system before writing competitor-specific copy.",
    `Enrich ${personas.primary} first, then ${personas.secondary}; add the economic buyer only after the account is qualified.`,
    `${language}: tailor the opener to the strongest verified signal instead of generic personalization.`,
    tier === "A" ? "Route to Marita's highest-priority queue and action within the same working day." : tier === "B" ? "Keep in the active outbound queue; use paid contact enrichment only if contact data is missing." : "Do not spend paid enrichment credits until a stronger verified signal appears.",
  ];

  return {
    companyId: text(input.companyId),
    name,
    domain,
    country: market.canonicalCountry || country,
    market,
    score,
    tier,
    intentScore,
    intentLevel: intentLevel(intentScore),
    fitScore,
    complexityScore,
    atsOpportunityScore: atsScore,
    atsOpportunity: opportunityLevel(atsScore),
    confidence: confidence(input),
    hiringVelocity: velocity,
    languageRoute: language,
    signals: signals.sort((a, b) => b.score - a.score),
    personas,
    competitorMotion: competitor,
    recommendedAngle: recommendedAngle(input, systemsSignal, hrSignal, atsScore),
    recommendedChannels: channels,
    reasons,
    risks,
    nextActions,
  };
}

export function scoreTalenteraPortfolio(accounts: TalenteraAccountInput[]) {
  return accounts
    .map(scoreTalenteraAccount)
    .sort((a, b) => b.score - a.score || b.intentScore - a.intentScore || a.name.localeCompare(b.name));
}
