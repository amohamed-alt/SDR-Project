export type OutreachLocale = "ar-SA" | "ar-GCC" | "en";

export type CoveragePlan = {
  dailyNewCap: number;
  ready: number;
  today: number;
  tomorrow: number;
  next48Hours: number;
  coverageDays: number;
};

export function isValidBusinessEmail(value: string) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return false;
  if (/^(?:test|example|noreply|no-reply|donotreply|do-not-reply)@/.test(email)) return false;
  return true;
}

export function emailStatusIsSafe(value: string) {
  const status = String(value || "").trim().toLowerCase();
  if (!status) return true;
  return !/(?:invalid|bounce|bounced|unsub|opt.?out|do.?not.?contact|suppressed|spam|failed|bad email|not valid)/i.test(status);
}

export function localeForCountry(country: string): OutreachLocale {
  const value = String(country || "").trim().toLowerCase();
  if (/saudi|ksa|kingdom of saudi/.test(value)) return "ar-SA";
  if (/united arab emirates|\buae\b|dubai|abu dhabi|qatar|kuwait|bahrain|oman/.test(value)) return "ar-GCC";
  return "en";
}

export function industryBucket(industry: string) {
  const value = String(industry || "").trim().toLowerCase();
  if (/hospital|health|medical|clinic|pharma/.test(value)) return "healthcare";
  if (/retail|consumer|supermarket|ecommerce|e-commerce/.test(value)) return "retail";
  if (/logistic|transport|warehouse|supply chain|shipping/.test(value)) return "logistics";
  if (/bank|financial|fintech|insurance|investment/.test(value)) return "financial-services";
  if (/school|university|education|training/.test(value)) return "education";
  if (/hotel|hospitality|restaurant|food|f&b|tourism/.test(value)) return "hospitality";
  if (/construction|engineering|real estate|property/.test(value)) return "construction-real-estate";
  if (/technology|software|saas|information technology|telecom/.test(value)) return "technology";
  return value ? "other" : "unknown";
}

export function personaBucket(title: string) {
  const value = String(title || "").trim().toLowerCase();
  if (/talent acquisition|recruit/.test(value) && /(head|director|vp|vice president|chief)/.test(value)) return "ta-leader";
  if (/talent acquisition|recruit/.test(value)) return "ta";
  if (/chief.*human|chief.*people|\bchro\b|vp.*human|vp.*people|human.*vp|people.*vp/.test(value)) return "hr-executive";
  const leadership = /head|director/.test(value);
  const hrFunction = /\bhr\b|human resources|people/.test(value);
  if (leadership && hrFunction) return "hr-leader";
  if (hrFunction) return "hr";
  return "other";
}

export function calculateCoverage(ready: number, requestedDailyCap: number): CoveragePlan {
  const safeReady = Math.max(0, Math.floor(Number(ready) || 0));
  const dailyNewCap = Math.max(1, Math.floor(Number(requestedDailyCap) || 1));
  const today = Math.min(safeReady, dailyNewCap);
  const tomorrow = Math.min(Math.max(0, safeReady - today), dailyNewCap);
  return {
    dailyNewCap,
    ready: safeReady,
    today,
    tomorrow,
    next48Hours: today + tomorrow,
    coverageDays: Number((safeReady / dailyNewCap).toFixed(1)),
  };
}

export function renderOutreachTemplate(template: string, values: Record<string, string>) {
  return String(template || "").replace(/\{([a-z_]+)\}/gi, (_match, key: string) => String(values[key] || "").trim());
}

export function sanitizeOutreachText(value: string, maxChars: number) {
  return String(value || "")
    .replace(/```(?:json)?/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}
