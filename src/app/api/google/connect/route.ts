import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { calendarOrganizerId } from "@/lib/calendar-organizers";
import { googleAuthorizationUrl } from "@/lib/google-calendar";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  try {
    const organizerId = calendarOrganizerId(request.nextUrl.searchParams.get("organizer"));
    const state = randomBytes(32).toString("hex");
    const response = NextResponse.redirect(googleAuthorizationUrl(state, organizerId));
    response.cookies.set("sdr_google_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/api/google/callback",
    });
    response.cookies.set("sdr_google_oauth_organizer", organizerId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/api/google/callback",
    });
    return response;
  } catch (error) {
    console.error("Google OAuth start failed", error);
    return NextResponse.json({ error: "Google Calendar OAuth is not configured correctly" }, { status: 503 });
  }
}
