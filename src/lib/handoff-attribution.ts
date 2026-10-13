/** Explicit booking marker or HubSpot creator user ID, never the current RM
 * owner alone. This also matches existing Google Calendar booking notes. */
export function bookedBySdr(notes: string, creatorId: string, expectedCreatorId: string | undefined, sdr: "marita" | "daniel") {
  const marker = bookingMarker(notes);
  if (marker) return marker === sdr;
  return Boolean(expectedCreatorId && creatorId === expectedCreatorId);
}

export function bookingMarker(notes: string): "marita" | "daniel" | undefined {
  return notes.match(/\bbooked by\s+(marita|daniel)\b/i)?.[1]?.toLowerCase() as "marita" | "daniel" | undefined;
}

export function bookingEvidenceIndex(records: Array<{ notes: string; creatorId: string }>, sdr: "marita" | "daniel", expectedCreatorId?: string) {
  const explicit = new Set(records.map(record => bookingMarker(record.notes)).filter(Boolean));
  // Explicit organizer evidence wins over the integration's creator identity.
  // Conflicting explicit markers are ambiguous, so neither SDR gets credit.
  if (explicit.size > 1) return -1;
  if (explicit.size === 1) return records.findIndex(record => bookingMarker(record.notes) === sdr);
  return expectedCreatorId ? records.findIndex(record => record.creatorId === expectedCreatorId) : -1;
}

export type HandoffAttributionDiagnostics = {
  meetingGroupsInPeriod: number;
  attributedToSelectedSdr: number;
  excludedFromSelectedSdr: number;
  creatorMappingAvailable: boolean;
};

/** Aggregate evidence coverage only; this does not change booking attribution. */
export function handoffAttributionDiagnostics(groups: Array<{ sdrCreated: boolean }>, creatorMappingAvailable: boolean): HandoffAttributionDiagnostics {
  const attributedToSelectedSdr = groups.filter(group => group.sdrCreated).length;
  return { meetingGroupsInPeriod: groups.length, attributedToSelectedSdr, excludedFromSelectedSdr: groups.length - attributedToSelectedSdr, creatorMappingAvailable };
}

export function handoffAttributionMessage(evidence: HandoffAttributionDiagnostics): string {
  if (!evidence.meetingGroupsInPeriod) return "No RM-owned HubSpot meeting groups were found in the loaded meeting-date cohort. Google Sheet booking totals are a separate source.";
  return `${evidence.attributedToSelectedSdr} of ${evidence.meetingGroupsInPeriod} RM-owned HubSpot meeting groups meet the selected SDR booking-evidence rule. ${evidence.excludedFromSelectedSdr} excluded. Attribution requires an explicit booking marker or the SDR creator ID; a zero result does not establish that the SDR booked no meetings. Google Sheet booking totals are a separate source.`;
}
