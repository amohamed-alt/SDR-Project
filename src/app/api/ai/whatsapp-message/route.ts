import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getHiringStore } from "@/lib/hiring-signals";
import { batchRead } from "@/lib/hubspot";
import { openRouterCompletion } from "@/lib/openrouter-low-cost";
import { originMatchesRequestHosts } from "@/lib/request-origin";
import {
  buildWhatsAppUrl,
  deterministicWhatsAppMessage,
  selectWhatsAppPhone,
  whatsappStyleForCountry,
  whatsappStyleLabel,
} from "@/lib/whatsapp-outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  contactId: z.string().trim().min(1).max(120),
});

const CONTACT_FIELDS = [
  "firstname",
  "lastname",
  "phone",
  "mobilephone",
  "jobtitle",
  "company",
  "company_id",
  "country",
  "gtm_persona",
  "gtm_icp_tier",
  "notes_last_contacted",
  "phone_number_status",
] as const;

const COMPANY_FIELDS = [
  "name",
  "domain",
  "country",
  "gtm_country",
  "industry",
  "gtm_industry",
  "detected_ats",
  "ats_confidence",
  "career_page_url",
] as const;

function clean(value: unknown, max = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function value(record: { properties: Record<string, string | null | undefined> }, key: string) {
  return record.properties[key]?.trim() ?? "";
}

function sameOrigin(request: NextRequest) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && !["same-origin", "same-site", "none"].includes(secFetchSite)) return false;

  return originMatchesRequestHosts({
    origin: request.headers.get("origin"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    requestHost: request.nextUrl.host,
    extraHosts: [
      process.env.APP_URL,
      process.env.PUBLIC_APP_URL,
      process.env.NEXT_PUBLIC_APP_URL,
    ],
  });
}

function parseMessage(raw: string) {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const message = clean(parsed.message, 520);
    return message.length >= 30 ? message : "";
  } catch {
    return "";
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) {
      return NextResponse.json({ error: "Cross-site WhatsApp requests are not allowed." }, { status: 403 });
    }
    if (process.env.DEMO_MODE === "true") {
      return NextResponse.json({ error: "WhatsApp outreach is disabled in DEMO_MODE." }, { status: 503 });
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid WhatsApp message request", details: parsed.error.flatten() }, { status: 400 });
    }

    const [contact] = await batchRead("contacts", [parsed.data.contactId], CONTACT_FIELDS);
    if (!contact) return NextResponse.json({ error: "Contact not found in HubSpot." }, { status: 404 });

    const contactCountry = value(contact, "country");
    const selectedPhone = selectWhatsAppPhone({
      mobilephone: value(contact, "mobilephone"),
      phone: value(contact, "phone"),
      country: contactCountry,
    });

    if (!selectedPhone) {
      return NextResponse.json({
        error: "No WhatsApp-ready phone number could be normalized for this contact.",
        code: "no_whatsapp_number",
      }, { status: 422 });
    }

    const companyId = value(contact, "company_id");
    const [company] = companyId ? await batchRead("companies", [companyId], COMPANY_FIELDS) : [];
    const companyName = value(company ?? contact, "name") || value(contact, "company");
    const companyCountry = company ? value(company, "gtm_country") || value(company, "country") : "";
    const country = contactCountry || companyCountry;
    const fullName = [value(contact, "firstname"), value(contact, "lastname")].filter(Boolean).join(" ") || "Contact";
    const style = whatsappStyleForCountry(country);
    const isFollowUp = Boolean(value(contact, "notes_last_contacted"));

    let verifiedHiring: { activeJobs: number; newJobs30d: number; hiringScore: number } | null = null;
    if (companyId) {
      try {
        const hiringStore = await getHiringStore();
        const hiring = hiringStore.companies.find((item) => item.companyId === companyId);
        if (hiring?.scanStatus === "success" && hiring.activeJobs > 0) {
          verifiedHiring = {
            activeJobs: hiring.activeJobs,
            newJobs30d: hiring.newJobs30d,
            hiringScore: hiring.hiringScore,
          };
        }
      } catch {
        // Hiring Intelligence is optional. The message falls back to CRM-only evidence.
      }
    }

    const fallback = deterministicWhatsAppMessage({
      fullName,
      company: companyName,
      title: value(contact, "jobtitle"),
      style,
      verifiedHiring,
    });

    const evidence = {
      firstName: value(contact, "firstname"),
      fullName,
      title: value(contact, "jobtitle"),
      persona: value(contact, "gtm_persona"),
      company: companyName,
      country,
      industry: company ? value(company, "gtm_industry") || value(company, "industry") : "",
      tier: value(contact, "gtm_icp_tier"),
      isFollowUp,
      verifiedHiring,
      detectedAts: company ? value(company, "detected_ats") : "",
      atsConfidence: company ? value(company, "ats_confidence") : "",
    };

    const system = [
      "You write first-touch or follow-up WhatsApp outreach for Talentera SDRs.",
      `Use ${whatsappStyleLabel(style)}.`,
      "Use ONLY the supplied evidence. Never invent hiring volume, growth, technology, pain, budget, or intent.",
      "Mention hiring activity only when verifiedHiring is non-null.",
      "Do not mention a detected ATS unless it naturally improves the message and atsConfidence is explicitly high; otherwise omit it.",
      "Keep the message short, natural, professional, and suitable for a real WhatsApp conversation.",
      "No emojis, no links, no pricing, no exaggerated claims, no long introduction, and no corporate jargon.",
      "For Saudi Arabic, sound like professional Saudi business communication without caricature or excessive slang.",
      "For Emirati Arabic, use professional UAE/Gulf business language without caricature or excessive slang.",
      "For English, use concise natural B2B English.",
      "If isFollowUp is true, write it as a light follow-up rather than pretending this is the first contact.",
      "End with one low-friction question asking permission to share a short overview or idea.",
      "Return ONLY valid JSON with one key: message.",
      "Keep the final message under 500 characters.",
    ].join(" ");

    let message = fallback;
    let aiGenerated = false;
    let model = "deterministic-fallback";
    let cached = false;

    try {
      const fingerprint = JSON.stringify(evidence);
      const completion = await openRouterCompletion({
        cacheKey: `whatsapp-message:${contact.id}:${fingerprint}`,
        system,
        user: `Write the WhatsApp message from this evidence object:\n${JSON.stringify(evidence)}`,
        mode: "fast",
        maxOutputTokens: 180,
        temperature: 0.2,
      });
      const parsedMessage = parseMessage(completion.content);
      if (parsedMessage) {
        message = parsedMessage;
        aiGenerated = true;
        model = completion.model;
        cached = completion.cached;
      }
    } catch (error) {
      console.warn("WhatsApp AI generation fell back to deterministic copy", error);
    }

    return NextResponse.json({
      contact: {
        id: contact.id,
        name: fullName,
        company: companyName,
        country,
      },
      phone: {
        selected: selectedPhone.phone,
        source: selectedPhone.source,
        mobileLikely: selectedPhone.mobileLikely,
        alternate: selectedPhone.alternatePhone || "",
        alternateSource: selectedPhone.alternateSource || "",
      },
      message,
      style,
      whatsappUrl: buildWhatsAppUrl(selectedPhone.digits, message),
      generation: {
        aiGenerated,
        model,
        cached,
        evidence: verifiedHiring ? "verified-hiring+crm" : "crm-only",
      },
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("WhatsApp message generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "WhatsApp message generation failed." }, { status: 500 });
  }
}
