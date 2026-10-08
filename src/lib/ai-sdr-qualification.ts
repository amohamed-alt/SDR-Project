// Zero-credit qualification policy for the ChatGPT/Sales Navigator SDR workspace.
// CRM facts take priority over user-provided research. No ATS is inferred from a blank field.
export type AiLead = {
  name: string;
  title: string;
  company: string;
  location: string;
  linkedinUrl: string;
  salesLeadUrl: string;
  companyDomain: string;
  companyCountry: string;
  employeeCount: number | null;
  detectedAts: string;
  atsStatus: "unknown" | "verified_with_ats" | "verified_no_ats";
  atsEvidence: string;
  sector: string;
};

export type AiCrmCheck = {
  contact: { inHubSpot: boolean; id?: string; matchedBy?: string };
  company: {
    inHubSpot: boolean;
    id?: string;
    accountType?: string;
    accountStatus?: string;
    ownerId?: string;
    protected?: boolean;
    protectedReason?: string;
    engagementChecked?: boolean;
    engagementError?: string;
    meetingCount?: number;
    connectedCallCount?: number;
    openDeals?: number;
    detectedAts?: string;
  };
};

export type AiAssessment = {
  status: "blocked" | "review" | "eligible";
  reason: string;
  ownerId: string;
  ownerName: string;
  score: number;
};

export const AI_SDR_BATCH_LIMIT = 30;
export const AI_SDR_MARITA_ID = "31644369";
export const AI_SDR_DANIEL_ID = "37624223";

function clean(value: unknown, max = 300): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanEmployeeCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  const source = clean(value, 40).replace(/,/g, "");
  if (!/^\d{2,7}(?:\+|\s*-\s*\d{2,7})?$/.test(source)) return null;
  const count = Number(source.match(/^\d+/)?.[0]);
  return Number.isSafeInteger(count) ? count : null;
}

export function normalizePersonUrl(value: unknown): string {
  const source = clean(value, 1500);
  if (!source) return "";
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || (host !== "linkedin.com" && host !== "www.linkedin.com") || !/^\/in\/[^/?#]+\/?$/i.test(url.pathname)) return "";
    return "https://www.linkedin.com" + url.pathname.replace(/\/$/, "").toLowerCase();
  } catch { return ""; }
}

export function aiLeadKey(lead: AiLead): string {
  return normalizePersonUrl(lead.linkedinUrl) || [lead.name, lead.company].map(item => item.toLowerCase().trim()).join("::");
}

export function parseAiSdrBatch(source: string): { leads: AiLead[]; rejected: number; truncated: boolean } {
  if (source.length > 140_000) throw new Error("Input is too large. Split your research into smaller batches.");
  const json: unknown = JSON.parse(source);
  const items = Array.isArray(json) ? json : json && typeof json === "object" ? (json as { leads?: unknown }).leads : null;
  if (!Array.isArray(items)) throw new Error('Paste a JSON array or an object containing a "leads" array.');
  const unique = new Set<string>();
  const leads: AiLead[] = [];
  let rejected = 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) { rejected++; continue; }
    const row = item as Record<string, unknown>;
    const lead: AiLead = {
      name: clean(row.name || row.fullName, 220),
      title: clean(row.title || row.jobTitle, 320),
      company: clean(row.company || row.companyName, 320),
      location: clean(row.location, 320),
      linkedinUrl: normalizePersonUrl(row.linkedinUrl || row.linkedin),
      salesLeadUrl: clean(row.salesLeadUrl, 2000),
      companyDomain: clean(row.companyDomain || row.domain, 320).toLowerCase(),
      companyCountry: clean(row.companyCountry || row.country, 100),
      employeeCount: cleanEmployeeCount(row.employeeCount || row.companyEmployees),
      detectedAts: clean(row.detectedAts, 120),
      // AI research is never trusted as ATS confirmation. The operator must verify.
      atsStatus: "unknown",
      atsEvidence: "",
      sector: clean(row.sector || row.companySector, 120),
    };
    const key = aiLeadKey(lead);
    if (!lead.name || !lead.company || !lead.linkedinUrl || unique.has(key)) { rejected++; continue; }
    unique.add(key);
    if (leads.length < AI_SDR_BATCH_LIMIT) leads.push(lead);
  }
  return { leads, rejected, truncated: unique.size > AI_SDR_BATCH_LIMIT };
}

function isSaudiCountry(value: string): boolean {
  return /^(saudi arabia|ksa|kingdom of saudi arabia|السعودية|المملكة العربية السعودية)$/i.test(value.trim());
}

function isDecisionMaker(value: string): boolean {
  const title = value.toLowerCase();
  const functionMatch = /\b(hr|human resources|people|talent|recruitment|recruiting|staffing|assessment|selection|admissions|enrollment|registrar|learning|workforce|organizational development)\b|الموارد البشرية|التوظيف|استقطاب المواهب|التقييم|القبول/.test(title);
  const seniority = /\b(head|director|manager|lead|chief|vp|vice president|partner|officer)\b|مدير|رئيس|مديرة|رئيسة|نائب/.test(title);
  return functionMatch && seniority;
}

function isGovernment(lead: AiLead): boolean {
  return /\b(government|governmental|public sector|ministry|municipality|public authority)\b|حكومي|وزارة|أمانة المنطقة|الهيئة العامة/i.test(lead.company + " " + lead.sector);
}

function trustedCrmAts(value: unknown): boolean {
  const ats = clean(value).toLowerCase();
  return Boolean(ats && !["none", "no ats", "not detected", "unknown", "not found", "n/a", "no", "-"].includes(ats));
}

export function assessAiSdrLead(lead: AiLead, check?: AiCrmCheck): AiAssessment {
  const blocked = (reason: string): AiAssessment => ({ status: "blocked", reason, ownerId: "", ownerName: "", score: 0 });
  const review = (reason: string): AiAssessment => ({ status: "review", reason, ownerId: "", ownerName: "", score: 0 });
  if (!check) return review("Run the free HubSpot precheck first.");
  const company = check.company;
  if (!check.contact || !company) return review("CRM response incomplete. Do not spend credits.");
  if (check.contact.inHubSpot) return blocked("This person already exists in HubSpot.");
  if (String(company.accountType || "").toLowerCase() === "retention") return blocked("Retention account.");
  if (String(company.accountStatus || "").toLowerCase() === "active") return blocked("Existing active customer.");
  if (Number(company.meetingCount || 0) > 0) return blocked("Company already has a meaningful meeting.");
  if (Number(company.connectedCallCount || 0) > 0) return blocked("Connected call exists: preserve the existing SDR follow-up.");
  if (Number(company.openDeals || 0) > 0) return blocked("Open HubSpot deal: leave the account with Sales/RM.");
  if (company.ownerId && ![AI_SDR_MARITA_ID, AI_SDR_DANIEL_ID].includes(String(company.ownerId))) return blocked("Company assigned to another owner: review with RM.");
  if (company.protected) return blocked(company.protectedReason || "HubSpot protected account.");
  if (company.engagementChecked === false) return review(company.engagementError || "Engagement check is incomplete.");
  if (isGovernment(lead)) return blocked("Government/public-sector account is out of scope.");
  if (!normalizePersonUrl(lead.linkedinUrl)) return review("A verified public LinkedIn profile URL is required.");
  if (!company.inHubSpot && !lead.companyDomain) return review("Verify company domain before creating a new company.");
  if (!lead.companyCountry) return review("Verify the company's country. A contact location is not enough.");
  if (!isSaudiCountry(lead.companyCountry)) return blocked("Outside the Saudi company target market.");
  if (lead.employeeCount === null) return review("Verify company headcount (250+).");
  if (lead.employeeCount < 250) return blocked("Company has fewer than 250 verified employees.");
  if (!isDecisionMaker(lead.title)) return review("Verify that this is an HR / Evalufy decision-maker.");
  const hasAts = trustedCrmAts(company.detectedAts);
  if (!hasAts && lead.atsStatus === "unknown") return review("Verify ATS usage before assigning the SDR.");
  if (!hasAts && lead.atsEvidence.trim().length < 6) return review("Add ATS evidence/verification notes before routing.");
  const ownerId = hasAts || lead.atsStatus === "verified_with_ats" ? AI_SDR_DANIEL_ID : AI_SDR_MARITA_ID;
  const ownerName = ownerId === AI_SDR_DANIEL_ID ? "Daniel Beaini" : "Marita Chedid";
  return { status: "eligible", reason: hasAts ? "ATS verified from HubSpot." : "ATS manually reviewed.", ownerId, ownerName, score: 100 };
}
