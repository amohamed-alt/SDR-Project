import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as pushProspect } from "@/app/api/prospecting/push/route";
import { acquisitionOwners } from "@/lib/acquisition-routing";
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

const LINKEDIN_SALES_NAV_SOURCE = "LinkedIn Sales Navigator";
const SIGNALHIRE_ENRICHMENT = "SignalHire";
const RESEARCH_PROVENANCE = `${LINKEDIN_SALES_NAV_SOURCE}; ${SIGNALHIRE_ENRICHMENT}`;

type TriggerKey = keyof typeof triggerLabels;

const excludedTaskTriggers = new Set<TriggerKey>(["hiring_now", "hr_growth", "ats_change"]);

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

function hubspotToken() {
  const token = String(process.env.HUBSPOT_PRIVATE_APP_TOKEN || "").trim();
  if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not configured.");
  return token;
}

function placeholder(value: string) {
  return /^(?:-|--|—|n\/?a|na|none|null|undefined|unknown|not available)$/i.test(value.trim());
}

function safeDomain(value: unknown) {
  const raw = String(value || "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0].replace(/^www\./, "").replace(/\.$/, "");
  if (!raw || placeholder(raw) || raw.length > 253 || !raw.includes(".")) return "";
  const labels = raw.split(".");
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return "";
  const tld = labels.at(-1) || "";
  return /[a-z]/i.test(tld) && tld.length >= 2 ? raw : "";
}

function safeWebsite(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw || placeholder(raw)) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const domain = safeDomain(url.hostname);
    if (!domain || !/^https?:$/.test(url.protocol)) return "";
    url.protocol = "https:";
    url.hostname = domain;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function simplifyTaskBody(body: string, ownerName: string, triggers: TriggerKey[]) {
  let next = body.replace(/\r\n/g, "\n");

  next = next.replace(
    /👥 \*\*(?:Assigned SDR|Assigned Task Owner)\*\*\n[^\n]+/,
    `👥 **Assigned Task Owner**\n${ownerName}`,
  );

  next = next.replace(
    /🎯 \*\*Source\*\*\n[^\n]+(?:\n\n🔎 \*\*Enrichment\*\*\n[^\n]+)?/,
    `🎯 **Source**\n${LINKEDIN_SALES_NAV_SOURCE}\n\n🔎 **Enrichment**\n${SIGNALHIRE_ENRICHMENT}`,
  );

  next = next.replace(/📌 \*\*Why Now \/ Trigger\*\*\n(?:•[^\n]*\n)*\n?/g, "");
  next = next.replace(/📈 \*\*Person Signal\*\*\n[^\n]*\n/g, "");

  next = next
    .split("\n")
    .filter((line) => !/^(?:Career Page|ATS \/ Application|Hiring|Active Jobs|Hiring Score):/i.test(line.trim()))
    .filter((line) => !/^HR \/ Recruiting roles are currently open/i.test(line.trim()))
    .join("\n");

  next = next.replace(/\n?💼 \*\*Sample Open Roles\*\*\n[\s\S]*?(?=\n⭐ \*\*Priority Score\*\*)/g, "\n");

  if (triggers.length) {
    const triggerBlock = [
      "📌 **Why Now / Trigger**",
      ...triggers.map((key) => `• ${triggerLabels[key]}`),
      "",
    ].join("\n");
    next = next.replace(/🏢 \*\*Company Intelligence\*\*/, `${triggerBlock}🏢 **Company Intelligence**`);
  }

  const suggestedAction = triggers.length
    ? "Use the selected trigger as the opening, then qualify current recruitment priorities, process, pain points, and next steps."
    : "Qualify current recruitment priorities, process, pain points, decision process, and next steps.";

  if (/💡 \*\*Suggested Action\*\*/.test(next)) {
    next = next.replace(/💡 \*\*Suggested Action\*\*[\s\S]*$/, `💡 **Suggested Action**\n${suggestedAction}`);
  } else {
    next = `${next.trim()}\n\n💡 **Suggested Action**\n${suggestedAction}`;
  }

  return next.replace(/\n{3,}/g, "\n\n").trim();
}

async function patchTask(taskId: string, ownerId: string, ownerName: string, triggers: TriggerKey[]) {
  const read = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${encodeURIComponent(taskId)}?properties=hs_task_body`, {
    headers: { Authorization: `Bearer ${hubspotToken()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!read.ok) throw new Error(`Could not read HubSpot task (${read.status}).`);
  const current = await read.json() as { properties?: { hs_task_body?: string } };
  const body = simplifyTaskBody(String(current.properties?.hs_task_body || ""), ownerName, triggers);

  const patch = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${hubspotToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { hubspot_owner_id: ownerId, hs_task_body: body } }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!patch.ok) throw new Error(`Could not assign HubSpot task (${patch.status}): ${(await patch.text()).slice(0, 300)}`);
}

async function patchNewContactSource(contactId: string) {
  const patch = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${hubspotToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      properties: {
        lead_source: LINKEDIN_SALES_NAV_SOURCE,
        gtm_contact_research_sources: RESEARCH_PROVENANCE,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!patch.ok) throw new Error(`Could not set contact source (${patch.status}): ${(await patch.text()).slice(0, 300)}`);
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

    const activeTriggers = parsed.data.triggers.filter((key) => !excludedTaskTriggers.has(key));
    const labels = activeTriggers.map((key) => triggerLabels[key]);
    const cleanedWebsite = safeWebsite(parsed.data.prospect.companyWebsite);
    const cleanedDomain = safeDomain(parsed.data.prospect.companyDomain) || (cleanedWebsite ? safeDomain(new URL(cleanedWebsite).hostname) : "");
    const prospect = {
      ...parsed.data.prospect,
      source: LINKEDIN_SALES_NAV_SOURCE,
      companyWebsite: cleanedWebsite,
      companyDomain: cleanedDomain,
      recentSignal: labels.length
        ? { type: "manual_trigger", label: labels.join(" · ") }
        : { type: "", label: "" },
    };

    const forwarded = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prospect),
    });
    const baseResponse = await pushProspect(forwarded);
    const payload = await baseResponse.json() as Record<string, unknown> & {
      taskId?: string;
      duplicate?: boolean;
      error?: string;
      contactId?: string;
      contactCreated?: boolean;
    };
    if (!baseResponse.ok) return NextResponse.json(payload, { status: baseResponse.status });

    if (payload.contactId && payload.contactCreated) {
      await patchNewContactSource(payload.contactId);
    }

    if (payload.taskId) {
      // Keep the existing generated body as the base, then normalize only this
      // SignalHire/Sales Navigator flow into the concise operational task format.
      await patchTask(payload.taskId, owner.id, owner.name, activeTriggers);
    }

    return NextResponse.json({
      ...payload,
      taskOwnerId: owner.id,
      taskOwnerName: owner.name,
      triggerLabels: labels,
      taskOwnerOverridden: Boolean(payload.taskId),
      source: LINKEDIN_SALES_NAV_SOURCE,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Manual SignalHire push failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Manual push failed." }, { status: 500 });
  }
}
