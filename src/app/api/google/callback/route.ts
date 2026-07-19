import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { connectGoogleCalendar } from "@/lib/google-calendar";

export const runtime = "nodejs";

function equalState(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function dashboardRedirect(status: "connected" | "denied" | "error") {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const origin = redirectUri ? new URL(redirectUri).origin : "https://sdr.dashboardtalentera.tech";
  return new URL(`/?workspace=1&calendar=${status}`, origin);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const expectedState = request.cookies.get("sdr_google_oauth_state")?.value ?? "";
  const googleError = params.get("error");
  let response: NextResponse;

  if (googleError) {
    response = NextResponse.redirect(dashboardRedirect("denied"));
  } else if (!state || !expectedState || !equalState(state, expectedState)) {
    response = NextResponse.redirect(dashboardRedirect("error"));
  } else {
    try {
      const code = params.get("code");
      if (!code) throw new Error("Missing authorization code");
      await connectGoogleCalendar(code);
      response = NextResponse.redirect(dashboardRedirect("connected"));
    } catch (error) {
      console.error("Google OAuth callback failed", error);
      response = NextResponse.redirect(dashboardRedirect("error"));
    }
  }

  response.cookies.set("sdr_google_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/api/google/callback",
  });
  return response;
}

