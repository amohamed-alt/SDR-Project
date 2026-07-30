import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  bookingAvailabilityIssue,
  isFreeBusyAuthorizationErrorText,
  isStaleGoogleCredentialText,
} from "@/lib/calendar-availability";
import { HUBSPOT_TIMEZONE, hubspotListUrl, hubspotRecordUrl } from "@/lib/config";
import {
  GoogleCalendarError,
  calendarConnectionStatus,
  checkCalendarAvailability,
  createCalendarDraft,
  deleteCalendarEvent,
  disconnectGoogleCalendar,
  sendCalendarInvitations,
} from "@/lib/google-calendar";
import {
  HubSpotApiError,
  archiveMeeting,
  batchRead,
  createMeeting,
  listOwners,
  searchAll,
} from "@/lib/hubspot";
import { meetingInterval } from "@/lib/meeting-time";
import {
  BASSAM_OWNER_ID,
  SALES_REP_OWNER_ID_SET,
  SALES_REP_SELECTION_LABEL,
} from "@/lib/sales-reps";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONTACT_LOOKUP_PROPERTIES = ["firstname", "lastname", "email", "company"] as const;
const normalizedEmailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());

type BookingStage =
  | "calendar_connection"
  | "contact_lookup"
  | "calendar_availability"
  | "calendar_draft"
  | "hubspot_meeting"
  | "calendar_invitations";

const BOOKING_STAGE_LABELS: Record<BookingStage, string> = {
  calendar_connection: "Google Calendar connection",
  contact_lookup: "contact lookup",
  calendar_availability: "Sales Rep availability recheck",
  calendar_draft: "Google Calendar event creation",
  hubspot_meeting: "HubSpot meeting logging",
  calendar_invitations: "calendar invitation delivery",
};

const bookingSchema = z.object({
  requestId: z.string().uuid(),
  contactEmails: z.array(normalizedEmailSchema).max(20).default([])
    .refine((emails) => new Set(emails).size === emails.length, "Contact emails must be unique"),
  contactIds: z.array(z.string().regex(/^\d+$/)).max(20).default([])
    .refine((ids) => new Set(ids).size === ids.length, "Contact IDs must be unique"),
  salesOwnerId: z.string().regex(/^\d+$/),
  includeOrganizerAsAttendee: z.boolean().default(false),
  includeBassamAsAttendee: z.boolean().default(false),
  title: z.string().trim().min(3).max(180),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMinutes: z.number().int().refine((value) => [15, 30, 45, 60].includes(value)),
  meetingType: z.enum(["google-meet", "no-video"]),
  agenda: z.string().trim().max(2_000),
}).superRefine((input, context) => {
  const attendeeCount = input.contactEmails.length + input.contactIds.length;
  if (attendeeCount === 0) {
    context.addIssue({
      code: "custom",
      path: ["contactEmails"],
      message: "Add at least one contact email or HubSpot contact",
    });
  }
  if (attendeeCount > 20) {
    context.addIssue({
      code: "custom",
      path: ["contactEmails"],
      message: "A meeting can include at most 20 selected contacts",
    });
  }
});

interface MeetingContactDetail {
  id: string | null;
  name: string;
  email: string;
  company: string;
  inHubSpot: boolean;
}

function value(record: { properties: Record<string, string | null | undefined> }, key: string) {
  return record.properties[key]?.trim() ?? "";
}

function contactDetailFromRecord(record: {
  id: string | number;
  properties: Record<string, string | null | undefined>;
}): MeetingContactDetail {
  const email = value(record, "email").toLowerCase();
  const name = [value(record, "firstname"), value(record, "lastname")]
    .filter(Boolean)
    .join(" ") || email || "HubSpot contact";

  return {
    id: String(record.id),
    name,
    email,
    company: value(record, "company"),
    inHubSpot: true,
  };
}

function validOrigin(request: NextRequest) {
  const expected = process.env.GOOGLE_REDIRECT_URI ? new URL(process.env.GOOGLE_REDIRECT_URI).origin : "";
  return Boolean(expected && request.headers.get("origin") === expected);
}

async function resolveContactByEmail(email: string): Promise<MeetingContactDetail> {
  const matches = await searchAll(
    "contacts",
    CONTACT_LOOKUP_PROPERTIES,
    [{ propertyName: "email", operator: "EQ", value: email }],
  );
  const contact = matches.find(
    (record) => value(record, "email").toLowerCase() === email,
  ) ?? matches[0];

  if (!contact) {
    return { id: null, name: email, email, company: "", inHubSpot: false };
  }

  return contactDetailFromRecord(contact);
}

function uniqueContacts(contacts: MeetingContactDetail[]) {
  const seen = new Set<string>();
  return contacts.filter((contact) => {
    const key = contact.email || `hubspot:${contact.id ?? ""}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validationMessage(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
    .join("; ");
}

function errorText(error: unknown) {
  if (error instanceof GoogleCalendarError) return `${error.message} ${error.details}`.trim();
  if (error instanceof HubSpotApiError) return `${error.message} ${error.details}`.trim();
  return error instanceof Error ? error.message : String(error);
}

function isStaleGoogleCredential(error: unknown) {
  return isStaleGoogleCredentialText(errorText(error));
}

function isFreeBusyAuthorizationError(error: unknown) {
  return isFreeBusyAuthorizationErrorText(errorText(error));
}

function bookingErrorMessage(stage: BookingStage, error: unknown) {
  if (isStaleGoogleCredential(error)) {
    return "Marita Google Calendar connection is expired or no longer decryptable. Reconnect Marita Calendar, then send the invitation again.";
  }
  if (stage === "calendar_availability" && isFreeBusyAuthorizationError(error)) {
    return "Reconnect Marita Calendar once to approve the Free/Busy permission, then check the Sales Rep again.";
  }
  if (error instanceof GoogleCalendarError) {
    return `${error.message} (${BOOKING_STAGE_LABELS[stage]}).`;
  }
  if (error instanceof HubSpotApiError) {
    return `HubSpot could not log the meeting during ${BOOKING_STAGE_LABELS[stage]}.`;
  }
  return `Meeting failed during ${BOOKING_STAGE_LABELS[stage]}. Please try again.`;
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const parsed = bookingSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({
      error: `Invalid meeting details: ${validationMessage(parsed.error)}`,
      details: parsed.error.flatten(),
    }, { status: 400 });
  }

  const input = parsed.data;
  let stage: BookingStage = "calendar_connection";
  let calendarEventId = "";
  let calendarAccessToken = "";
  let hubspotMeetingId = "";

  try {
    const connection = await calendarConnectionStatus();
    if (!connection.connected || !connection.email) {
      return NextResponse.json({ error: "Connect Marita Google Calendar before sending" }, { status: 409 });
    }

    stage = "contact_lookup";
    const [emailContactDetails, legacyContactRecords, owners] = await Promise.all([
      Promise.all(input.contactEmails.map((email) => resolveContactByEmail(email))),
      input.contactIds.length
        ? batchRead("contacts", input.contactIds, CONTACT_LOOKUP_PROPERTIES)
        : Promise.resolve([]),
      listOwners(),
    ]);

    const legacyContactsById = new Map(
      legacyContactRecords.map((contact) => [String(contact.id), contact]),
    );
    const missingLegacyContactId = input.contactIds.find(
      (contactId) => !legacyContactsById.has(contactId),
    );
    if (missingLegacyContactId) {
      return NextResponse.json({
        error: "A selected HubSpot contact no longer exists. Refresh the dashboard and add the contact again.",
      }, { status: 400 });
    }

    const legacyContactDetails = input.contactIds.map((contactId) =>
      contactDetailFromRecord(
        legacyContactsById.get(contactId) as (typeof legacyContactRecords)[number],
      ),
    );
    const contactDetails = uniqueContacts([...emailContactDetails, ...legacyContactDetails]);

    if (!contactDetails.length) {
      return NextResponse.json({ error: "Add at least one valid contact email before sending" }, { status: 400 });
    }

    const missingLegacyEmail = legacyContactDetails.find((contact) => !contact.email);
    if (missingLegacyEmail) {
      return NextResponse.json({
        error: `${missingLegacyEmail.name} has no email address in HubSpot. Add the attendee by email instead.`,
      }, { status: 400 });
    }

    const salesOwner = owners.find((owner) => owner.id === input.salesOwnerId);
    if (!salesOwner || !SALES_REP_OWNER_ID_SET.has(salesOwner.id)) {
      return NextResponse.json({
        error: `Choose ${SALES_REP_SELECTION_LABEL} as the Sales Rep`,
      }, { status: 400 });
    }
    if (!salesOwner.email) {
      return NextResponse.json({ error: "The selected Sales Rep has no email address in HubSpot" }, { status: 400 });
    }

    const bassamOwner = owners.find((owner) => owner.id === BASSAM_OWNER_ID);
    const includeBassam = input.includeBassamAsAttendee && salesOwner.id !== BASSAM_OWNER_ID;
    if (includeBassam && !bassamOwner?.email) {
      return NextResponse.json({ error: "Bassam Hamed has no email address in HubSpot" }, { status: 400 });
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

    stage = "calendar_availability";
    const availability = await checkCalendarAvailability({
      calendarId: salesOwner.email,
      timeMin: interval.startUtc,
      timeMax: interval.endUtc,
      timeZone: HUBSPOT_TIMEZONE,
    });
    const availabilityIssue = bookingAvailabilityIssue(availability, salesOwner.name);
    if (availabilityIssue) {
      return NextResponse.json({
        ...availabilityIssue,
        availability,
      }, { status: availabilityIssue.status });
    }

    const primaryContact = contactDetails[0];
    const hubspotContactIds = contactDetails.flatMap((contact) => contact.id ? [contact.id] : []);
    const primaryHubSpotContact = contactDetails.find((contact) => Boolean(contact.id));
    const contactLines = contactDetails.map((contact, index) =>
      `${index === 0 ? "Primary contact" : "Additional contact"}: ${contact.name} (${contact.email}) · ${contact.id ? `HubSpot ID ${contact.id}` : "Not found in HubSpot; email invitation only"}`,
    );
    const description = [
      input.agenda,
      "",
      `Booked by: Marita Chedid (${connection.email})`,
      `Sales host: ${salesOwner.name} (${salesOwner.email})`,
      ...(includeBassam && bassamOwner?.email
        ? [`Additional attendee: ${bassamOwner.name} (${bassamOwner.email})`]
        : []),
      ...contactLines,
    ].join("\n").trim();

    stage = "calendar_draft";
    const draft = await createCalendarDraft({
      requestId: input.requestId,
      title: input.title,
      description,
      startDateTime: interval.startLocal,
      endDateTime: interval.endLocal,
      timeZone: HUBSPOT_TIMEZONE,
      hubspotContactId: primaryHubSpotContact?.id ?? "",
      hubspotOwnerId: input.salesOwnerId,
      createGoogleMeet: input.meetingType === "google-meet",
    });
    calendarEventId = draft.event.id;
    calendarAccessToken = draft.accessToken;

    const associationSummary = contactDetails
      .map((contact) => `${contact.name} (${contact.id ? `HubSpot ${contact.id}` : "email only"})`)
      .join(", ");

    stage = "hubspot_meeting";
    const hubspotMeeting = await createMeeting({
      contactIds: hubspotContactIds,
      ownerId: input.salesOwnerId,
      title: input.title,
      body: input.agenda,
      internalNotes: `Booked by Marita Chedid through SDR Command Center. Google organizer: ${connection.email}. Attendees: ${associationSummary}.${includeBassam && bassamOwner?.email ? ` Bassam Hamed added as attendee (${bassamOwner.email}).` : ""}`,
      startAt: interval.startUtc,
      endAt: interval.endUtc,
      externalUrl: draft.event.htmlLink,
      location: draft.meetLink || "Google Calendar",
    });
    hubspotMeetingId = hubspotMeeting.id;

    stage = "calendar_invitations";
    const publishedEvent = await sendCalendarInvitations(
      draft.event.id,
      [
        salesOwner.email,
        ...contactDetails.map((contact) => contact.email),
        ...(input.includeOrganizerAsAttendee ? [connection.email] : []),
        ...(includeBassam && bassamOwner?.email ? [bassamOwner.email] : []),
      ],
      draft.accessToken,
    );

    try {
      revalidateTag("sdr-dashboard", "max");
    } catch (cacheError) {
      console.error("Meeting created but dashboard cache refresh failed", {
        requestId: input.requestId,
        cacheError,
      });
    }

    return NextResponse.json({
      success: true,
      contacts: contactDetails.map(({ id, name, email, inHubSpot }) => ({ id, name, email, inHubSpot })),
      organizerIncluded: input.includeOrganizerAsAttendee,
      bassamIncluded: includeBassam,
      salesOwner: { id: salesOwner.id, name: salesOwner.name, email: salesOwner.email },
      calendarEventId: publishedEvent.id,
      calendarUrl: publishedEvent.htmlLink || draft.event.htmlLink,
      meetLink: publishedEvent.hangoutLink || draft.meetLink,
      hubspotMeetingId,
      hubspotContactUrl: primaryHubSpotContact
        ? hubspotRecordUrl("contact", primaryHubSpotContact.id as string)
        : hubspotListUrl("meeting"),
      hubspotLinkLabel: primaryHubSpotContact
        ? "Open primary HubSpot timeline"
        : "Open HubSpot meetings",
      primaryContact: {
        name: primaryContact.name,
        email: primaryContact.email,
        inHubSpot: primaryContact.inHubSpot,
      },
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

    const staleGoogleCredential = isStaleGoogleCredential(error);
    const freeBusyAuthorizationError = isFreeBusyAuthorizationError(error);
    if (staleGoogleCredential) {
      await disconnectGoogleCalendar().catch((disconnectError) => {
        console.error("Unable to clear stale Google Calendar connection", disconnectError);
      });
    }

    console.error("Meeting booking failed", {
      requestId: input.requestId,
      stage,
      freeBusyAuthorizationError,
      error,
    });

    const status = staleGoogleCredential || freeBusyAuthorizationError
      ? 409
      : error instanceof GoogleCalendarError || error instanceof HubSpotApiError
        ? error.status
        : 500;

    return NextResponse.json({
      error: bookingErrorMessage(stage, error),
      errorCode: `${stage}_${
        staleGoogleCredential
          ? "stale_google_connection"
          : freeBusyAuthorizationError
            ? "free_busy_reconnect_required"
            : "failed"
      }`,
      requestId: input.requestId,
    }, { status: status >= 400 && status < 600 ? status : 500 });
  }
}
