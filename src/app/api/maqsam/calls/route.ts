import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listMaqsamCalls, upsertMaqsamCall } from "@/lib/maqsam-calls";
import type { MaqsamCallRecord } from "@/lib/maqsam-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const segmentSchema = z.object({
  speaker: z.string().max(100).optional(),
  startTime: z.number().finite().optional(),
  endTime: z.number().finite().optional(),
  content: z.string().max(20_000).optional(),
}).passthrough();

const payloadSchema = z.object({
  callKey: z.string().trim().min(1).max(200),
  callId: z.union([z.string(), z.number()]).nullable().optional(),
  referenceId: z.union([z.string(), z.number()]).nullable().optional(),
  agentEmail: z.string().trim().max(320).optional(),
  agentName: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(100).optional(),
  direction: z.string().trim().max(50).optional(),
  state: z.string().trim().max(100).optional(),
  timestamp: z.number().finite().nullable().optional(),
  noteTimestamp: z.string().datetime({ offset: true }).optional(),
  durationSeconds: z.number().finite().nonnegative().optional(),
  ringingTimeSeconds: z.number().finite().nonnegative().optional(),
  holdTimeSeconds: z.number().finite().nonnegative().optional(),
  waitingTimeSeconds: z.number().finite().nonnegative().optional(),
  handlingTimeSeconds: z.number().finite().nonnegative().optional(),
  summary: z.string().max(100_000).optional(),
  summaryLanguage: z.string().trim().max(30).optional(),
  transcription: z.string().max(500_000).optional(),
  segments: z.array(segmentSchema).max(5_000).optional(),
  sentiment: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().max(300)).max(200).optional(),
  matchStatus: z.enum(["matched", "unmatched", "ambiguous"]).optional(),
  hubspotContactId: z.string().trim().max(100).optional(),
  contactName: z.string().trim().max(500).optional(),
  contactEmail: z.string().trim().max(320).optional(),
  contactPhone: z.string().trim().max(100).optional(),
  contactMobilePhone: z.string().trim().max(100).optional(),
  contactMatchScore: z.number().finite().nonnegative().optional(),
  hubspotNoteStatus: z.enum(["not_applicable", "pending", "synced", "already_synced", "failed"]).optional(),
  hubspotNoteId: z.string().trim().max(100).nullable().optional(),
});

function secureEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: NextRequest) {
  const expected = process.env.MAQSAM_INGEST_SECRET?.trim();
  if (!expected) return false;
  const direct = request.headers.get("x-maqsam-ingest-secret")?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const supplied = direct || bearer;
  return Boolean(supplied && secureEqual(supplied, expected));
}

function dateOnly(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return value;
}

function recordDate(record: MaqsamCallRecord) {
  if (record.noteTimestamp) return record.noteTimestamp.slice(0, 10);
  if (record.timestamp) return new Date(record.timestamp * 1000).toISOString().slice(0, 10);
  return "";
}

export async function GET(request: NextRequest) {
  const from = dateOnly(request.nextUrl.searchParams.get("from") ?? undefined);
  const to = dateOnly(request.nextUrl.searchParams.get("to") ?? undefined);
  const status = request.nextUrl.searchParams.get("matchStatus")?.trim().toLowerCase() ?? "";
  const query = request.nextUrl.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? 1000);
  const limit = Math.min(5000, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 1000));

  const allCalls = await listMaqsamCalls();
  const calls = allCalls.filter((record) => {
    const day = recordDate(record);
    if (from && day && day < from) return false;
    if (to && day && day > to) return false;
    if (status && record.matchStatus !== status) return false;
    if (query) {
      const haystack = [
        record.callKey,
        record.callId,
        record.referenceId,
        record.agentName,
        record.agentEmail,
        record.phone,
        record.contactName,
        record.contactEmail,
        record.summary,
        record.transcription,
      ].map((value) => String(value ?? "").toLowerCase()).join(" ");
      if (!haystack.includes(query)) return false;
    }
    return true;
  }).slice(0, limit);

  return NextResponse.json({
    meta: {
      generatedAt: new Date().toISOString(),
      totalStored: allCalls.length,
      portalId: process.env.HUBSPOT_PORTAL_ID ?? "145742477",
    },
    calls,
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized Maqsam ingest request" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "Invalid Maqsam call payload",
      details: parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; "),
    }, { status: 400 });
  }

  const record = await upsertMaqsamCall(parsed.data);
  return NextResponse.json({ status: "upserted", call: record });
}
