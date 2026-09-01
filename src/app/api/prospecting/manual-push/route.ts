import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as pushProspect } from "@/app/api/prospecting/push/route";
import { acquisitionOwners } from "@/lib/acquisition-routing";
import { isThirdPartyCompanyDomain } from "@/lib/company-domain-safety";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const triggerLabels = {
  job_change: "Changed job / joined recently",
  promoted: "Recently promoted",
  linkedin_active: "Active on LinkedIn",
  frequent_posts: "Posts frequently on LinkedIn",
  hiring_now: "Company is hiring now",
  hr_growth: "HR / recruiting team is growing",
  ats_change: "ATS / recruitment process change signal",
  senior_buyer: "Senior HR decision-maker",
} as const;

type TriggerKey = keyof typeof triggerLabels;
type RawProspect = Record<string, unknown>;

const schema = z.object({
  taskOwnerId: z.string().trim().min(1).max(80),
  triggers: z.array(z.enum([
    "job_change",
    "promoted",
    "linkedin_active",
    "frequent_posts",
    "hiring_now",
    "hr_growth",
    "ats_change",
    "senior_buyer",
  ])).max(8).default([]),
  prospect: z.record(z.string(), z.unknown()),
});

function text(value: unknown, max = 2_000) {
  return String(value ?? "").replace(/\u200b/g, "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

function list(value: unknown, max = 30) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  return value.map((item) => text(item, 500)).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, max);
}

function first(values: string[]) {
  return values.find(Boolean) || "";
}

function strictCompanyDomain(raw: unknown, companyName: string) {
  const value = text(raw, 500);
  if (!value || isThirdPartyCompanyDomain(value, companyName)) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    const labels = host.split(".");
    if (!host || host.length > 253 || labels.length < 2) return "";
    if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/i.test(label) || label.startsWith("-") || label.endsWith("-"))) return "";
    return host;
  } catch {
    return "";
  }
}

function strictCompanyWebsite(raw: unknown, companyName: string) {
  const value = text(raw, 1_500);
  if (!value || isThirdPartyCompanyDomain(value, companyName)) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^https?:$/.test(url.protocol) || !strictCompanyDomain(url.hostname, companyName)) return "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function sanitizedCompanyIdentity(prospect: RawProspect) {
  const companyName = text(prospect.company, 300);
  const rawWebsite = text(prospect.companyWebsite, 1_500);
  const website = strictCompanyWebsite(rawWebsite, companyName);
  const explicitDomain = strictCompanyDomain(prospect.companyDomain, companyName);
  const domain = explicitDomain || strictCompanyDomain(website || rawWebsite, companyName);
  return { website, domain };
}

function hubspotToken() {
  const token = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return token;
}

function contactData(prospect: RawProspect) {
  const businessEmails = list(prospect.businessEmails);
  const personalEmails = list(prospect.personalEmails);
  const emails = list(prospect.emails);
  const mobilePhones = list(prospect.mobilePhones);
  const workPhones = list(prospect.workPhones);
  const otherPhones = list(prospect.otherPhones);
  const phones = list(prospect.phones);
  const primaryEmail = first([...businessEmails, ...personalEmails, text(prospect.email, 320), ...emails]);
  const mobile = first([...mobilePhones, text(prospect.phone, 120), ...phones]);
  const work = first(workPhones);
  const secondary = first([...workPhones, ...otherPhones, ...phones.filter((phone) => phone !== mobile)]);
  return { businessEmails, personalEmails, emails, mobilePhones, workPhones, otherPhones, phones, primaryEmail, mobile, work, secondary };
}

function compactParagraph(value: unknown, max: number) {
  const source = text(value, max * 3).replace(/\n+/g, " ");
  if (source.length <= max) return source;
  return `${source.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function buildTaskBrief(prospect: RawProspect, ownerName: string, triggers: TriggerKey[]) {
  const name = text(prospect.fullName, 250) || "Unknown contact";
  const title = text(prospect.title, 250);
  const company = text(prospect.company, 250);
  const location = text(prospect.location, 500);
  const score = Number(prospect.score);
  const scoreText = Number.isFinite(score) ? `${Math.max(0, Math.min(100, score))}/100` : "—";
  const data = contactData(prospect);
  const skills = list(prospect.skills, 12);
  const education = list(prospect.education, 2);
  const reasons = Array.isArray(prospect.scoreReasons)
    ? prospect.scoreReasons.map((item) => {
      if (!item || typeof item !== "object") return "";
      const row = item as Record<string, unknown>;
      const label = text(row.label, 250);
      return label ? `• ${label}` : "";
    }).filter(Boolean).slice(0, 5)
    : [];
  const whyNow = triggers.map((key) => `• ${triggerLabels[key]}`);
  const companySize = text(prospect.companySize, 100);
  const companyHq = text(prospect.companyHeadquarter, 300);
  const domain = text(prospect.companyDomain, 300);
  const website = text(prospect.companyWebsite, 1_000);
  const headline = compactParagraph(prospect.headline, 320);
  const summary = compactParagraph(prospect.summary, 480);
  const currentRoleSummary = compactParagraph(prospect.currentRoleSummary, 420);
  const previous = [text(prospect.previousTitle, 250), text(prospect.previousCompany, 250)].filter(Boolean).join(" · ");
  const previousDates = [text(prospect.previousStarted, 80), text(prospect.previousEnded, 80)].filter(Boolean).join(" → ");
  const source = text(prospect.source, 200);
  const linkedin = text(prospect.linkedinUrl, 1_000);
  const signalHire = text(prospect.signalHireProfileUrl, 1_000);
  const years = text(prospect.yearsExperience, 50);
  const language = text(prospect.spokenLanguage, 200);
  const recruitment = [text(prospect.recruitmentStage, 120), text(prospect.recruitmentStatus, 120)].filter(Boolean).join(" · ");

  const lines: string[] = [
    "📞 SIGNALHIRE CALL BRIEF",
    `Priority: HIGH · Lead score: ${scoreText}`,
    "",
    "👤 CONTACT",
    name,
    title || "Role not provided",
    company || "Company not provided",
  ];
  if (location) lines.push(`Location: ${location}`);
  if (linkedin) lines.push(`LinkedIn: ${linkedin}`);
  if (signalHire) lines.push(`SignalHire: ${signalHire}`);

  lines.push("", "📱 CONTACT DETAILS");
  if (data.mobilePhones.length) data.mobilePhones.forEach((value) => lines.push(`Mobile: ${value}`));
  if (data.workPhones.length) data.workPhones.forEach((value) => lines.push(`Work: ${value}`));
  if (data.otherPhones.length) data.otherPhones.forEach((value) => lines.push(`Other: ${value}`));
  if (!data.mobilePhones.length && !data.workPhones.length && !data.otherPhones.length) data.phones.forEach((value) => lines.push(`Phone: ${value}`));
  if (!data.phones.length && !data.mobilePhones.length && !data.workPhones.length && !data.otherPhones.length) lines.push("Phone: not available");
  data.businessEmails.forEach((value) => lines.push(`Work email: ${value}`));
  data.personalEmails.forEach((value) => lines.push(`Personal email: ${value}`));
  if (!data.businessEmails.length && !data.personalEmails.length && data.primaryEmail) lines.push(`Email: ${data.primaryEmail}`);
  if (!data.primaryEmail) lines.push("Email: not available");

  if (headline || years || currentRoleSummary || summary || skills.length || previous || education.length || language || recruitment) {
    lines.push("", "🧠 PROFILE SNAPSHOT");
    if (years) lines.push(`Experience: ${years} years`);
    if (headline) lines.push(`Headline: ${headline}`);
    if (currentRoleSummary) lines.push(`Current role: ${currentRoleSummary}`);
    else if (summary) lines.push(`Profile: ${summary}`);
    if (skills.length) lines.push(`Skills: ${skills.join(" · ")}`);
    if (previous) lines.push(`Previous: ${previous}${previousDates ? ` · ${previousDates}` : ""}`);
    education.forEach((value) => lines.push(`Education: ${value}`));
    if (language) lines.push(`Languages: ${language}`);
    if (recruitment) lines.push(`SignalHire recruitment: ${recruitment}`);
  }

  lines.push("", "🏢 COMPANY");
  lines.push(company || "Company not provided");
  if (companySize) lines.push(`Size: ${companySize} employees`);
  if (companyHq) lines.push(`HQ: ${companyHq}`);
  if (domain) lines.push(`Domain: ${domain}`);
  if (website) lines.push(`Website: ${website}`);

  lines.push("", "🎯 WHY THIS LEAD");
  if (whyNow.length) lines.push(...whyNow);
  if (reasons.length) lines.push(...reasons);
  if (!whyNow.length && !reasons.length) lines.push("• New SignalHire prospect with usable contact data");
  if (source) lines.push(`Source: ${source}`);
  lines.push(`Task owner: ${ownerName}`);

  lines.push(
    "",
    "✅ CALL PLAN",
    "1. Confirm their role and involvement in hiring/recruitment.",
    "2. Ask current hiring volume and how recruitment is managed today.",
    "3. Qualify ATS/process, bottlenecks, recruiter workload and time-to-hire.",
    "4. If there is a fit, book the next meeting/demo.",
  );

  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n").slice(0, 12_000);
}

async function syncSignalHireContactProperties(contactId: string, prospect: RawProspect) {
  if (!contactId) return [] as string[];
  const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=email,phone,mobilephone`, {
    headers: { Authorization: `Bearer ${hubspotToken()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Could not read HubSpot contact (${response.status}).`);
  const current = await response.json() as { properties?: Record<string, string | null | undefined> };
  const existing = current.properties || {};
  const data = contactData(prospect);
  const properties: Record<string, string> = {};

  if (data.primaryEmail && !text(existing.email, 320)) properties.email = data.primaryEmail.toLowerCase();
  if (data.mobile && !text(existing.mobilephone, 120)) properties.mobilephone = data.mobile;

  const currentPhone = text(existing.phone, 120);
  if (data.work && (!currentPhone || currentPhone === data.mobile)) properties.phone = data.work;
  else if (!currentPhone && data.secondary) properties.phone = data.secondary;
  else if (!currentPhone && data.mobile) properties.phone = data.mobile;

  const updated = Object.keys(properties);
  if (!updated.length) return updated;
  const patch = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${hubspotToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!patch.ok) throw new Error(`Could not enrich HubSpot contact (${patch.status}): ${(await patch.text()).slice(0, 300)}`);
  return updated;
}

async function patchTask(taskId: string, ownerId: string, ownerName: string, triggers: TriggerKey[], prospect: RawProspect) {
  const fullName = text(prospect.fullName, 250) || "SignalHire prospect";
  const company = text(prospect.company, 250);
  const score = Number(prospect.score);
  const scoreText = Number.isFinite(score) ? ` · ${Math.max(0, Math.min(100, score))}/100` : "";
  const subject = `📞 SignalHire | ${fullName}${company ? ` | ${company}` : ""}${scoreText}`.slice(0, 240);
  const body = buildTaskBrief(prospect, ownerName, triggers);
  const patch = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${hubspotToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: {
      hubspot_owner_id: ownerId,
      hs_task_subject: subject,
      hs_task_body: body,
      hs_task_priority: "HIGH",
      hs_task_type: contactData(prospect).phones.length ? "CALL" : "EMAIL",
    } }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!patch.ok) throw new Error(`Could not update HubSpot task (${patch.status}): ${(await patch.text()).slice(0, 300)}`);
}

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access is required." }, { status: 401 });
  }

  try {
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid manual push payload.", details: parsed.error.flatten() }, { status: 400 });

    const owner = acquisitionOwners().find((item) => item.id === parsed.data.taskOwnerId);
    if (!owner) return NextResponse.json({ error: "Select an enabled Acquisition task owner." }, { status: 400 });

    const labels = parsed.data.triggers.map((key) => triggerLabels[key]);
    const companyIdentity = sanitizedCompanyIdentity(parsed.data.prospect);
    const prospect = {
      ...parsed.data.prospect,
      companyWebsite: companyIdentity.website,
      companyDomain: companyIdentity.domain,
      priority: "high",
      recentSignal: labels.length
        ? { type: "manual_trigger", label: labels.join(" · ") }
        : { type: "signalhire_csv", label: "Imported from SignalHire CSV" },
    };

    const forwarded = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prospect),
    });
    const baseResponse = await pushProspect(forwarded);
    const payload = await baseResponse.json() as Record<string, unknown> & { taskId?: string; contactId?: string; duplicate?: boolean; error?: string };
    if (!baseResponse.ok) return NextResponse.json(payload, { status: baseResponse.status });

    const contactFieldsUpdated = payload.contactId
      ? await syncSignalHireContactProperties(payload.contactId, prospect)
      : [];
    if (payload.taskId) {
      await patchTask(payload.taskId, owner.id, owner.name, parsed.data.triggers, prospect);
    }

    return NextResponse.json({
      ...payload,
      signalHireContactFieldsUpdated: contactFieldsUpdated,
      taskOwnerId: owner.id,
      taskOwnerName: owner.name,
      triggerLabels: labels,
      taskOwnerOverridden: Boolean(payload.taskId),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Manual SignalHire push failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manual push failed." }, { status: 500 });
  }
}
