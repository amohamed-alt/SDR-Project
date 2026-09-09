export const DANIEL_OWNER_ID = "37624223";
export const DANIEL_OWNER_NAME = "Daniel Beaini";
export const MARITA_OWNER_ID = "31644369";

export const DANIEL_EVALUFY_START_DATE = "2026-09-13";
export const DANIEL_EVALUFY_END_DATE = "2026-09-30";
export const DANIEL_EVALUFY_DAILY_TARGET = 100;

export type PropertyBag = Record<string, unknown>;

export type EligibilityResult = {
  eligible: boolean;
  reasons: string[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return clean(value).toLowerCase();
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasValue(value: unknown) {
  return clean(value).length > 0;
}

function hasAnyPhone(properties: PropertyBag) {
  return [
    properties.mobilephone,
    properties.phone,
    properties.hs_whatsapp_phone_number,
    properties.whatsapp_phone_number,
    properties.contact_number,
  ].some(hasValue);
}

export function sourceOwnerIsAllowed(ownerId: unknown) {
  const owner = clean(ownerId);
  return !owner || owner === MARITA_OWNER_ID;
}

export function danielEvalufyDueAt(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid due date.");
  return `${date}T09:00:00+03:00`;
}

export function isDanielEvalufyWorkDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (date < DANIEL_EVALUFY_START_DATE || date > DANIEL_EVALUFY_END_DATE) return false;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const weekday = parsed.getUTCDay();
  return weekday !== 5 && weekday !== 6;
}

const COMPANY_ACTIVITY_PROPERTIES = [
  "notes_last_contacted",
  "notes_last_updated",
  "hs_last_sales_activity_timestamp",
  "engagements_last_meeting_booked",
  "hs_last_logged_call_date",
] as const;

export function evaluateDanielCompany(properties: PropertyBag): EligibilityResult {
  const reasons: string[] = [];
  const atsStatus = normalized(properties.ats_status);
  const detectedAts = clean(properties.detected_ats);
  const accountType = normalized(properties.account_type);
  const companyType = normalized(properties.company_type);
  const customerType = normalized(properties.customer_type);
  const leadStatus = normalized(properties.hs_lead_status);
  const accountStatus = normalized(properties.account_status);
  const csm = normalized(properties.csm);
  const csmTeam = normalized(properties.csm_team);

  if (!sourceOwnerIsAllowed(properties.hubspot_owner_id)) reasons.push("company_owned");
  if (!detectedAts || atsStatus !== "detected") reasons.push("ats_not_detected");
  if (detectedAts.toLowerCase() === "direct application form") reasons.push("direct_application_only");

  if (COMPANY_ACTIVITY_PROPERTIES.some((property) => hasValue(properties[property]))) {
    reasons.push("company_has_activity");
  }

  if (numberValue(properties.num_associated_deals) > 0 || numberValue(properties.hs_num_open_deals) > 0) {
    reasons.push("company_has_deal");
  }

  if (accountType === "retention" || customerType.includes("retention")) reasons.push("retention");
  if (csm || csmTeam) reasons.push("csm_owned");
  if (/job\s*seeker/.test(companyType)) reasons.push("job_seeker");
  if (/unqualified/.test(leadStatus)) reasons.push("unqualified");
  if (accountStatus === "active" || accountStatus === "churned") reasons.push("existing_account");

  return { eligible: reasons.length === 0, reasons };
}

export function evaluateDanielContact(
  properties: PropertyBag,
  options: { requireMobile?: boolean } = {},
): EligibilityResult {
  const reasons: string[] = [];
  const requirePhone = options.requireMobile !== false;
  const leadStatus = normalized(properties.hs_lead_status);
  const lifecycle = normalized(properties.lifecyclestage);

  if (!sourceOwnerIsAllowed(properties.hubspot_owner_id)) reasons.push("contact_owned");
  if (requirePhone && !hasAnyPhone(properties)) reasons.push("phone_missing");
  if (hasValue(properties.csm_owner)) reasons.push("csm_owned");
  if (hasValue(properties.notes_last_contacted) || hasValue(properties.hs_last_sales_activity_timestamp)) {
    reasons.push("contact_has_activity");
  }
  if (/unqualified/.test(leadStatus)) reasons.push("unqualified");
  if (lifecycle === "customer") reasons.push("existing_customer");

  return { eligible: reasons.length === 0, reasons };
}

export const DANIEL_COMPANY_PROPERTIES = [
  "name",
  "domain",
  "hubspot_owner_id",
  "notes_last_contacted",
  "notes_last_updated",
  "hs_last_sales_activity_timestamp",
  "engagements_last_meeting_booked",
  "hs_last_logged_call_date",
  "num_associated_deals",
  "hs_num_open_deals",
  "account_type",
  "account_status",
  "customer_type",
  "company_type",
  "hs_lead_status",
  "csm",
  "csm_team",
  "detected_ats",
  "ats_status",
  "ats_confidence",
  "career_page_url",
] as const;

export const DANIEL_CONTACT_PROPERTIES = [
  "firstname",
  "lastname",
  "email",
  "phone",
  "mobilephone",
  "hs_whatsapp_phone_number",
  "whatsapp_phone_number",
  "contact_number",
  "hubspot_owner_id",
  "csm_owner",
  "notes_last_contacted",
  "hs_last_sales_activity_timestamp",
  "hs_lead_status",
  "lifecyclestage",
  "gtm_linkedin_url",
] as const;
