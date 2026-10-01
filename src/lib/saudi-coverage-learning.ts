export type InventoryProduct = "Talentera" | "Evalufy";
export type CoverageObservation = {
  domain: string; companyId?: string; contactId: string; product: InventoryProduct; industry: string;
  employeeCount: number; title: string; ownerId: string; firstAttemptAt: string;
  connectedAt: string | null; meetingAt: string | null;
};
export type CoverageSnapshot = {
  domain: string; companyId: string; checkedAt: string; contacts: number;
  attempted: boolean; connected: boolean; meetingBooked: boolean; meetingHeld: boolean;
  openTask: boolean; futureTask: boolean; protectedAccount: boolean;
};
export const COVERAGE_WINDOW_DAYS = 30;
export const MIN_LEARNING_COMPANIES = 20;
export const INVENTORY_SDR_IDS = ["31644369", "37624223"] as const;

export function employeeBand(count: number) {
  if (!Number.isFinite(count) || count <= 0) return "Unknown";
  if (count < 200) return "Below 200";
  if (count < 250) return "200–249";
  if (count <= 1000) return "250–1,000";
  if (count <= 5000) return "1,001–5,000";
  return "5,001+";
}

export function personaFamily(title: string) {
  if (/admission|enrol|registrar|student recruitment|examination|قبول|تسجيل/i.test(title)) return "Admissions / examinations";
  if (/assessment|selection|تقييم/i.test(title)) return "Assessment / selection";
  if (/talent acquisition|recruit|استقطاب|توظيف/i.test(title)) return "Talent acquisition";
  if (/hris|hr systems|people systems|hr tech/i.test(title)) return "HR systems";
  if (/human resources|\bhr\b|people|chro|موارد بشرية/i.test(title)) return "HR leadership";
  return "Other / unknown";
}

export function productPersonas(product: InventoryProduct, industry: string, employeeCount = 0) {
  if (product === "Evalufy" && /education|university|college|school|academy|training|تعليم|جامعة|أكاديم/i.test(industry)) {
    return { primary: "Admissions / Assessment Manager", secondary: "Examinations / Enrollment / Registrar", reason: "Education assessment and admissions use case" };
  }
  if (product === "Evalufy") return { primary: "Assessment / Talent Acquisition Manager", secondary: "Recruitment / Selection / HR Director", reason: "Hiring assessment and candidate selection use case" };
  return { primary: employeeCount > 1000 ? "Head / Director of Talent Acquisition" : "Talent Acquisition / Recruitment Manager", secondary: "HR Director / HR Systems Manager", reason: "Recruitment workflow and ATS use case" };
}

export function suggestProduct(industry: string, sourceText: string): InventoryProduct {
  return /\b(university|college|academy|higher education|vocational|certification|examinations)\b|جامعة|أكاديمية/i.test(`${industry} ${sourceText}`) ? "Evalufy" : "Talentera";
}

function time(value: string | null) { return value ? Date.parse(value) : NaN; }
export function outcomeWithinWindow(first: string, outcome: string | null) {
  const start = time(first), end = time(outcome);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= start + COVERAGE_WINDOW_DAYS * 86_400_000;
}

// One independent company vote per product/segment. Untouched and immature
// contacts are never negative labels. This is observational ranking, not causality.
export function learnCoverage(observations: CoverageObservation[], now = Date.now()) {
  const mature = observations.filter((o) => Number.isFinite(time(o.firstAttemptAt)) && time(o.firstAttemptAt) <= now - COVERAGE_WINDOW_DAYS * 86_400_000 && personaFamily(o.title) !== "Other / unknown");
  const groups = new Map<string, Map<string, { connected: boolean; meeting: boolean }>>();
  const dimensions = ["persona", "industry", "size"] as const;
  for (const o of mature) {
    for (const dimension of dimensions) {
      const value = dimension === "persona" ? personaFamily(o.title) : dimension === "size" ? employeeBand(o.employeeCount) : o.industry.trim().toLowerCase();
      if (!value || /^(unknown|target industry|below 200)$/i.test(value)) continue;
      const key = JSON.stringify([o.product, dimension, value]);
      const companies = groups.get(key) || new Map();
      const companyKey = o.companyId || o.domain;
      const previous = companies.get(companyKey);
      companies.set(companyKey, { connected: Boolean(previous?.connected || outcomeWithinWindow(o.firstAttemptAt, o.connectedAt)), meeting: Boolean(previous?.meeting || outcomeWithinWindow(o.firstAttemptAt, o.meetingAt)) });
      groups.set(key, companies);
    }
  }
  const segments = [...groups].map(([key, companies]) => {
    const [product, dimension, value] = JSON.parse(key) as [InventoryProduct, "persona" | "industry" | "size", string];
    const rows = [...companies.values()], n = rows.length;
    const connected = rows.filter((r) => r.connected).length, meetings = rows.filter((r) => r.meeting).length;
    // Beta(1,1) smoothing; Wilson interval exposes uncertainty in held meetings.
    const p = meetings / n, z = 1.96, denominator = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denominator;
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denominator;
    return { product, dimension, value, companies: n, connected, meetings,
      connectionRate: (connected + 1) / (n + 2), meetingRate: (meetings + 1) / (n + 2),
      lower: Math.max(0, center - margin), upper: Math.min(1, center + margin), usable: n >= MIN_LEARNING_COMPANIES };
  }).sort((a, b) => Number(b.usable) - Number(a.usable) || b.lower - a.lower || b.companies - a.companies);
  return { method: "Bayesian segment ranking v1", windowDays: COVERAGE_WINDOW_DAYS, minimumCompanies: MIN_LEARNING_COMPANIES,
    matureContacts: mature.length, matureCompanies: new Set(mature.map((o) => o.companyId || o.domain)).size,
    mode: segments.some((s) => s.usable) ? "learning" : "collecting", segments };
}

export function learnedPriority(baseScore: number, product: InventoryProduct, industry: string, employees: number, title: string, model: ReturnType<typeof learnCoverage>) {
  const matching = model.segments.filter((s) => s.usable && s.product === product && (
    (s.dimension === "persona" && s.value === personaFamily(title)) ||
    (s.dimension === "industry" && s.value === industry.trim().toLowerCase()) ||
    (s.dimension === "size" && s.value === employeeBand(employees))));
  // Historical outcomes can refine, but cannot override eligibility/identity gates.
  const lift = matching.length ? Math.round(matching.reduce((sum, s) => sum + s.lower, 0) / matching.length * 20) : 0;
  return { score: Math.min(100, Math.max(0, baseScore) + lift), lift, supportedBy: matching.map((s) => `${s.dimension}: ${s.value} (${s.companies} companies)`) };
}

export function chooseInventorySdr(loads: Record<string, number>, assigned = "") {
  if (assigned) {
    if (!(INVENTORY_SDR_IDS as readonly string[]).includes(assigned)) throw new Error("Existing assignment belongs to another owner; manual review required");
    return assigned;
  }
  if (INVENTORY_SDR_IDS.some((id) => !Number.isFinite(loads[id]) || loads[id] < 0)) throw new Error("Both SDR workloads must be available before routing");
  return [...INVENTORY_SDR_IDS].sort((a, b) => loads[a] - loads[b] || a.localeCompare(b))[0];
}
