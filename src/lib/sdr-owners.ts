export const SDR_OWNERS = {
  marita: { key: "marita", ownerId: "31644369", name: "Marita Chedid", shortName: "Marita", initials: "MC", brand: "Talentera", color: "#087a50" },
  daniel: { key: "daniel", ownerId: "37624223", name: "Daniel Beaini", shortName: "Daniel", initials: "DB", brand: "Evalufy", color: "#4714ce" },
  ursula: { key: "ursula", ownerId: "76369997", name: "Ursula Waked", shortName: "Ursula", initials: "UW", brand: "Talentera", color: "#167a69" },
  zein: { key: "zein", ownerId: "31558980", name: "Zein Fares", shortName: "Zein", initials: "ZF", brand: "Talentera", color: "#b46a1f" },
} as const;
export type SdrKey = keyof typeof SDR_OWNERS;
export type SdrDashboardProps = { sdr?: SdrKey; active?: boolean };
