export interface CalendarBusyPeriod {
  start: string;
  end: string;
}

export type CalendarAvailabilityStatus = "available" | "busy" | "unavailable";

export interface CalendarAvailability {
  status: CalendarAvailabilityStatus;
  calendarId: string;
  busy: CalendarBusyPeriod[];
  checkedAt: string;
  reason?: string;
}

export interface GoogleFreeBusyResponse {
  calendars?: Record<string, {
    busy?: CalendarBusyPeriod[];
    errors?: Array<{ domain?: string; reason?: string }>;
  }>;
}

export function classifyFreeBusyResponse(
  calendarId: string,
  payload: GoogleFreeBusyResponse,
  checkedAt = new Date().toISOString(),
): CalendarAvailability {
  const exactEntry = payload.calendars?.[calendarId];
  const caseInsensitiveEntry = Object.entries(payload.calendars ?? {})
    .find(([key]) => key.toLowerCase() === calendarId.toLowerCase())?.[1];
  const entry = exactEntry ?? caseInsensitiveEntry;

  if (!entry) {
    return {
      status: "unavailable",
      calendarId,
      busy: [],
      checkedAt,
      reason: "Google did not return availability for this calendar.",
    };
  }

  if (entry.errors?.length) {
    const reasons = entry.errors
      .map((error) => error.reason || error.domain)
      .filter((reason): reason is string => Boolean(reason));
    return {
      status: "unavailable",
      calendarId,
      busy: [],
      checkedAt,
      reason: reasons.length
        ? `Calendar access was denied (${[...new Set(reasons)].join(", ")}).`
        : "Calendar access was denied.",
    };
  }

  const busy = (entry.busy ?? []).filter(
    (period) => Boolean(period.start && period.end),
  );

  return {
    status: busy.length ? "busy" : "available",
    calendarId,
    busy,
    checkedAt,
  };
}

export function isStaleGoogleCredentialText(value: string) {
  return /invalid_grant|refresh token|token.+revoked|token.+expired|authenticate data|bad decrypt|stored google credential|credential.+invalid|unable to authenticate/i
    .test(value);
}

export function isFreeBusyAuthorizationErrorText(value: string) {
  return /insufficient.+scope|insufficient authentication scopes|calendar(?:\.events)?\.freebusy|free.?busy.+permission/i
    .test(value);
}

export function bookingAvailabilityIssue(
  availability: CalendarAvailability,
  salesRepName: string,
) {
  if (availability.status === "available") return null;

  if (availability.status === "busy") {
    return {
      status: 409,
      errorCode: "sales_rep_busy",
      error: `${salesRepName} is busy during this time. Choose another slot and check availability again.`,
    } as const;
  }

  return {
    status: 409,
    errorCode: "sales_rep_availability_unavailable",
    error: `Availability for ${salesRepName} could not be verified. Booking is blocked until Free/Busy access is available.`,
  } as const;
}
