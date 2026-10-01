export const SAUDI_DAILY_LIMIT = 100;
export const SAUDI_PIPELINE_PREFIX = "pipeline:ats-v2:";
export type InventoryAts = {
  status: "detected" | "no_ats_observed" | "unknown";
  vendor: string; careerUrl: string; evidenceUrl: string; reason: string; checkedAt: string;
};
const VENDORS: [RegExp, string][] = [
  [/myworkdayjobs\.com|workday\.com/i, "Workday"], [/greenhouse\.io/i, "Greenhouse"], [/lever\.co/i, "Lever"],
  [/smartrecruiters\.com/i, "SmartRecruiters"], [/successfactors\.(com|eu)|successfactors\.com\.cn/i, "SAP SuccessFactors"],
  [/oraclecloud\.com/i, "Oracle Recruiting"], [/taleo\.net/i, "Oracle Taleo"], [/icims\.com/i, "iCIMS"],
  [/teamtailor\.com/i, "Teamtailor"], [/recruitee\.com/i, "Recruitee"], [/ashbyhq\.com/i, "Ashby"],
  [/workable\.com/i, "Workable"], [/jobvite\.com/i, "Jobvite"], [/talentera\.com/i, "Talentera"],
  [/elevatus\.io/i, "Elevatus"], [/bamboohr\.com/i, "BambooHR"], [/zohorecruit\.(com|eu)/i, "Zoho Recruit"],
];
export function careerMarkup(html: string, url: string) {
  const links = [...html.matchAll(/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi)].flatMap(m => {
    try { return [new URL(m[1].replace(/&amp;/g, "&"), url).href]; } catch { return []; }
  });
  const careerPage = /career|recruit|jobs|vacanc|join|وظائف|توظيف/i.test(decodeURI(url));
  for (const link of [url, ...links]) {
    if (!careerPage && !/career|recruit|jobs|candidate|talent/i.test(link)) continue;
    const host = new URL(link).hostname;
    const vendor = VENDORS.find(([re]) => new RegExp(`(?:^|\\.)(?:${re.source})$`, "i").test(host));
    if (vendor) return { vendor: vendor[1], applicationUrl: link, direct: false, links };
  }
  const direct = careerPage && ((/<form\b/i.test(html) && /type\s*=\s*["']?file|upload.{0,30}(?:cv|resume)|السيرة الذاتية/i.test(html)) || /mailto:(?:careers?|recruitment|jobs?|hr|talent)[^"'<> ]*@/i.test(html));
  return { vendor: "", applicationUrl: url, direct, links };
}
export function atsProduct(ats: InventoryAts, now = Date.now()) {
  const age = now - Date.parse(ats.checkedAt);
  if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000 || !/^https?:\/\//.test(ats.careerUrl) || !ats.evidenceUrl || !ats.reason) return null;
  if (ats.status === "detected" && ats.vendor && ats.vendor !== "Direct Application Form") return "Evalufy" as const;
  if (ats.status === "no_ats_observed" && !ats.vendor) return "Talentera" as const;
  return null;
}
export function usablePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 && !/^(\d)\1+$/.test(digits);
}
export function recentActivityBoost(value: unknown, now = Date.now()) {
  if (!value || typeof value !== "object") return 0;
  const signal = value as Record<string, unknown>;
  const age = now - Date.parse(String(signal.observedAt || ""));
  return signal.kind === "linkedin_recent_post" && /^https:\/\/(www\.)?linkedin\.com\//.test(String(signal.sourceUrl || "")) && age >= 0 && age <= 30 * 86400000 ? 10 : 0;
}
