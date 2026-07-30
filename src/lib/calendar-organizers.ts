export const CALENDAR_ORGANIZER_IDS = ["marita", "abdullah"] as const;
export type CalendarOrganizerId = (typeof CALENDAR_ORGANIZER_IDS)[number];

export const CALENDAR_ORGANIZERS: Record<CalendarOrganizerId, {
  id: CalendarOrganizerId;
  name: string;
  shortName: string;
  email: string;
  emailEnvironmentVariable: "MARITA_GOOGLE_EMAIL" | "ABDULLAH_GOOGLE_EMAIL";
}> = {
  marita: {
    id: "marita",
    name: "Marita Chedid",
    shortName: "Marita",
    email: "m.chedid@talentera.com",
    emailEnvironmentVariable: "MARITA_GOOGLE_EMAIL",
  },
  abdullah: {
    id: "abdullah",
    name: "Abdullah Mohamed",
    shortName: "Abdullah",
    email: "a.mohamed@talentera.com",
    emailEnvironmentVariable: "ABDULLAH_GOOGLE_EMAIL",
  },
} as const;

export const DEFAULT_CALENDAR_ORGANIZER_ID: CalendarOrganizerId = "marita";

export function calendarOrganizerId(value: string | null | undefined): CalendarOrganizerId {
  return value === "abdullah" ? "abdullah" : DEFAULT_CALENDAR_ORGANIZER_ID;
}

export function calendarOrganizer(id: CalendarOrganizerId) {
  return CALENDAR_ORGANIZERS[id];
}
