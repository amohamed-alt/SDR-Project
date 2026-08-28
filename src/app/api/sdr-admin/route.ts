import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  sdrAdminConfigured,
  sdrAdminCookieName,
  sdrAdminCookieToken,
  sdrAdminAuthorized,
  validateSdrAdminPassword,
} from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const passwordSchema = z.object({ password: z.string().min(1).max(500) });
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateKey(request: NextRequest) {
  return String(
    request.headers.get("cf-connecting-ip")
      || request.headers.get("x-forwarded-for")?.split(",")[0]
      || request.headers.get("x-real-ip")
      || "unknown",
  ).trim().slice(0, 120);
}

export async function GET(request: NextRequest) {
  return NextResponse.json({
    configured: sdrAdminConfigured(),
    unlocked: sdrAdminAuthorized(request),
  });
}

export async function POST(request: NextRequest) {
  if (!sdrAdminConfigured()) {
    return NextResponse.json({ error: "SDR admin password is not configured." }, { status: 503 });
  }

  const key = rateKey(request);
  const now = Date.now();
  const state = attempts.get(key);
  if (state && state.resetAt > now && state.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Too many password attempts. Try again in a few minutes." }, { status: 429 });
  }

  const parsed = passwordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !validateSdrAdminPassword(parsed.data.password)) {
    attempts.set(key, {
      count: state && state.resetAt > now ? state.count + 1 : 1,
      resetAt: state && state.resetAt > now ? state.resetAt : now + WINDOW_MS,
    });
    return NextResponse.json({ error: "Incorrect admin password." }, { status: 401 });
  }

  attempts.delete(key);
  const response = NextResponse.json({ unlocked: true });
  response.cookies.set(sdrAdminCookieName(), sdrAdminCookieToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ unlocked: false });
  response.cookies.set(sdrAdminCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
