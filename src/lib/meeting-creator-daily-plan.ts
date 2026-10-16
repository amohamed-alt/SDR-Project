import {
  MEETING_CREATOR_MARITA_OWNER,
  MEETING_CREATOR_DANIEL_OWNER,
  type CreatorQueueRow,
} from "./meeting-creator-queue.ts";

export type CreatorSdrPlan = {
  ownerId: string;
  name: "Marita" | "Daniel";
  target: number;
  maxReactivation: number;
  newAccounts: number;
  reactivationAccounts: number;
  total: number;
  shortfall: number;
  candidates: CreatorQueueRow[];
};

export function planCreatorDay(
  queue: readonly CreatorQueueRow[],
  options: { targetPerSdr?: number; maxReactivationFraction?: number } = {},
): CreatorSdrPlan[] {
  const target = Math.min(150, Math.max(1, Math.round(options.targetPerSdr ?? 100)));
  const fraction = Math.max(0, Math.min(0.25, options.maxReactivationFraction ?? 0.25));
  const maxReactivation = Math.floor(target * fraction);
  const assigned = new Set<string>();
  return ([
    { ownerId: MEETING_CREATOR_MARITA_OWNER, name: "Marita" as const },
    { ownerId: MEETING_CREATOR_DANIEL_OWNER, name: "Daniel" as const },
  ]).map((owner) => {
    const eligible = queue.filter((row) => row.status === "call_ready" && row.sdrId === owner.ownerId)
      .sort((a,b)=>b.priority-a.priority || a.key.localeCompare(b.key));
    const netNew = eligible.filter((row)=>row.motion === "new_contact");
    const revival = eligible.filter((row)=>row.motion === "reactivation");
    const selected: CreatorQueueRow[] = [];
    for(const row of netNew) {
      if(selected.length >= target)break;
      if(assigned.has(row.domain))continue;
      selected.push(row);assigned.add(row.domain);
    }
    for(const row of revival) {
      if(selected.length >= target || selected.filter((x)=>x.motion === "reactivation").length >= maxReactivation)break;
      if(assigned.has(row.domain))continue;
      selected.push(row);assigned.add(row.domain);
    }
    return {
      ownerId:owner.ownerId,name:owner.name,target,maxReactivation,
      newAccounts:selected.filter((x)=>x.motion === "new_contact").length,
      reactivationAccounts:selected.filter((x)=>x.motion === "reactivation").length,
      total:selected.length,shortfall:Math.max(0,target-selected.length),candidates:selected,
    };
  });
}
