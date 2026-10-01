import { batchRead } from "@/lib/hubspot";
import { CONNECTED_CALL_DISPOSITION } from "@/lib/config";
import { getAcquisitionAccount } from "@/lib/acquisition-data-api";
import { coverageQueue, saveCoverage } from "@/lib/saudi-coverage-store";
import { INVENTORY_SDR_IDS, type CoverageObservation, type CoverageSnapshot } from "@/lib/saudi-coverage-learning";
import type { HubSpotRecord } from "@/lib/types";

const unique = (values: string[]) => [...new Set(values)];
const stamp = (row: HubSpotRecord) => row.properties.hs_timestamp || row.properties.hs_meeting_start_time || "";
const earliest = (rows: HubSpotRecord[]) => rows.map(stamp).filter((s) => Number.isFinite(Date.parse(s))).sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null;

async function crm<T>(path: string, body?: unknown): Promise<T> {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error("HubSpot is not configured");
  const response = await fetch(`https://api.hubapi.com${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Coverage CRM read failed (${response.status})`);
  return response.json() as Promise<T>;
}

// Follow association pagination: incomplete contact histories must never become
// negative training examples or a false "no future task" claim.
export async function coverageAssociations(from: string, to: string, ids: string[]) {
  const map = new Map<string, string[]>();
  type Page = { to?: { toObjectId: number }[]; results?: { toObjectId: number }[]; paging?: { next?: { after: string } } };
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const payload = await crm<{ results: (Page & { from: { id: string } })[]; errors?: unknown[]; status?: string }>(`/crm/v4/associations/${from}/${to}/batch/read`, { inputs: batch.map((id) => ({ id })) });
    if (payload.errors?.length || payload.status === "PENDING") throw new Error("Incomplete HubSpot association response; coverage was not updated");
    // Some batch responses omit records with no associations. Verify every
    // missing input through the paginated single-record endpoint before using
    // an empty history; absence from the batch alone is never negative evidence.
    for (const id of batch) {
      if (!payload.results.some((r) => String(r.from.id) === id)) {
        const page = await crm<Page>(`/crm/v4/objects/${from}/${encodeURIComponent(id)}/associations/${to}?limit=500`);
        if (!Array.isArray(page.results)) throw new Error("Incomplete HubSpot association response; coverage was not updated");
        payload.results.push({ from: { id }, to: page.results, paging: page.paging });
      }
    }
    for (const row of payload.results) {
      const targets = (row.to || []).map((x) => String(x.toObjectId));
      let after = row.paging?.next?.after;
      const seen = new Set<string>();
      while (after) {
        if (seen.has(after)) throw new Error("Repeated HubSpot association cursor");
        seen.add(after);
        const page = await crm<Page>(`/crm/v4/objects/${from}/${encodeURIComponent(row.from.id)}/associations/${to}?limit=500&after=${encodeURIComponent(after)}`);
        targets.push(...(page.results || []).map((x) => String(x.toObjectId)));
        after = page.paging?.next?.after;
      }
      map.set(String(row.from.id), unique(targets));
    }
  }
  return map;
}

export async function syncSaudiCoverage(limit: number) {
  const queue = await coverageQueue("sync", limit);
  // HubSpot's property REST response uses externalOptions and can omit call
  // outcomes. Reuse the portal-verified Connected ID used by dashboard analytics.
  const connectedCode = CONNECTED_CALL_DISPOSITION;
  const results: { domain: string; synced: boolean; error?: string }[] = [];
  for (const domain of queue.domains) {
    try {
      const account = await getAcquisitionAccount(domain);
      if (!account?.hubspotCompanyId) continue;
      const companyId = account.hubspotCompanyId;
      const associations = await coverageAssociations("companies", "contacts", [companyId]);
      const contactIds = associations.get(companyId) || [];
      const [contacts, companies, cc, cm, ct, pc, pm, pt, dealsMap] = await Promise.all([
        batchRead("contacts", contactIds, ["jobtitle", "business_name", "sdr_owner"]),
        batchRead("companies", [companyId], ["industry", "numberofemployees", "account_type", "account_status", "hubspot_owner_id"]),
        coverageAssociations("companies", "calls", [companyId]), coverageAssociations("companies", "meetings", [companyId]), coverageAssociations("companies", "tasks", [companyId]),
        coverageAssociations("contacts", "calls", contactIds), coverageAssociations("contacts", "meetings", contactIds), coverageAssociations("contacts", "tasks", contactIds),
        coverageAssociations("companies", "deals", [companyId]),
      ]);
      if (!companies.length || contacts.length !== contactIds.length) throw new Error("Some company/contact records were unavailable; preserving previous coverage");
      const ids = (direct: Map<string, string[]>, via: Map<string, string[]>) => unique([...(direct.get(companyId) || []), ...[...via.values()].flat()]);
      const [calls, meetings, tasks, deals] = await Promise.all([
        batchRead("calls", ids(cc, pc), ["hs_call_disposition", "hs_call_status", "hs_timestamp", "hubspot_owner_id"]),
        batchRead("meetings", ids(cm, pm), ["hs_meeting_outcome", "hs_meeting_start_time", "hs_timestamp"]),
        batchRead("tasks", ids(ct, pt), ["hs_task_status", "hs_timestamp"]),
        batchRead("deals", dealsMap.get(companyId) || [], ["hs_is_closed"]),
      ]);
      const live = (rows: HubSpotRecord[]) => rows.filter((r) => Number.isFinite(Date.parse(stamp(r))) && Date.parse(stamp(r)) <= Date.now());
      const connected = live(calls).filter((c) => c.properties.hs_call_disposition === connectedCode);
      const held = live(meetings).filter((m) => m.properties.hs_meeting_outcome === "COMPLETED");
      const p = companies[0].properties;
      const snapshot: CoverageSnapshot = { domain, companyId, checkedAt: new Date().toISOString(), contacts: contacts.length,
        attempted: live(calls).length > 0, connected: connected.length > 0, meetingBooked: meetings.some((m) => ["SCHEDULED", "COMPLETED", "RESCHEDULED"].includes(m.properties.hs_meeting_outcome || "")), meetingHeld: held.length > 0,
        openTask: tasks.some((t) => t.properties.hs_task_status !== "COMPLETED"), futureTask: tasks.some((t) => t.properties.hs_task_status !== "COMPLETED" && Date.parse(t.properties.hs_timestamp || "") > Date.now()),
        protectedAccount: Boolean(p.hubspot_owner_id || /retention/i.test(p.account_type || "") || /^(active|churned)$/i.test(p.account_status || "") || deals.some((d) => d.properties.hs_is_closed !== "true")) };
      const observations: CoverageObservation[] = [];
      for (const contact of contacts) {
        const product = contact.properties.business_name === "ATS" ? "Talentera" : contact.properties.business_name === "Evalufy" ? "Evalufy" : null;
        if (!product) continue;
        const contactCalls = live(calls).filter((c) => (pc.get(contact.id) || []).includes(c.id) && (INVENTORY_SDR_IDS as readonly string[]).includes(c.properties.hubspot_owner_id || ""));
        const firstAttemptAt = earliest(contactCalls);
        if (!firstAttemptAt) continue;
        const after = (rows: HubSpotRecord[]) => rows.filter((r) => Date.parse(stamp(r)) >= Date.parse(firstAttemptAt));
        observations.push({ domain, companyId, contactId: contact.id, product, title: contact.properties.jobtitle || "", industry: p.industry || account.industry,
          employeeCount: Number(p.numberofemployees || account.employeeCount || 0), ownerId: contactCalls.find((c) => stamp(c) === firstAttemptAt)?.properties.hubspot_owner_id || "",
          firstAttemptAt, connectedAt: earliest(after(contactCalls.filter((c) => c.properties.hs_call_disposition === connectedCode))),
          meetingAt: earliest(after(held.filter((m) => (pm.get(contact.id) || []).includes(m.id)))) });
      }
      await saveCoverage(snapshot, observations);
      results.push({ domain, synced: true });
    } catch (error) { results.push({ domain, synced: false, error: error instanceof Error ? error.message : "Coverage sync failed" }); }
  }
  return { requested: queue.domains.length, synced: results.filter((r) => r.synced).length, results };
}
