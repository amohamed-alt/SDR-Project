import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_SDR_OWNER_ID, HUBSPOT_TIMEZONE, hubspotRecordUrl } from "@/lib/config";
import {
  GoogleCalendarError, calendarConnectionStatus, createCalendarDraft,
  deleteCalendarEvent, sendCalendarInvitations,
} from "@/lib/google-calendar";
import {
  HubSpotApiError, archiveMeeting, batchRead, createMeeting, listOwners,
} from "@/lib/hubspot";

export const runtime = "nodejs";
export const maxDuration = 60;

const bookingSchema = z.object({
  requestId: z.string().uuid(),
  contactId: z.string().regex(/^\d+$/),
  salesOwnerId: z.string().regex(/^\d+$/),
  title: z.string().trim().min(3).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().refine((value) => [15, 30, 45, 60].includes(value)),
  meetingType: z.enum(["google-meet", "no-video"]),
  agenda: z.string().trim().max(2_000),
});

function value(record: { properties: Record<string, string | null | undefined> }, key: string) {
  return record.properties[key]?.trim() ?? "";
}

function validOrigin(request: NextRequest) {
  const expected = process.env.GOOGLE_REDIRECT_URI ? new URL(process.env.GOOGLE_REDIRECT_URI).origin : "";
  return Boolean(expected && request.headers.get("origin") === expected);
}

function localEnd(date: string, time: string, durationMinutes: number) {
  const timestamp = new Date(`${date}T${time}:00Z`).getTime() + durationMinutes * 60_000;
  const result = new Date(timestamp).toISOString();
  return { date: result.slice(0, 10), time: result.slice(11, 19) };
}

function localDateTimeToUtc(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let timestamp = target;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
    const represented = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
    timestamp += target - represented;
  }
  return new Date(timestamp).toISOString();
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = bookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid meeting details", details: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;
  let calendarEventId = "";
  let calendarAccessToken = "";
  let hubspotMeetingId = "";

  try {
    const connection = await calendarConnectionStatus();
    if (!connection.connected || !connection.email) {
      return NextResponse.json({ error: "Connect Marita Google Calendar before sending" }, { status: 409 });
    }

    const [contacts, owners] = await Promise.all([
      batchRead("contacts", [input.contactId], ["firstname", "lastname", "email", "company", "sdr_owner"]),
      listOwners(),
    ]);
    const contact = contacts[0];
    if (!contact || value(contact, "sdr_owner") !== DEFAULT_SDR_OWNER_ID) {
      return NextResponse.json({ error: "The selected contact is not in Marita's SDR portfolio" }, { status: 400 });
    }
    const contactEmail = value(contact, "email").toLowerCase();
    if (!contactEmail) return NextResponse.json({ error: "The selected contact has no email address in HubSpot" }, { status: 400 });
    const contactName = [value(contact, "firstname"), value(contact, "lastname")].filter(Boolean).join(" ") || "HubSpot contact";
    const salesOwner = owners.find((owner) => owner.id === input.salesOwnerId);
    if (!salesOwner?.email) return NextResponse.json({ error: "The selected Sales Rep has no email address in HubSpot" }, { status: 400 });

    const startUtc = localDateTimeToUtc(input.date, input.time, HUBSPOT_TIMEZONE);
    if (new Date(startUtc).getTime() < Date.now() - 300_000) {
      return NextResponse.json({ error: "Meeting time must be in the future" }, { status: 400 });
    }
    const localEndValue = localEnd(input.date, input.time, input.durationMinutes);
    const endUtc = localDateTimeToUtc(localEndValue.date, localEndValue.time.slice(0, 5), HUBSPOT_TIMEZONE);
    const startLocal = `${input.date}T${input.time}:00`;
    const endLocal = `${localEndValue.date}T${localEndValue.time}`;
    const description = [
      input.agenda,
      "",
      `Booked by: Marita Chedid (${connection.email})`,
      `Sales host: ${salesOwner.name} (${salesOwner.email})`,
      `Lead: ${contactName} (${contactEmail})`,
      `HubSpot contact ID: ${input.contactId}`,
    ].join("\n").trim();

    const draft = await createCalendarDraft({
      requestId: input.requestId,
      title: input.title,
      description,
      startDateTime: startLocal,
      endDateTime: endLocal,
      timeZone: HUBSPOT_TIMEZONE,
      hubspotContactId: input.contactId,
      hubspotOwnerId: input.salesOwnerId,
      createGoogleMeet: input.meetingType === "google-meet",
    });
    calendarEventId = draft.event.id;
    calendarAccessToken = draft.accessToken;

    const hubspotMeeting = await createMeeting({
      contactId: input.contactId,
      ownerId: input.salesOwnerId,
      title: input.title,
      body: input.agenda,
      internalNotes: `Booked by Marita Chedid through SDR Command Center. Google organizer: ${connection.email}.`,
      startAt: startUtc,
      endAt: endUtc,
      externalUrl: draft.event.htmlLink,
      location: draft.meetLink || "Google Calendar",
    });
    hubspotMeetingId = hubspotMeeting.id;

    const publishedEvent = await sendCalendarInvitations(
      draft.event.id,
      [salesOwner.email, contactEmail],
      draft.accessToken,
    );

    revalidateTag("sdr-dashboard", "max");
    return NextResponse.json({
      success: true,
      contact: { id: input.contactId, name: contactName, email: contactEmail },
      salesOwner: { id: salesOwner.id, name: salesOwner.name, email: salesOwner.email },
      calendarEventId: publishedEvent.id,
      calendarUrl: publishedEvent.htmlLink || draft.event.htmlLink,
      meetLink: publishedEvent.hangoutLink || draft.meetLink,
      hubspotMeetingId,
      hubspotContactUrl: hubspotRecordUrl("contact", input.contactId),
    });
  } catch (error) {
    if (calendarEventId) {
      await deleteCalendarEvent(calendarEventId, calendarAccessToken || undefined).catch((rollbackError) => {
        console.error("Calendar rollback failed", rollbackError);
      });
    }
    if (hubspotMeetingId) {
      await archiveMeeting(hubspotMeetingId).catch((rollbackError) => {
        console.error("HubSpot meeting rollback failed", rollbackError);
      });
    }
    console.error("Meeting booking failed", error);
    const status = error instanceof GoogleCalendarError || error instanceof HubSpotApiError ? error.status : 500;
    return NextResponse.json({
      error: error instanceof GoogleCalendarError ? error.message : error instanceof HubSpotApiError ? "HubSpot could not log the meeting" : "Unable to create the meeting",
    }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}

