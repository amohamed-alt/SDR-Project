type RecordValue = { id: string; properties: Record<string, unknown> };
type Reader = {
  associations: (from: string, to: string, ids: string[]) => Promise<Map<string, string[]>>;
  records: (type: string, ids: string[], properties: string[]) => Promise<RecordValue[]>;
};

const CONNECTED = new Set(["f240bbac-87c9-4f6e-bf70-924b57d47db7", "2e7360c1-6b71-40e9-ab2b-30ae98a4678c"]);
const MEETINGS = new Set(["SCHEDULED", "COMPLETED", "RESCHEDULED"]);
const RETENTION_PIPELINE = "1026934003";

// No contact cap: company activities plus every associated contact's activities/deals.
// Injected readers make pagination failures and partial responses testable without CRM writes.
export async function scanSalesNavCompany(companyId: string, reader: Reader) {
  const contacts = (await reader.associations("companies", "contacts", [companyId])).get(companyId) || [];
  const types = ["calls", "meetings", "deals"];
  const gathered = await Promise.all(types.map(async (type) => {
    const [direct, indirect] = await Promise.all([
      reader.associations("companies", type, [companyId]),
      reader.associations("contacts", type, contacts),
    ]);
    return [...new Set([...(direct.get(companyId) || []), ...[...indirect.values()].flat()])];
  }));
  const properties = [["hs_call_disposition"], ["hs_meeting_outcome"], ["pipeline", "hs_is_closed"]];
  const records = await Promise.all(types.map(async (type, index) => {
    const rows = await reader.records(type, gathered[index], properties[index]);
    const returned = new Set(rows.map((row) => String(row.id)));
    if (gathered[index].some((id) => !returned.has(id))) throw new Error(`Incomplete HubSpot ${type} read; review before Push.`);
    return rows;
  }));
  return {
    engagementChecked: true,
    contactsChecked: contacts.length,
    connectedCallCount: records[0].filter((row) => CONNECTED.has(String(row.properties.hs_call_disposition || ""))).length,
    meetingCount: records[1].filter((row) => MEETINGS.has(String(row.properties.hs_meeting_outcome || "").toUpperCase())).length,
    retentionDealCount: records[2].filter((row) => String(row.properties.pipeline) === RETENTION_PIPELINE).length,
    openDealCount: records[2].filter((row) => String(row.properties.hs_is_closed).toLowerCase() !== "true").length,
  };
}

export function salesNavGate(contact: Record<string, unknown>, company: Record<string, unknown>, hasIdentity: boolean) {
  if (contact.inHubSpot) return "Existing HubSpot person — Ready to Push is net-new people only.";
  if (company.identityAmbiguous) return "Multiple HubSpot companies match this identity — review duplicates before Push.";
  if (!hasIdentity) return "Company identity missing — review before enrichment or Push.";
  if (String(company.accountType || "").trim().toLowerCase() === "retention" || Number(company.retentionDealCount || 0) > 0) return "Retention account or Retention deal — excluded from acquisition.";
  if (Number(company.openDealCount || company.openDeals || 0) > 0) return "Open deal — preserve the existing sales process.";
  if (company.inHubSpot && company.engagementChecked !== true) return "Company communication check incomplete — review before Push.";
  if (Number(company.meetingCount || 0) > 0) return "Existing meeting — excluded from net-new SDR outreach.";
  if (Number(company.connectedCallCount || 0) > 0) return "Existing connected call on company or associated contact — excluded from net-new SDR outreach.";
  return "";
}

export function salesNavSdrOwner(ats: unknown, status: unknown) {
  const value = String(ats || "").trim();
  const state = String(status || "").trim().toLowerCase();
  if (value && !/^(unknown|none|n\/a|not detected|no ats)$/i.test(value) && /^(detected|verified|confirmed|ats detected)$/.test(state)) return "37624223";
  if (/^(no ats|not detected|confirmed no ats|no_ats)$/.test(state)) return "31644369";
  return ""; // Absence of evidence is not proof of no ATS.
}

export function usableSalesNavPhone(value: unknown) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  return /^\+?[\d\s().-]+$/.test(raw) && digits.length >= 8 && digits.length <= 15 ? raw : "";
}
