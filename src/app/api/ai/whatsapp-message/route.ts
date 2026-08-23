import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getHiringStore } from "@/lib/hiring-signals";
import { batchRead } from "@/lib/hubspot";
import { openRouterCompletion } from "@/lib/openrouter-low-cost";
import { originMatchesRequestHosts } from "@/lib/request-origin";
import {
  buildWhatsAppMobileUrl,
  buildWhatsAppWebUrl,
  deterministicWhatsAppMessage,
  isWhatsAppStyle,
  selectWhatsAppPhone,
  whatsappFallbackStyle,
  whatsappStyleLabel,
  type WhatsAppStyle,
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

type AiWhatsAppResult = {
  message: string;
  style: WhatsAppStyle;
  languageReason: string;
};

function clean(value: unknown, max = 600) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMessage(value: unknown, max = 520) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n")
    .trim()
    .slice(0, max);
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

function parseAiResult(raw: string): AiWhatsAppResult | null {
  const normalized = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    const message = cleanMessage(parsed.message, 520);
    const style = parsed.style;
    const languageReason = clean(parsed.languageReason, 220);
    if (message.length < 30 || !isWhatsAppStyle(style)) return null;
    return {
      message,
      style,
      languageReason: languageReason || "AI selected the communication style from the available profile cues.",
    };
  } catch {
    return null;
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
    const title = value(contact, "jobtitle");
    const fallbackStyle = whatsappFallbackStyle({ country, fullName, title });
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
      title,
      style: fallbackStyle,
      verifiedHiring,
    });

    const evidence = {
      firstName: value(contact, "firstname"),
      lastName: value(contact, "lastname"),
      fullName,
      title,
      persona: value(contact, "gtm_persona"),
      company: companyName,
      country,
      industry: company ? value(company, "gtm_industry") || value(company, "industry") : "",
      tier: value(contact, "gtm_icp_tier"),
      isFollowUp,
      verifiedHiring,
      detectedAts: company ? value(company, "detected_ats") : "",
      atsConfidence: company ? value(company, "ats_confidence") : "",
      fallbackStyle,
    };

    const system = [
      "You are the WhatsApp copy engine for a Talentera SDR. Write like a real salesperson typing a short personal message, never like marketing automation.",
      "Return ONLY valid JSON with exactly these keys: message, style, languageReason.",
      "style MUST be exactly one of: english, saudi-ar, emirati-ar, gulf-ar.",
      "Choose style from linguistic cues in the displayed name/title plus market context; do NOT infer or state nationality, ethnicity, religion, or citizenship.",
      "Country alone is NOT enough to choose Arabic. If the displayed profile is Latin-script/international and there is no strong Arabic-language cue, choose english even when the company is in KSA/UAE.",
      "If Arabic-language cues are strong: use saudi-ar for Saudi Arabia, emirati-ar for UAE, gulf-ar for Qatar/Kuwait/Bahrain/Oman. If uncertain, choose english.",
      "The message must feel one-to-one and curiosity-led. Do NOT use a reusable product-pitch structure such as 'Talentera helps recruitment teams streamline...' or 'I wanted to reach out regarding...'.",
      "Use a 3-part flow: human greeting, one relevant conversational question or observation, then a very light reason for asking plus permission-based CTA.",
      "For saudi-ar: sound like a professional Saudi SDR on WhatsApp. Prefer natural phrases such as 'السلام عليكم أستاذ {firstName} يعطيك العافية', 'بغيت أعرف', 'بغيت أسألك', 'كيف ماشي عندكم', 'هالفترة', 'إذا ودك أرسل لك الفكرة باختصار'. Do not force every phrase into every message and do not use exaggerated slang.",
      "For saudi-ar, avoid stiff MSA phrases such as 'أود التواصل معكم', 'يسرني', 'نود مشاركتكم', 'تحسين كفاءة عملية التوظيف', or formal brochure language.",
      "For emirati-ar: use warm professional UAE/Gulf WhatsApp Arabic, with natural phrases such as 'مرحبا أستاذ {firstName} يعطيك العافية', 'حبيت أسألك', and a light permission CTA. Avoid exaggerated slang.",
      "For gulf-ar: use neutral professional Gulf Arabic, conversational and short.",
      "For english: write like a real SDR. A natural pattern is 'Hi {firstName} — quick question.' followed by one specific operational question and a short permission CTA. Avoid corporate boilerplate.",
      "Personalize the actual question from the evidence. If verifiedHiring exists, you may say you saw hiring is active, but do not quote exact job counts unless needed. If no verifiedHiring exists, never imply that you saw active hiring or growth.",
      "Use the role/persona to make the question relevant, but do not awkwardly repeat a long job title.",
      "Do not mention the ATS vendor unless atsConfidence is explicitly high and the reference genuinely makes the opener better; never make the message feel creepy or over-researched.",
      "If isFollowUp is true, write a light follow-up and do not pretend it is a first touch.",
      "Use ONLY supplied business evidence. Never invent hiring volume, growth, technology, pain, budget, decision makers, intent, customers, or results.",
      "Keep the message easy to read on WhatsApp: preferably 2 or 3 short lines. No emojis, no links, no pricing, no buzzwords, and no more than one question mark.",
      "Mention Talentera lightly only after the conversational opener. The goal of message one is to get a reply, not explain the product.",
      "Keep the final message under 420 characters.",
      "languageReason must be short and only explain the linguistic routing, never personal identity attributes.",
    ].join(" ");

    let message = fallback;
    let style: WhatsAppStyle = fallbackStyle;
    let languageReason = fallbackStyle === "english"
      ? "No explicit Arabic-script profile cue was available, so the safe fallback is English."
      : `Arabic-script profile cues were present, routed to ${whatsappStyleLabel(fallbackStyle)}.`;
    let aiGenerated = false;
    let model = "deterministic-fallback";
    let cached = false;

    try {
      const fingerprint = JSON.stringify(evidence);
      const completion = await openRouterCompletion({
        cacheKey: `whatsapp-message-v3:${contact.id}:${fingerprint}`,
        system,
        user: `Write a human, attention-grabbing first WhatsApp message from this evidence object. The recipient should feel that an SDR wrote it specifically for them, not that it came from a campaign template.\n${JSON.stringify(evidence)}`,
        mode: "fast",
        maxOutputTokens: 220,
        temperature: 0.4,
      });
      const aiResult = parseAiResult(completion.content);
      if (aiResult) {
        message = aiResult.message;
        style = aiResult.style;
        languageReason = aiResult.languageReason;
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
      whatsappUrl: buildWhatsAppWebUrl(selectedPhone.digits, message),
      whatsappWebUrl: buildWhatsAppWebUrl(selectedPhone.digits, message),
      whatsappMobileUrl: buildWhatsAppMobileUrl(selectedPhone.digits, message),
      generation: {
        aiGenerated,
        model,
        cached,
        evidence: verifiedHiring ? "verified-hiring+crm" : "crm-only",
        languageReason,
      },
    }, { headers: { "Cache-Control": "private, no-store, max-age=0" } });
  } catch (error) {
    console.error("WhatsApp message generation failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "WhatsApp message generation failed." }, { status: 500 });
  }
}
