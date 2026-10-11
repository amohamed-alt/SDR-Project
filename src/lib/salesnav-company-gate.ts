type RecordRow = { id: string; properties: Record<string, unknown> };
type Reader = {
  associations: (from: string, to: string, ids: string[]) => Promise<Map<string, string[]>>;
  records: (type: string, ids: string[], properties: string[]) => Promise<RecordRow[]>;
};
const CONNECTED = new Set(['f240bbac-87c9-4f6e-bf70-924b57d47db7', '2e7360c1-6b71-40e9-ab2b-30ae98a4678c']);
const MEETINGS = new Set(['SCHEDULED', 'COMPLETED', 'RESCHEDULED']);
export async function scanSalesNavCompany(companyId: string, reader: Reader) {
  const contacts = await reader.associations('companies', 'contacts', [companyId]);
  const contactIds = contacts.get(companyId) || [];
  const collect = async (type: string) => {
    const [direct, indirect] = await Promise.all([
      reader.associations('companies', type, [companyId]),
      reader.associations('contacts', type, contactIds),
    ]);
    return [...new Set([...direct.values(), ...indirect.values()].flat())];
  };
  const [callIds, meetingIds, dealIds] = await Promise.all(['calls', 'meetings', 'deals'].map(collect));
  const read = async (type: string, ids: string[], props: string[]) => {
    const rows = await reader.records(type, ids, props);
    const returned = new Set(rows.map((row) => String(row.id)));
    if (ids.some((id) => !returned.has(id))) throw new Error(`Incomplete ${type} read; company requires review`);
    return rows;
  };
  const [calls, meetings, deals] = await Promise.all([
    read('calls', callIds, ['hs_call_disposition', 'hs_timestamp']),
    read('meetings', meetingIds, ['hs_meeting_outcome', 'hs_meeting_start_time', 'hs_timestamp']),
    read('deals', dealIds, ['pipeline']),
  ]);
  const connectedCalls = calls.filter((row) => CONNECTED.has(String(row.properties.hs_call_disposition || '')));
  const meaningfulMeetings = meetings.filter((row) => {
    const outcome = String(row.properties.hs_meeting_outcome || '').toUpperCase();
    // A real meeting with an unset outcome is evidence requiring review, not absence.
    return MEETINGS.has(outcome) || !outcome;
  });
  const latest = (values: unknown[]) => {
    const dates = values.map((value) => Date.parse(String(value || ''))).filter(Number.isFinite);
    return dates.length ? new Date(Math.max(...dates)).toISOString() : '';
  };
  const latestConnectedCallAt = latest(connectedCalls.map((row) => row.properties.hs_timestamp));
  const latestMeetingAt = latest(meaningfulMeetings.map((row) => row.properties.hs_meeting_start_time || row.properties.hs_timestamp));
  const connectedCallAgeDays = latestConnectedCallAt ? Math.max(0, Math.floor((Date.now() - Date.parse(latestConnectedCallAt)) / 86400000)) : null;
  return {
    checked: true, engaged: Boolean(connectedCalls.length || meaningfulMeetings.length),
    connectedCallCount: connectedCalls.length, meetingCount: meaningfulMeetings.length,
    latestConnectedCallAt, latestMeetingAt, latestEngagementAt: latest([latestConnectedCallAt, latestMeetingAt]),
    recentConnectedCall: connectedCallAgeDays !== null && connectedCallAgeDays <= 30,
    connectedCallAgeDays, reason: '', error: '', scannedContactCount: contactIds.length,
    hasRetentionDeal: deals.some((row) => String(row.properties.pipeline) === '1026934003'),
  };
}

export function salesNavSdrOwner(ats: string, status: string) {
  const vendor = ats.trim();
  const state = status.trim().toLowerCase();
  if (vendor && vendor !== 'Direct Application Form' && /^(detected|confirmed|verified)$/.test(state)) return '37624223';
  if (/^(no_ats_observed|no_ats_verified)$/.test(state)) return '31644369';
  throw new Error('ATS status is unverified. Choose Marita or Daniel manually after review.');
}
