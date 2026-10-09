import { SDR_OWNERS } from "./sdr-owners.ts";

/** RM ownership is distinct from SDR booking/portfolio attribution. */
export function reportingOwnerScope(ownerId: string, creatorId?: string) {
  const isRm = ownerId === SDR_OWNERS.ursula.ownerId || ownerId === SDR_OWNERS.zein.ownerId;
  return {
    isRm,
    contactProperty: isRm ? "hubspot_owner_id" : "sdr_owner",
    meetingProperty: isRm ? "hubspot_owner_id" : "hs_created_by_user_id",
    meetingOwner: isRm ? ownerId : creatorId,
  };
}
