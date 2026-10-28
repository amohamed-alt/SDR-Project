import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { batchRead } from "@/lib/hubspot";
import { commandCodeOutreach } from "@/lib/commandcode-outreach";
import { outreachBrand } from "@/lib/task-outreach";
import { originMatchesRequestHosts } from "@/lib/request-origin";
import { sdrAdminAuthorized } from "@/lib/sdr-admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({ contactId: z.string().regex(/^\d{1,30}$/) }).strict();
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  if (!sdrAdminAuthorized(request)) return NextResponse.json({ error: "Unlock SDR tools to generate messages." }, { status: 401, headers });
  const site = request.headers.get("sec-fetch-site");
  if ((site && !["same-origin", "same-site", "none"].includes(site)) || !originMatchesRequestHosts({ origin: request.headers.get("origin"), host: request.headers.get("host"), forwardedHost: request.headers.get("x-forwarded-host"), requestHost: request.nextUrl.host })) {
    return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403, headers });
  }
  if (process.env.DEMO_MODE === "true") return NextResponse.json({ error: "AI messages are disabled in demo mode." }, { status: 503, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid HubSpot contact ID is required." }, { status: 400, headers });
  let contact;
  try {
    [contact] = await batchRead("contacts", [parsed.data.contactId], ["firstname", "company", "jobtitle", "sdr_owner", "email"]);
  } catch {
    return NextResponse.json({ error: "HubSpot contact data is unavailable. Please retry." }, { status: 502, headers });
  }
  if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404, headers });
  if (/@(?:[a-z0-9-]+\.)*(?:bayt\.com|bayt\.net|talentera\.com|evalufy\.com)$/i.test(contact.properties.email || "")) return NextResponse.json({ error: "AI prospecting messages are for external prospects only." }, { status: 422, headers });
  const brand = outreachBrand(contact.properties.sdr_owner || "");
  if (!brand) return NextResponse.json({ error: "Contact must have a Talentera or Evalufy SDR owner before generating branded copy." }, { status: 422, headers });
  const clean = (value: unknown, max: number) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  const evidence = { contactId: contact.id, firstName: clean(contact.properties.firstname, 80), company: clean(contact.properties.company, 180), title: clean(contact.properties.jobtitle, 180), brand };
  if (!evidence.company || !evidence.title) return NextResponse.json({ error: "Add company and job title in HubSpot to generate relevant copy." }, { status: 422, headers });
  try {
    const result = await commandCodeOutreach(evidence);
    return NextResponse.json({ ...result, brand, evidence: { company: evidence.company, title: evidence.title }, language: "saudi-ar" }, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Message generation is unavailable.";
    // Only known application errors are safe to return; never return raw network errors.
    const safe = /^(CommandCode|AI output)/.test(message) ? message : "Message generation is unavailable. Please retry.";
    return NextResponse.json({ error: safe }, { status: /daily message limit/.test(message) ? 429 : 503, headers });
  }
}
