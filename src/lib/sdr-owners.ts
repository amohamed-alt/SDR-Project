export const SDR_OWNERS = {
  marita: { key: "marita", ownerId: "31644369", name: "Marita Chedid", shortName: "Marita", initials: "MC", brand: "Talentera", color: "#087a50" },
  daniel: { key: "daniel", ownerId: "37624223", name: "Daniel Beaini", shortName: "Daniel", initials: "DB", brand: "Evalufy", color: "#4714ce" },
} as const;
export type SdrKey = keyof typeof SDR_OWNERS;
export type SdrDashboardProps = { sdr?: SdrKey; active?: boolean };
