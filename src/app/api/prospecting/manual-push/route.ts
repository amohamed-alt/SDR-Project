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

function strictCompanyDomain(raw: unknown, companyName: string) {
  const value = String(raw || "").trim();
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
  const value = String(raw || "").trim();
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

function sanitizedCompanyIdentity(prospect: Record<string, unknown>) {
  const companyName = String(prospect.company || "").trim();
  const rawWebsite = String(prospect.companyWebsite || "").trim();
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

async function patchTask(taskId: string, ownerId: string, ownerName: string, triggers: TriggerKey[]) {
  const read = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${encodeURIComponent(taskId)}?properties=hs_task_body`, {
    headers: { Authorization: `Bearer ${hubspotToken()}` },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!read.ok) throw new Error(`Could not read HubSpot task (${read.status}).`);
  const current = await read.json() as { properties?: { hs_task_body?: string } };
  let body = String(current.properties?.hs_task_body || "");
  body = body.replace(/👥 \*\*(?:Assigned SDR|Assigned Task Owner)\*\*\n[^\n]+/, `👥 **Assigned Task Owner**\n${ownerName}`);
  body = body.replace(/🔥 \*\*(?:HIGH|MEDIUM|NORMAL) PRIORITY — SALES SIGNAL\*\*/, "🔥 **HIGH PRIORITY — SALES SIGNAL**");
  body = body.replace(/(⭐ \*\*Priority Score\*\*\n\d+\/100 — )(?:HIGH|MEDIUM|NORMAL)/, "$1HIGH");

  const triggerBlockPattern = /📌 \*\*Why Now \/ Trigger\*\*\n(?:•[^\n]*\n)*\n?/;
  body = body.replace(triggerBlockPattern, "");
  if (triggers.length) {
    const triggerBlock = ["📌 **Why Now / Trigger**", ...triggers.map((key) => `• ${triggerLabels[key]}`), ""].join("\n");
    if (/📈 \*\*Person Signal\*\*/.test(body)) {
      body = body.replace(/📈 \*\*Person Signal\*\*\n[^\n]*\n/, `${triggerBlock}📈 **Person Signal**\n${triggers.map((key) => triggerLabels[key]).join(" · ")}\n`);
    } else {
      body = `${triggerBlock}${body}`;
    }
  }

  const patch = await fetch(`https://api.hubapi.com/crm/v3/objects/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${hubspotToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ properties: { hubspot_owner_id: ownerId, hs_task_body: body, hs_task_priority: "HIGH" } }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  if (!patch.ok) throw new Error(`Could not assign HubSpot task (${patch.status}): ${(await patch.text()).slice(0, 300)}`);
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
    const payload = await baseResponse.json() as Record<string, unknown> & { taskId?: string; duplicate?: boolean; error?: string };
    if (!baseResponse.ok) return NextResponse.json(payload, { status: baseResponse.status });

    if (payload.taskId) {
      await patchTask(payload.taskId, owner.id, owner.name, parsed.data.triggers);
    }

    return NextResponse.json({
      ...payload,
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
