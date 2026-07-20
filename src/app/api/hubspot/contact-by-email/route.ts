import { NextResponse } from "next/server";
import { z } from "zod";
import { hubspotRecordUrl } from "@/lib/config";
import { HubSpotApiError, searchAll } from "@/lib/hubspot";

export const runtime = "nodejs";

const requestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
});

const CONTACT_LOOKUP_PROPERTIES = ["firstname", "lastname", "email", "company"] as const;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid contact email." }, { status: 400 });
    }

    const matches = await searchAll(
      "contacts",
      CONTACT_LOOKUP_PROPERTIES,
      [{ propertyName: "email", operator: "EQ", value: parsed.data.email }],
    );

    const contact = matches.find(
      (record) => String(record.properties.email ?? "").toLowerCase() === parsed.data.email,
    ) ?? matches[0];

    if (!contact) {
      return NextResponse.json({ error: "No HubSpot contact was found with this email." }, { status: 404 });
    }

    const email = String(contact.properties.email ?? parsed.data.email).trim();
    const name = [contact.properties.firstname, contact.properties.lastname]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ") || email;

    return NextResponse.json({
      contact: {
        id: String(contact.id),
        name,
        email,
        company: String(contact.properties.company ?? "").trim(),
        url: hubspotRecordUrl("contact", String(contact.id)),
      },
    });
  } catch (error) {
    if (error instanceof HubSpotApiError) {
      return NextResponse.json(
        { error: "Unable to search HubSpot contacts right now." },
        { status: error.status >= 400 && error.status < 600 ? error.status : 502 },
      );
    }

    console.error("HubSpot contact email lookup failed", error);
    return NextResponse.json({ error: "Unable to search HubSpot contacts right now." }, { status: 500 });
  }
}
