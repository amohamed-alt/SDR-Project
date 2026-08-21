export type TalenteraAccountTier = "A" | "B" | "C" | "Watch";
export type TalenteraIntentLevel = "Very High" | "High" | "Medium" | "Low";
export type TalenteraOpportunityLevel = "Very High" | "High" | "Medium" | "Low";
export type TalenteraLanguageRoute = "Arabic-first bilingual" | "English-first bilingual" | "English-first";

export interface TalenteraJobSignal {
  title: string;
  location?: string;
  department?: string;
  postedAt?: string;
}

export interface TalenteraAccountInput {
  companyId?: string;
  name: string;
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
  jobs?: TalenteraJobSignal[];
}

export interface TalenteraBuyingSignal {
  key: string;
  label: string;
  strength: "strong" | "medium" | "supporting";
  evidence: string;
  score: number;
}

export interface TalenteraPersonaRecommendation {
  primary: string;
  secondary: string;
  economicBuyer: string;
  technicalInfluencer: string;
  reason: string;
}

export interface TalenteraCompetitorMotion {
  family: "enterprise-suite" | "modern-ats" | "regional-hrtech" | "greenfield" | "unknown";
  currentSystem: string;
  displacementAngle: string;
  discoveryQuestion: string;
}

export interface TalenteraAccountIntelligence {
  companyId: string;
  name: string;
  domain: string;
  country: string;
  score: number;
  tier: TalenteraAccountTier;
  intentScore: number;
  intentLevel: TalenteraIntentLevel;
  fitScore: number;
  complexityScore: number;
  atsOpportunityScore: number;
  atsOpportunity: TalenteraOpportunityLevel;
  confidence: "high" | "medium" | "low";
  hiringVelocity: "Surging" | "Growing" | "Stable" | "Cooling" | "New hiring" | "No active hiring";
  languageRoute: TalenteraLanguageRoute;
  signals: TalenteraBuyingSignal[];
  personas: TalenteraPersonaRecommendation;
  competitorMotion: TalenteraCompetitorMotion;
  recommendedAngle: string;
  recommendedChannels: string[];
  reasons: string[];
  risks: string[];
  nextActions: string[];
}

const ENTERPRISE_ATS = [
  "workday",
  "oracle",
  "taleo",
  "successfactors",
  "sap",
  "icims",
  "avature",
  "smartrecruiters",
  "eightfold",
  "pageup",
  "cornerstone",
  "phenom",
  "ukg",
];

const MODERN_ATS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
  "teamtailor",
  "zoho recruit",
  "manatal",
  "freshteam",
  "bamboohr",
  "jobvite",
];

const REGIONAL_HRTECH = [
  "elevatus",
  "menaitech",
  "jisr",
  "bayzat",
  "kayanhr",
  "people365",
  "peoplestrong",
  "webhr",
  "sniperhire",
  "cazar",
  "akhtaboot",
];

const HR_RECRUITING_PATTERN = /\b(recruit(?:er|ing|ment)?|talent acquisition|talent partner|sourcer|human resources|\bhr\b|people operations|people partner)\b/i;
const HR_SYSTEMS_PATTERN = /\b(hris|hcm|hr systems?|people systems?|hr technology|hr tech|digital hr|hr transformation|people technology|talent systems?|recruitment operations|talent operations)\b/i;
const HIGH_VOLUME_PATTERN = /\b(retail|hospitality|hotel|healthcare|hospital|clinic|logistics|warehouse|construction|manufacturing|restaurant|food|aviation|airline|bank|banking|telecom|outsourcing|bpo|staffing)\b/i;

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function clampScore(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function containsAny(value: string, candidates: string[]) {
  const normalized = value.toLowerCase();
  return candidates.some((candidate) => normalized.includes(candidate));
}

function intentLevel(score: number): TalenteraIntentLevel {
  if (score >= 80) return "Very High";
  if (score >= 65) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function opportunityLevel(score: number): TalenteraOpportunityLevel {
  if (score >= 80) return "Very High";
  if (score >= 60) return "High";
  if (score >= 35) return "Medium";
  return "Low";
}

function tierFromScore(score: number): TalenteraAccountTier {
  if (score >= 78) return "A";
  if (score >= 62) return "B";
  if (score >= 45) return "C";
  return "Watch";
}

function marketScore(country: string) {
  const normalized = country.toLowerCase();
  if (/saudi|ksa|السعود/.test(normalized)) return 100;
  if (/united arab emirates|uae|emirates|الإمارات/.test(normalized)) return 88;
  if (/egypt|مصر/.test(normalized)) return 72;
  if (/qatar|قطر|kuwait|الكويت|bahrain|البحرين|oman|عمان|jordan|الأردن/.test(normalized)) return 75;
  return country ? 55 : 45;
}

function employeeFitScore(employeeCount: number) {
  if (!employeeCount) return null;
  if (employeeCount >= 1000 && employeeCount <= 20_000) return 100;
  if (employeeCount >= 500 && employeeCount < 1000) return 88;
  if (employeeCount > 20_000) return 90;
  if (employeeCount >= 200) return 72;
  if (employeeCount >= 100) return 55;
  return 30;
}

function hiringVolumeScore(activeJobs: number, newJobs30d: number, newJobs7d: number) {
  const active = activeJobs >= 100 ? 100 : activeJobs >= 50 ? 90 : activeJobs >= 25 ? 80 : activeJobs >= 10 ? 65 : activeJobs >= 5 ? 50 : activeJobs > 0 ? 32 : 0;
  const freshness = newJobs30d >= 40 ? 100 : newJobs30d >= 20 ? 85 : newJobs30d >= 10 ? 70 : newJobs30d >= 5 ? 55 : newJobs30d > 0 ? 35 : newJobs7d > 0 ? 30 : 0;
  return clampScore(active * 0.68 + freshness * 0.32);
}

function hiringVelocity(activeJobs: number, previousActiveJobs: number) : TalenteraAccountIntelligence["hiringVelocity"] {
  if (activeJobs === 0) return "No active hiring";
  if (previousActiveJobs === 0) return "New hiring";
  const growth = (activeJobs - previousActiveJobs) / previousActiveJobs;
  if (growth >= 0.3) return "Surging";
  if (growth > 0.05) return "Growing";
  if (growth <= -0.3) return "Cooling";
  return "Stable";
}

function accountJobs(input: TalenteraAccountInput) {
  return input.jobs ?? [];
}

function hasHrRecruitingSignal(input: TalenteraAccountInput) {
  const values = [
    ...(input.topDepartments ?? []),
    ...accountJobs(input).map((job) => `${job.title} ${job.department ?? ""}`),
  ];
  return values.some((value) => HR_RECRUITING_PATTERN.test(value));
}

function hasHrSystemsSignal(input: TalenteraAccountInput) {
  const values = [
    ...(input.topDepartments ?? []),
    ...accountJobs(input).map((job) => `${job.title} ${job.department ?? ""}`),
  ];
  return values.some((value) => HR_SYSTEMS_PATTERN.test(value));
}

function atsFamily(ats: string): TalenteraCompetitorMotion["family"] {
  if (!ats) return "greenfield";
  if (containsAny(ats, ["talentera"])) return "unknown";
  if (containsAny(ats, ENTERPRISE_ATS)) return "enterprise-suite";
  if (containsAny(ats, MODERN_ATS)) return "modern-ats";
  if (containsAny(ats, REGIONAL_HRTECH)) return "regional-hrtech";
  return "unknown";
}

function atsOpportunityScore(ats: string, activeJobs: number, locationCount: number, hrSystemsSignal: boolean) {
  const family = atsFamily(ats);
  let score = family === "enterprise-suite" ? 70 : family === "modern-ats" ? 66 : family === "regional-hrtech" ? 62 : family === "greenfield" ? 78 : 48;
  if (activeJobs >= 50) score += 12;
  else if (activeJobs >= 20) score += 8;
  else if (activeJobs >= 10) score += 4;
  if (locationCount >= 5) score += 8;
  else if (locationCount >= 2) score += 4;
  if (hrSystemsSignal) score += 10;
  return clampScore(score);
}

function recruitmentComplexityScore(input: TalenteraAccountInput, hrSignal: boolean, systemsSignal: boolean) {
  const activeJobs = numberOrZero(input.activeJobs);
  const locationCount = new Set((input.topLocations ?? []).filter(Boolean)).size;
  const departmentCount = new Set((input.topDepartments ?? []).filter(Boolean)).size;
  const volume = activeJobs >= 100 ? 42 : activeJobs >= 50 ? 36 : activeJobs >= 25 ? 30 : activeJobs >= 10 ? 22 : activeJobs >= 5 ? 14 : activeJobs > 0 ? 8 : 0;
  const locations = locationCount >= 8 ? 22 : locationCount >= 5 ? 18 : locationCount >= 3 ? 13 : locationCount >= 2 ? 8 : 0;
  const departments = departmentCount >= 8 ? 14 : departmentCount >= 5 ? 10 : departmentCount >= 3 ? 6 : departmentCount > 0 ? 3 : 0;
  const orgSignals = (hrSignal ? 12 : 0) + (systemsSignal ? 10 : 0);
  return clampScore(volume + locations + departments + orgSignals);
}

function recommendedPersonas(input: TalenteraAccountInput, hrSignal: boolean, systemsSignal: boolean): TalenteraPersonaRecommendation {
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
      displacementAngle: "Treat this as a possible greenfield or low-visibility ATS opportunity. Validate the system first, then lead with eliminating fragmented spreadsheets, inboxes and manual coordination.",
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
  const normalized = country.toLowerCase();
  if (/saudi|ksa|السعود/.test(normalized)) return "Arabic-first bilingual";
  if (/united arab emirates|uae|emirates|الإمارات/.test(normalized)) return "English-first bilingual";
  return "English-first";
}

function recommendedAngle(input: TalenteraAccountInput, systemsSignal: boolean, hrSignal: boolean, atsScore: number) {
  const activeJobs = numberOrZero(input.activeJobs);
  const locations = new Set((input.topLocations ?? []).filter(Boolean)).size;
  const industry = `${input.industry ?? ""} ${(input.topDepartments ?? []).join(" ")}`;
  if (systemsSignal) return "HR technology change window: connect the current systems/operations investment to a stronger end-to-end recruiting workflow and measurable recruiter productivity.";
  if (activeJobs >= 50 || (activeJobs >= 25 && locations >= 3)) return "High-volume, multi-location hiring: reduce manual coordination, standardize approvals and give Talent Acquisition one operating view across the hiring funnel.";
  if (hrSignal) return "Recruitment-team investment: the company is adding recruiting capacity, so lead with recruiter productivity, automation and faster execution rather than generic HR transformation.";
  if (atsScore >= 70) return "ATS modernization: validate the current stack, then position Talentera around MENA fit, Arabic candidate experience and recruiting-specific workflow depth.";
  if (HIGH_VOLUME_PATTERN.test(industry)) return "Operational hiring complexity: focus on repeatable high-volume workflows, visibility and recruiter efficiency across business units or locations.";
  return "Hiring momentum: use the company's active vacancies as a timely reason to discuss how the recruiting process is being managed and where manual work remains.";
}

function confidence(input: TalenteraAccountInput) {
  let evidence = 0;
  if (text(input.country)) evidence += 1;
  if (text(input.ats)) evidence += 1;
  if (text(input.careerPageUrl)) evidence += 1;
  if (numberOrZero(input.activeJobs) > 0 || numberOrZero(input.newJobs30d) > 0) evidence += 1;
  if ((input.jobs ?? []).length > 0) evidence += 1;
  if ((input.topLocations ?? []).length > 0 || (input.topDepartments ?? []).length > 0) evidence += 1;
  if (numberOrZero(input.employeeCount) > 0) evidence += 1;
  if (evidence >= 5) return "high" as const;
  if (evidence >= 3) return "medium" as const;
  return "low" as const;
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
  const fitScore = weightedAverage([
    { score: marketScore(country), weight: 0.32 },
    { score: employeeScore, weight: 0.26 },
    { score: complexityScore, weight: 0.24 },
    { score: atsScore, weight: 0.18 },
  ]);
  const intentScore = weightedAverage([
    { score: hiringScore || null, weight: 0.36 },
    { score: volumeScore, weight: 0.30 },
    { score: velocity === "Surging" ? 100 : velocity === "Growing" ? 78 : velocity === "New hiring" ? 72 : velocity === "Stable" ? 55 : velocity === "Cooling" ? 28 : 0, weight: 0.18 },
    { score: systemsSignal ? 100 : hrSignal ? 78 : 35, weight: 0.16 },
  ]);
  const score = weightedAverage([
    { score: fitScore, weight: 0.52 },
    { score: intentScore, weight: 0.36 },
    { score: atsScore, weight: 0.12 },
  ]);

  const signals: TalenteraBuyingSignal[] = [];
  if (velocity === "Surging") signals.push({ key: "hiring-surge", label: "Hiring surge", strength: "strong", evidence: `Active jobs increased from ${previousActiveJobs} to ${activeJobs}.`, score: 20 });
  else if (velocity === "Growing" || velocity === "New hiring") signals.push({ key: "hiring-growth", label: "Hiring growth", strength: "medium", evidence: `${activeJobs} active jobs with ${newJobs7d} newly detected in the last 7 days.`, score: 12 });
  if (activeJobs >= 50) signals.push({ key: "high-volume", label: "High-volume hiring", strength: "strong", evidence: `${activeJobs} active vacancies create material recruiting-process complexity.`, score: 18 });
  else if (activeJobs >= 15) signals.push({ key: "active-volume", label: "Meaningful hiring volume", strength: "medium", evidence: `${activeJobs} active vacancies indicate an active recruiting operation.`, score: 10 });
  if (systemsSignal) signals.push({ key: "hr-systems", label: "HR systems / transformation signal", strength: "strong", evidence: "Current vacancies or departments include HR systems, HRIS, talent systems or recruitment operations language.", score: 20 });
  if (hrSignal) signals.push({ key: "ta-team", label: "TA / recruiting team investment", strength: systemsSignal ? "medium" : "strong", evidence: "Current vacancies or department data indicate Talent Acquisition / recruiting capacity investment.", score: systemsSignal ? 10 : 16 });
  if (locationCount >= 3) signals.push({ key: "multi-location", label: "Multi-location recruiting", strength: "medium", evidence: `Hiring is distributed across at least ${locationCount} locations.`, score: 10 });
  if (ats) signals.push({ key: "ats-detected", label: "Current ATS detected", strength: "supporting", evidence: `Detected ATS / career technology: ${ats}.`, score: 6 });

  const reasons = [
    `${country || "Unknown market"} market fit contributes ${marketScore(country)}/100 before account-specific evidence.`,
    `${activeJobs} active jobs and ${newJobs30d} new jobs in 30 days produce a hiring-volume score of ${volumeScore}/100.`,
    `Recruitment complexity is ${complexityScore}/100 based on hiring volume, locations, departments and TA/HR-systems signals.`,
    `ATS opportunity is ${atsScore}/100${ats ? ` with ${ats} detected` : " with no ATS confidently detected"}.`,
  ];

  const risks: string[] = [];
  if (!ats) risks.push("ATS is not confidently detected yet; validate the current recruitment system before using a replacement-specific message.");
  if (!activeJobs) risks.push("No active vacancies are visible in the current hiring feed, so timing intent is weak until another trigger appears.");
  if (!input.employeeCount) risks.push("Employee count is missing, so account fit is normalized across the evidence that is available rather than assuming company size.");
  if (!country) risks.push("Country is missing; market priority and language routing should be validated before outreach.");
  if (velocity === "Cooling") risks.push("Hiring is cooling versus the previous snapshot; prioritize only if another strong trigger exists.");

  const personas = recommendedPersonas(input, hrSignal, systemsSignal);
  const competitor = competitorMotion(ats);
  const language = languageRoute(country);
  const channels = country.toLowerCase().includes("saudi")
    ? ["Email", "LinkedIn", "Phone", "WhatsApp after a valid business context / consent path"]
    : ["Email", "LinkedIn", "Phone"];
  const tier = tierFromScore(score);

  const nextActions = [
    ats ? `Validate ${ats} usage and identify whether it owns the full recruitment process or only the career layer.` : "Confirm the current ATS / recruitment system before writing competitor-specific copy.",
    `Enrich ${personas.primary} first, then ${personas.secondary}; add the economic buyer only after the account is qualified.`,
    `${language}: tailor the opener to the strongest observed signal instead of generic personalization.`,
    tier === "A" ? "Route to the highest-priority SDR queue and action within the same working day." : tier === "B" ? "Add to the active outbound queue after persona/contact verification." : "Keep in nurture/watch until a stronger intent signal appears.",
  ];

  return {
    companyId: text(input.companyId),
    name,
    domain,
    country,
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
