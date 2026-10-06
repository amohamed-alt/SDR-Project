/** Explicit booking marker or HubSpot creator user ID, never the current RM
 * owner alone. This also matches existing Google Calendar booking notes. */
export function bookedBySdr(notes: string, creatorId: string, expectedCreatorId: string | undefined, sdr: "marita" | "daniel") {
  return new RegExp(`\\bbooked by\\s+${sdr}\\b`, "i").test(notes)
    || Boolean(expectedCreatorId && creatorId === expectedCreatorId);
}
