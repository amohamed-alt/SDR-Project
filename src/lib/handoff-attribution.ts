import type { HubSpotRecord } from "./types.ts";

export type BookingSdr = { id: string; name: string; creatorId?: string };

// Explicit booking notes take precedence over the integration user that wrote
// the record. Do not infer booking attribution from the current contact owner.
export function bookingSdr(records: HubSpotRecord[], sdrs: BookingSdr[]): BookingSdr | null {
  const marked = sdrs.filter(sdr => records.some(record => {
    const notes = record.properties.hs_internal_meeting_notes || "";
    return new RegExp(`\\bbooked by ${sdr.name.split(" ")[0]}\\b`, "i").test(notes);
  }));
  if (marked.length) return marked.length === 1 ? marked[0] : null;
  const creators = sdrs.filter(sdr => sdr.creatorId && records.some(record =>
    record.properties.hs_created_by_user_id === sdr.creatorId));
  return creators.length === 1 ? creators[0] : null;
}
