import { NextRequest, NextResponse } from "next/server";
import { calendarOrganizerId } from "@/lib/calendar-organizers";
import { calendarConnectionStatus, disconnectGoogleCalendar } from "@/lib/google-calendar";

export const runtime = "nodejs";

function validOrigin(request: NextRequest) {
  const expected = process.env.GOOGLE_REDIRECT_URI ? new URL(process.env.GOOGLE_REDIRECT_URI).origin : "";
  return Boolean(expected && request.headers.get("origin") === expected);
}

export async function GET(request: NextRequest) {
  const organizerId = calendarOrganizerId(request.nextUrl.searchParams.get("organizer"));
  try {
    return NextResponse.json(
      await calendarConnectionStatus(organizerId),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Google Calendar status failed", error);
    return NextResponse.json({ configured: true, connected: false, error: "Unable to read calendar connection" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const organizerId = calendarOrganizerId(request.nextUrl.searchParams.get("organizer"));
  try {
    await disconnectGoogleCalendar(organizerId);
    return NextResponse.json({ configured: true, connected: false });
  } catch (error) {
    console.error("Google Calendar disconnect failed", error);
    return NextResponse.json({ error: "Unable to disconnect Google Calendar" }, { status: 500 });
  }
}
