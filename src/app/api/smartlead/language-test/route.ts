import { NextRequest, NextResponse } from "next/server";
import { decideRecipientLanguage, senderBrand } from "@/lib/recipient-language-routing";
import { getSmartleadCommandCenter } from "@/lib/smartlead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function boundedLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

export async function GET(request: NextRequest) {
  try {
    const limit = boundedLimit(request.nextUrl.searchParams.get("limit"));
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    const data = await getSmartleadCommandCenter(refresh);
    const ready = data.queue.filter((lead) => lead.eligible).slice(0, limit);

    const samples = ready.map((lead) => {
      const decision = decideRecipientLanguage({
        firstName: lead.firstName,
        fullName: lead.fullName,
        country: lead.country,
      });
      return {
        contactId: lead.contactId,
        companyId: lead.companyId,
        companyName: lead.companyName,
        email: lead.email,
        title: lead.title,
        country: lead.country,
        originalFirstName: decision.originalFirstName,
        greetingName: decision.greetingName,
        locale: decision.locale,
        confidence: decision.confidence,
        translated: decision.translated,
        reason: decision.reason,
      };
    });

    const localeCounts = samples.reduce<Record<string, number>>((accumulator, sample) => {
      accumulator[sample.locale] = (accumulator[sample.locale] || 0) + 1;
      return accumulator;
    }, {});

    const translatedCount = samples.filter((sample) => sample.translated).length;
    const lowConfidence = samples.filter((sample) => sample.confidence < 0.9).length;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      mode: "READ_ONLY_LANGUAGE_QA",
      productionSendingChanged: false,
      sampled: samples.length,
      localeCounts,
      translatedCount,
      lowConfidence,
      samples,
      senderBrands: data.senders.map((sender) => ({
        id: sender.id,
        email: sender.email,
        brand: senderBrand(sender.email),
        assigned: sender.assigned,
        warmupEnabled: sender.warmupEnabled,
      })),
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      error: "Unable to build recipient language QA sample",
      details: error instanceof Error ? error.message : "Unknown error",
    }, { status: 500 });
  }
}
