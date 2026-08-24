import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { HubSpotApiError, searchAll } from "@/lib/hubspot";
import { normalizeCompanyDomain } from "@/lib/prospecting-company-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().max(220).default(""),
  company: z.string().trim().max(320).default(""),
  linkedinUrl: z.string().trim().max(1500).default(""),
  email: z.string().trim().max(320).default(""),
  emails: z.array(z.string().trim().max(320)).max(20).default([]),
  phone: z.string().trim().max(120).default(""),
  phones: z.array(z.string().trim().max(120)).max(20).default([]),
});

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function workDomain(emails: string[]) {
  const blocked = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|aol|protonmail|proton)\./i;
  for (const email of emails) {
    const domain = email.split("@")[1]?.toLowerCase().trim() || "";
    if (domain && !blocked.test(domain)) return normalizeCompanyDomain(domain);
  }
  return "";
}

async function contactCheck(input: z.infer<typeof schema>) {
  const emails = unique([input.email, ...input.emails]);
  const phones = unique([input.phone, ...input.phones]);
  const props = ["firstname", "lastname", "email", "phone", "mobilephone", "company", "jobtitle", "hubspot_owner_id"];

  for (const email of emails.slice(0, 5)) {
    const matches = await searchAll("contacts", props, [{ propertyName: "email", operator: "EQ", value: email.toLowerCase() }]);
    if (matches[0]) return { inHubSpot: true, id: String(matches[0].id), matchedBy: "email", properties: matches[0].properties };
  }

  if (input.linkedinUrl) {
    try {
      const matches = await searchAll("contacts", [...props, "gtm_linkedin_url"], [{ propertyName: "gtm_linkedin_url", operator: "EQ", value: input.linkedinUrl }]);
      if (matches[0]) return { inHubSpot: true, id: String(matches[0].id), matchedBy: "linkedin", properties: matches[0].properties };
    } catch (error) {
      if (!(error instanceof HubSpotApiError) || ![400, 404].includes(error.status)) throw error;
    }
  }

  for (const phone of phones.slice(0, 3)) {
    const matches = await searchAll("contacts", props, [{ propertyName: "phone", operator: "EQ", value: phone }]);
    if (matches[0]) return { inHubSpot: true, id: String(matches[0].id), matchedBy: "phone", properties: matches[0].properties };
    const mobile = await searchAll("contacts", props, [{ propertyName: "mobilephone", operator: "EQ", value: phone }]);
    if (mobile[0]) return { inHubSpot: true, id: String(mobile[0].id), matchedBy: "mobilephone", properties: mobile[0].properties };
  }

  return { inHubSpot: false, id: "", matchedBy: "", properties: {} as Record<string, unknown> };
}

async function companyCheck(input: z.infer<typeof schema>) {
  const properties = [
    "name", "domain", "account_type", "account_status", "hs_num_open_deals", "search_status",
    "detected_ats", "ats_status", "career_page_url", "hs_lead_status", "hubspot_owner_id",
  ];
  const domain = workDomain(unique([input.email, ...input.emails]));
  let match = null as Awaited<ReturnType<typeof searchAll>>[number] | null;
  let matchedBy = "";

  if (domain) {
    const matches = await searchAll("companies", properties, [{ propertyName: "domain", operator: "EQ", value: domain }]);
    if (matches[0]) { match = matches[0]; matchedBy = "domain"; }
  }

  if (!match && input.company) {
    const matches = await searchAll("companies", properties, [{ propertyName: "name", operator: "EQ", value: input.company }]);
    if (matches[0]) { match = matches[0]; matchedBy = "name"; }
  }

  if (!match) {
    return {
      inHubSpot: false, id: "", matchedBy: "", name: input.company, domain,
      accountType: "", accountStatus: "", openDeals: 0, searchStatus: "", detectedAts: "", atsStatus: "", careerPageUrl: "", leadStatus: "", ownerId: "",
      protected: false, protectedReason: "",
    };
  }

  const p = match.properties;
  const accountType = String(p.account_type || "").trim();
  const accountStatus = String(p.account_status || "").trim();
  const openDeals = Math.max(0, Number(p.hs_num_open_deals || 0) || 0);
  const activeCustomer = accountType === "Retention" && accountStatus === "Active";
  const protectedReason = activeCustomer
    ? "Active Retention customer"
    : openDeals > 0
      ? `${openDeals} open deal${openDeals === 1 ? "" : "s"}`
      : "";

  return {
    inHubSpot: true,
    id: String(match.id),
    matchedBy,
    name: String(p.name || input.company || ""),
    domain: String(p.domain || domain || ""),
    accountType,
    accountStatus,
    openDeals,
    searchStatus: String(p.search_status || ""),
    detectedAts: String(p.detected_ats || ""),
    atsStatus: String(p.ats_status || ""),
    careerPageUrl: String(p.career_page_url || ""),
    leadStatus: String(p.hs_lead_status || ""),
    ownerId: String(p.hubspot_owner_id || ""),
    protected: Boolean(activeCustomer || openDeals > 0),
    protectedReason,
  };
}

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid SignalHire precheck payload." }, { status: 400 });
    const [contact, company] = await Promise.all([
      contactCheck(parsed.data),
      companyCheck(parsed.data),
    ]);
    return NextResponse.json({ contact, company, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SignalHire HubSpot precheck failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "HubSpot precheck failed." }, { status: 500 });
  }
}
