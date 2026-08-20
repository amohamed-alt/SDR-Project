import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  SALESNAV_SETUP_COOKIE,
  clearLinkedInSession,
  getLinkedInSession,
  saveLinkedInSession,
  verifySalesNavSetupKey,
} from "@/lib/salesnav-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unlockSchema = z.object({
  action: z.literal("unlock"),
  setupKey: z.string().trim().min(20).max(200),
});

const saveSchema = z.object({
  action: z.literal("save"),
  liAt: z.string().trim().min(40).max(6000),
  jsessionId: z.string().trim().max(1000).default(""),
});

const clearSchema = z.object({ action: z.literal("clear") });
const bodySchema = z.discriminatedUnion("action", [unlockSchema, saveSchema, clearSchema]);

function unlocked(request: NextRequest) {
  return verifySalesNavSetupKey(request.cookies.get(SALESNAV_SETUP_COOKIE)?.value || "");
}

export async function GET(request: NextRequest) {
  const session = await getLinkedInSession();
  return NextResponse.json({
    configured: Boolean(session.liAt),
    unlocked: unlocked(request),
    updatedAt: session.updatedAt || "",
    source: session.source || "",
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Sales Navigator session request." }, { status: 400 });
  }

  if (parsed.data.action === "unlock") {
    if (!verifySalesNavSetupKey(parsed.data.setupKey)) {
      return NextResponse.json({ error: "Invalid admin setup key." }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true, unlocked: true });
    response.cookies.set(SALESNAV_SETUP_COOKIE, parsed.data.setupKey, {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  if (!unlocked(request)) {
    return NextResponse.json({ error: "Unlock LinkedIn session settings first." }, { status: 401 });
  }

  if (parsed.data.action === "clear") {
    await clearLinkedInSession();
    return NextResponse.json({ ok: true, configured: false });
  }

  await saveLinkedInSession(parsed.data.liAt, parsed.data.jsessionId);
  return NextResponse.json({
    ok: true,
    configured: true,
    updatedAt: new Date().toISOString(),
  });
}
