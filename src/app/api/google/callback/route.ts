import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  calendarOrganizerId,
  type CalendarOrganizerId,
} from "@/lib/calendar-organizers";
import { connectGoogleCalendar } from "@/lib/google-calendar";

export const runtime = "nodejs";

function equalState(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function dashboardRedirect(
  status: "connected" | "denied" | "error",
  organizerId: CalendarOrganizerId,
) {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const origin = redirectUri ? new URL(redirectUri).origin : "https://sdr.dashboardtalentera.tech";
  const url = new URL("/", origin);
  url.searchParams.set("workspace", "1");
  url.searchParams.set("calendar", status);
  if (organizerId !== "marita") url.searchParams.set("organizer", organizerId);
  return url;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const expectedState = request.cookies.get("sdr_google_oauth_state")?.value ?? "";
  const organizerId = calendarOrganizerId(
    request.cookies.get("sdr_google_oauth_organizer")?.value,
  );
  const googleError = params.get("error");
  let response: NextResponse;

  if (googleError) {
    response = NextResponse.redirect(dashboardRedirect("denied", organizerId));
  } else if (!state || !expectedState || !equalState(state, expectedState)) {
    response = NextResponse.redirect(dashboardRedirect("error", organizerId));
  } else {
    try {
      const code = params.get("code");
      if (!code) throw new Error("Missing authorization code");
      await connectGoogleCalendar(code, organizerId);
      response = NextResponse.redirect(dashboardRedirect("connected", organizerId));
    } catch (error) {
      console.error("Google OAuth callback failed", error);
      response = NextResponse.redirect(dashboardRedirect("error", organizerId));
    }
  }

  response.cookies.set("sdr_google_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/api/google/callback",
  });
  response.cookies.set("sdr_google_oauth_organizer", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/api/google/callback",
  });
  return response;
}
