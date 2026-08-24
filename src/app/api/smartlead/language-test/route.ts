import { NextRequest, NextResponse } from "next/server";
import { decideRecipientLanguage } from "@/lib/recipient-language-routing";
import { getSmartleadRoutingSnapshot } from "@/lib/smartlead-v2";
import { VISIBLE_SEQUENCE_LANES, laneFor } from "@/lib/smartlead-visible-sequences";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

function boundedLimit(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function maskedEmail(value: string) {
  const [local, domain] = String(value || "").trim().toLowerCase().split("@");
  if (!local || !domain) return "invalid-email";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function GET(request: NextRequest) {
  try {
    const limit = boundedLimit(request.nextUrl.searchParams.get("limit"));
    const refresh = request.nextUrl.searchParams.get("refresh") === "1";
    let data: Awaited<ReturnType<typeof getSmartleadRoutingSnapshot>> | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        data = await getSmartleadRoutingSnapshot(refresh && attempt === 0);
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
    if (!data) throw lastError instanceof Error ? lastError : new Error("Routing snapshot failed after retries.");
    const ready = data.queue.filter((lead) => lead.eligible).slice(0, limit);

    const samples = ready.map((lead) => {
      const decision = decideRecipientLanguage({
        firstName: lead.firstName,
        lastName: lead.lastName,
        fullName: lead.fullName,
        country: lead.country,
      });
      const lane = laneFor(lead.product, decision.locale);
      return {
        contactId: lead.contactId,
        companyId: lead.companyId,
        companyName: lead.companyName,
        email: maskedEmail(lead.email),
        title: lead.title,
        country: lead.country,
        product: lead.product === "evalify" ? "Evalufy" : "Talentera",
        productReason: lead.productReason,
        lane,
        campaign: VISIBLE_SEQUENCE_LANES[lane].campaignName,
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
    const laneCounts = samples.reduce<Record<string, number>>((accumulator, sample) => {
      accumulator[sample.lane] = (accumulator[sample.lane] || 0) + 1;
      return accumulator;
    }, {});

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      mode: "READ_ONLY_ROUTING_DRY_RUN",
      productionSendingChanged: false,
      sampled: samples.length,
      localeCounts,
      laneCounts,
      translatedCount,
      lowConfidence,
      samples,
      senderPools: {
        talentera: data.senders.filter((sender) => sender.eligible && sender.brand === "talentera").length,
        evalufy: data.senders.filter((sender) => sender.eligible && sender.brand === "evalify").length,
      },
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
