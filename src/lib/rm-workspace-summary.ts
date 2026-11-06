import type { JourneyRow } from './rm-journey.ts';
import type { journeyStatus } from './rm-journey-status.ts';

export function isOpenDeal(deal: JourneyRow['deals'][number]) {
  const p = deal.properties;
  return p.hs_is_closed === 'false' && !['closedwon', 'closedlost'].includes(String(p.dealstage));
}

export function followupHealth(state: ReturnType<typeof journeyStatus>, partial = false) {
  if (!state.followupRequired) return 'No follow-up required';
  if (!state.responsible) return 'Owner needs review';
  if (state.overdue.length) return 'Overdue task';
  if (state.slaBreached) return 'Follow-up overdue';
  if (partial) return 'History incomplete';
  if (!state.future.length) return 'Next action needed';
  if (!state.lastFollowupAt) return 'Scheduled · outreach unverified';
  return 'On track';
}

type Update = { title: string; text: string; at: string };
const plain = (value: unknown) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// Record modification time is labelled as such; it is never presented as a note's creation time.
export function latestAccountUpdate(group: JourneyRow[], rmId: string, now: string): Update | undefined {
  const updates: Update[] = [];
  for (const row of group) {
    for (const event of row.followups) {
      if (!rmId || event.ownerId === rmId || event.participantIds?.includes(rmId)) {
        updates.push({ title: event.type, text: event.type === 'Call attempt' ? 'Recorded call attempt. Connection is not confirmed.' : rmId ? 'Recorded RM outreach' : 'Recorded account outreach', at: event.at });
      }
    }
    if (row.notes || row.summary) updates.push({ title: 'Meeting record updated', text: plain(row.notes || row.summary), at: row.version });
    for (const deal of row.deals.filter(d => !rmId || d.ownerId === rmId)) {
      const text = plain(deal.properties.deal_update_rm_notes || deal.properties.deal_next_step || deal.properties.next_steps_planned_by_rm);
      updates.push({ title: 'Deal record updated', text: text || `${deal.name} · ${deal.stage}`, at: String(deal.properties.hs_lastmodifieddate || '') });
    }
  }
  return updates.filter(u => Number.isFinite(Date.parse(u.at)) && Date.parse(u.at) <= Date.parse(now))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}
