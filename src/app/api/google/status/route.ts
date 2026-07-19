import { NextRequest, NextResponse } from "next/server";
import { calendarConnectionStatus, disconnectGoogleCalendar } from "@/lib/google-calendar";

export const runtime = "nodejs";

function validOrigin(request: NextRequest) {
  const expected = process.env.GOOGLE_REDIRECT_URI ? new URL(process.env.GOOGLE_REDIRECT_URI).origin : "";
  return Boolean(expected && request.headers.get("origin") === expected);
}

export async function GET() {
  try {
    return NextResponse.json(await calendarConnectionStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Google Calendar status failed", error);
    return NextResponse.json({ configured: true, connected: false, error: "Unable to read calendar connection" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    await disconnectGoogleCalendar();
    return NextResponse.json({ configured: true, connected: false });
  } catch (error) {
    console.error("Google Calendar disconnect failed", error);
    return NextResponse.json({ error: "Unable to disconnect Google Calendar" }, { status: 500 });
  }
}

