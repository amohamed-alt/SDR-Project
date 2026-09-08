import type { HubSpotOwner } from "./types.ts";
export function meetingCreatorId(owners: HubSpotOwner[], ownerId: string): string | undefined {
  const userId = owners.find(owner => owner.id === ownerId)?.userId;
  return userId && /^\d+$/.test(userId) ? userId : undefined;
}
