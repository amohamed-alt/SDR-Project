import type { CalendarOrganizerId } from "@/lib/calendar-organizers";

export interface StoredCalendarConnection {
  email: string;
  encryptedRefreshToken: string;
  connectedAt: string;
  updatedAt: string;
}

export interface CalendarTokenStore {
  version: 2;
  connections: Partial<Record<CalendarOrganizerId, StoredCalendarConnection>>;
}

function storedConnection(value: unknown): StoredCalendarConnection | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<StoredCalendarConnection>;
  if (
    typeof candidate.email !== "string"
    || typeof candidate.encryptedRefreshToken !== "string"
    || typeof candidate.connectedAt !== "string"
    || typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return candidate as StoredCalendarConnection;
}

export function normalizeCalendarTokenStore(value: unknown): CalendarTokenStore | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as {
    version?: unknown;
    connection?: unknown;
    connections?: unknown;
  };

  if (candidate.version === 1) {
    const marita = storedConnection(candidate.connection);
    return {
      version: 2,
      connections: marita ? { marita } : {},
    };
  }

  if (candidate.version !== 2 || !candidate.connections || typeof candidate.connections !== "object") {
    return null;
  }

  const source = candidate.connections as Record<string, unknown>;
  const marita = storedConnection(source.marita);
  const abdullah = storedConnection(source.abdullah);
  return {
    version: 2,
    connections: {
      ...(marita ? { marita } : {}),
      ...(abdullah ? { abdullah } : {}),
    },
  };
}
