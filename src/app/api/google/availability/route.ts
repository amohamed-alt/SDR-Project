import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  isFreeBusyAuthorizationErrorText,
  isStaleGoogleCredentialText,
} from "@/lib/calendar-availability";
import { HUBSPOT_TIMEZONE } from "@/lib/config";
import {
  GoogleCalendarError,
  calendarConnectionStatus,
  checkCalendarAvailability,
  disconnectGoogleCalendar,
} from "@/lib/google-calendar";
import { listOwners } from "@/lib/hubspot";
import { meetingInterval } from "@/lib/meeting-time";
import {
  SALES_REP_OWNER_ID_SET,
  SALES_REP_SELECTION_LABEL,
} from "@/lib/sales-reps";

export const runtime = "nodejs";

const availabilitySchema = z.object({
  salesOwnerId: z.string().regex(/^\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().refine((value) => [15, 30, 45, 60].includes(value)),
});

function validOrigin(request: NextRequest) {
  const expected = process.env.GOOGLE_REDIRECT_URI
    ? new URL(process.env.GOOGLE_REDIRECT_URI).origin
    : "";
  return Boolean(expected && request.headers.get("origin") === expected);
}

function errorText(error: unknown) {
  if (error instanceof GoogleCalendarError) return `${error.message} ${error.details}`.trim();
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const parsed = availabilitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      error: "Invalid availability request",
      details: parsed.error.flatten(),
    }, { status: 400 });
  }

  const input = parsed.data;
  try {
    const connection = await calendarConnectionStatus();
    if (!connection.connected) {
      return NextResponse.json({
        status: "unavailable",
        busy: [],
        checkedAt: new Date().toISOString(),
        message: "Connect Marita Google Calendar before checking Sales availability.",
        reconnectRequired: true,
      });
    }

    const owners = await listOwners();
    const salesOwner = owners.find((owner) => owner.id === input.salesOwnerId);
    if (!salesOwner || !SALES_REP_OWNER_ID_SET.has(salesOwner.id)) {
      return NextResponse.json({
        error: `Choose ${SALES_REP_SELECTION_LABEL} as the Sales Rep`,
      }, { status: 400 });
    }
    if (!salesOwner.email) {
      return NextResponse.json({
        error: "The selected Sales Rep has no email address in HubSpot",
      }, { status: 400 });
    }

    const interval = meetingInterval(
      input.date,
      input.time,
      input.durationMinutes,
      HUBSPOT_TIMEZONE,
    );
    if (new Date(interval.startUtc).getTime() < Date.now() - 300_000) {
      return NextResponse.json({ error: "Meeting time must be in the future" }, { status: 400 });
    }

    const availability = await checkCalendarAvailability({
      calendarId: salesOwner.email,
      timeMin: interval.startUtc,
      timeMax: interval.endUtc,
      timeZone: HUBSPOT_TIMEZONE,
    });

    return NextResponse.json({
      ...availability,
      salesOwner: {
        id: salesOwner.id,
        name: salesOwner.name,
        email: salesOwner.email,
      },
      timeZone: HUBSPOT_TIMEZONE,
      startUtc: interval.startUtc,
      endUtc: interval.endUtc,
      message: availability.status === "available"
        ? `${salesOwner.name} is available at this time.`
        : availability.status === "busy"
          ? `${salesOwner.name} is busy during this time.`
          : `Free/Busy access is unavailable for ${salesOwner.email}. Ask the Google Workspace admin to share availability with Marita.`,
      reconnectRequired: false,
    });
  } catch (error) {
    const details = errorText(error);
    const staleCredential = isStaleGoogleCredentialText(details);
    const missingScope = isFreeBusyAuthorizationErrorText(details);

    if (staleCredential) {
      await disconnectGoogleCalendar().catch((disconnectError) => {
        console.error("Unable to clear stale Google Calendar connection", disconnectError);
      });
    }

    console.error("Sales Rep availability check failed", {
      salesOwnerId: input.salesOwnerId,
      staleCredential,
      missingScope,
      error,
    });

    return NextResponse.json({
      status: "unavailable",
      busy: [],
      checkedAt: new Date().toISOString(),
      message: staleCredential
        ? "Marita Calendar connection expired. Reconnect it before booking."
        : missingScope
          ? "Reconnect Marita Calendar once to approve the new Free/Busy permission."
          : "Sales Rep availability could not be verified. Booking remains blocked.",
      reconnectRequired: staleCredential || missingScope,
    });
  }
}
