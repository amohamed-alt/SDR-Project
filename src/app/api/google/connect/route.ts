import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleAuthorizationUrl } from "@/lib/google-calendar";

export const runtime = "nodejs";

export function GET() {
  try {
    const state = randomBytes(32).toString("hex");
    const response = NextResponse.redirect(googleAuthorizationUrl(state));
    response.cookies.set("sdr_google_oauth_state", state, {
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

