import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POST as precheck } from "@/app/api/prospecting/salesnav/precheck-v2/route";
import { POST as reveal } from "@/app/api/prospecting/salesnav/reveal-fast/route";
import { POST as push } from "@/app/api/prospecting/salesnav/push-ready-v2/route";
import { lookupSalesNavLead } from "@/lib/salesnav-lead-ledger";
import { manualTaskOwners } from "@/lib/acquisition-routing";
import { usablePhone } from "@/lib/saudi-ats-policy";
import { sdrAdminCookieName, sdrAdminCookieToken } from "@/lib/sdr-admin-auth";
import { batchRead, readAssociations } from "@/lib/hubspot";
import { normalizedCompanyName } from "@/lib/company-dedupe";

type Json = Record<string, unknown>;
const actions = new Set(["profile_options", "profile_check", "profile_reveal", "profile_push"]);
const leadSchema = z.object({
  name: z.string().trim().min(2).max(200),
  title: z.string().trim().min(2).max(300),
  company: z.string().trim().min(2).max(300),
  location: z.string().trim().max(300).default(""),
  linkedinUrl: z.string().url().max(1500).refine((value) => {
    try { const url = new URL(value); return url.protocol === "https:" && /^(www\.)?linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/?#]+\/?$/.test(url.pathname); }
    catch { return false; }
  }, "Read the public LinkedIn profile URL first."),
  salesLeadUrl: z.string().trim().max(2000).default(""),
});
const schema = z.object({
  action: z.enum(["profile_check", "profile_reveal", "profile_push"]),
  lead: leadSchema,
  revealConfirmed: z.boolean().default(false),
  pushConfirmed: z.boolean().default(false),
  taskOwnerId: z.string().max(80).default(""),
  taskDueAt: z.string().max(100).default(""),
});
const headers = { "Cache-Control": "no-store" };
const sdrIds = new Set(["31644369", "37624223"]);
function object(value: unknown): Json { return value && typeof value === "object" ? value as Json : {}; }
function phones(prospect: Json) { return [prospect.phone, ...(Array.isArray(prospect.phones) ? prospect.phones : [])].map((value) => String(value || "").trim()).filter(usablePhone); }
function nameKey(value: unknown) { return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function identityError(lead: z.infer<typeof leadSchema>, prospect: Json) {
  if (!Object.keys(prospect).length) return "";
  if (nameKey(lead.name) !== nameKey(prospect.fullName)) return "Contact provider identity differs from this profile. Review before push.";
  if (normalizedCompanyName(lead.company) !== normalizedCompanyName(String(prospect.company || ""))) return "Contact provider company differs from the current LinkedIn role. Review before push.";
  return "";
}
function requestLike(base: NextRequest, pathname: string, body: unknown, authorizedPush = false) {
  const requestHeaders: Record<string, string> = { "Content-Type": "application/json" };
  // This bridge is called ONLY after the companion handler verifies its pairing token.
  // Authorize the existing internal push handler without returning any server credential.
  if (authorizedPush) {
    const cookie = sdrAdminCookieToken();
    if (!cookie) throw new Error("Server admin authorization is not configured.");
    requestHeaders.cookie = `${sdrAdminCookieName()}=${cookie}`;
  }
  return new NextRequest(new URL(pathname, base.url), { method: "POST", headers: requestHeaders, body: JSON.stringify(body) });
}
async function json(response: Response) {
  const payload = await response.json() as Json;
  if (!response.ok) throw new Error(String(payload.error || "Profile operation failed."));
  return payload;
}
async function check(base: NextRequest, lead: z.infer<typeof leadSchema>, prospect: Json) {
  const payload = await json(await precheck(requestLike(base, "/api/prospecting/salesnav/precheck-v2", {
    name: lead.name, company: lead.company, linkedinUrl: lead.linkedinUrl,
    companyDomain: prospect.companyDomain || "", companyWebsite: prospect.companyWebsite || "",
    email: prospect.email || "", emails: prospect.emails || [], phone: prospect.phone || "", phones: prospect.phones || [],
  })));
  const company = object(payload.company), contact = object(payload.contact);
  const mismatch = identityError(lead, prospect);
  return { ...payload, company, contact, eligible: !contact.inHubSpot && !company.protected && !mismatch, identityError: mismatch };
}

// Authentication stays in /salesnav/companion; no public alias for these actions exists.
export async function handleCompanionProfileAction(request: NextRequest, body: Json): Promise<NextResponse | null> {
  if (!actions.has(String(body.action || ""))) return null;
  try {
    if (body.action === "profile_options") {
      return NextResponse.json({ ok: true, owners: manualTaskOwners().filter((owner) => sdrIds.has(owner.id)).map(({ id, name }) => ({ id, name })) }, { headers });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Read a complete profile with its public LinkedIn URL, current title and company first." }, { status: 400, headers });
    const input = parsed.data;
    if (/\bin role\b|\bin company\b|^[·•\s]*(?:1st|2nd|3rd)$/i.test(input.lead.title)) return NextResponse.json({ error: "Job title was not captured correctly. Read the profile again." }, { status: 400, headers });
    const cached = await lookupSalesNavLead(input.lead);
    const prospect = object(cached?.cachedProspect);
    const checked = await check(request, input.lead, prospect);
    if (input.action === "profile_check") {
      return NextResponse.json({ ok: true, check: checked, prospect: Object.keys(prospect).length ? prospect : null, revealAttempted: Boolean(cached?.revealAttemptedAt), cached: Boolean(cached?.cachedProspect), hasPhone: phones(prospect).length > 0, previousPush: cached?.taskId ? { taskId: cached.taskId, contactId: cached.contactId, companyId: cached.companyId } : null }, { headers });
    }
    if (!checked.eligible) return NextResponse.json({ error: checked.identityError || object(checked.company).protectedReason || "This person is blocked by the HubSpot gate.", check: checked }, { status: 409, headers });
    if (input.action === "profile_reveal") {
      if (!input.revealConfirmed) return NextResponse.json({ error: "Confirm contact credit usage before reveal." }, { status: 400, headers });
      const payload = await json(await reveal(requestLike(request, "/api/prospecting/salesnav/reveal-fast", { lead: input.lead })));
      const revealed = object(payload.prospect);
      const refreshed = await check(request, input.lead, revealed);
      return NextResponse.json({ ...payload, ok: true, check: refreshed, hasPhone: phones(revealed).length > 0 }, { headers });
    }
    if (!input.pushConfirmed) return NextResponse.json({ error: "Confirm owner and task time before push." }, { status: 400, headers });
    if (!sdrIds.has(input.taskOwnerId) || !manualTaskOwners().some((owner) => owner.id === input.taskOwnerId)) return NextResponse.json({ error: "Choose an enabled SDR: Marita or Daniel." }, { status: 400, headers });
    if (!input.taskDueAt || Number.isNaN(Date.parse(input.taskDueAt))) return NextResponse.json({ error: "Choose a valid task date and time." }, { status: 400, headers });
    if (!phones(prospect).length) return NextResponse.json({ error: "A usable phone from the stored reveal is required before push." }, { status: 422, headers });
    // Ignore client-supplied phone/prospect data: only use the verified server ledger.
    const payload = await json(await push(requestLike(request, "/api/prospecting/salesnav/push-ready-v2", {
      lead: input.lead, taskOwnerId: input.taskOwnerId, taskDueAt: input.taskDueAt,
      prospect: { ...prospect, assignmentMode: "acquisition", ownerId: input.taskOwnerId },
    }, true)));
    const taskId = String(payload.taskId || ""), contactId = String(payload.contactId || "");
    if (!taskId || !contactId) throw new Error("Push returned no task/contact identity. Recheck this lead before retrying.");
    const [tasks, associations] = await Promise.all([
      batchRead("tasks", [taskId], ["hubspot_owner_id", "hs_timestamp", "hs_task_type"]),
      readAssociations("tasks", "contacts", [taskId]),
    ]);
    const task = tasks.find((item) => String(item.id) === taskId);
    const expectedOwner = payload.duplicate ? String(payload.ownerId || "") : input.taskOwnerId;
    const timestamp = task?.properties.hs_timestamp || "";
    const dueMs = /^\d+$/.test(timestamp) ? Number(timestamp) : Date.parse(timestamp);
    if (!task || task.properties.hs_task_type !== "CALL" || task.properties.hubspot_owner_id !== expectedOwner || !associations.get(taskId)?.includes(contactId) || (!payload.duplicate && dueMs !== Date.parse(input.taskDueAt))) {
      throw new Error(`Task ${taskId} was written but verification is incomplete. Read + Check to reconcile before another push.`);
    }
    return NextResponse.json({ ...payload, ok: true, verified: true }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not process this profile." }, { status: 500, headers });
  }
}
