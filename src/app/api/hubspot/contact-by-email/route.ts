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

    const requestedEmail = parsed.data.email;
    const matches = await searchAll(
      "contacts",
      CONTACT_LOOKUP_PROPERTIES,
      [{ propertyName: "email", operator: "EQ", value: requestedEmail }],
    );

    const contact = matches.find(
      (record) => String(record.properties.email ?? "").trim().toLowerCase() === requestedEmail,
    ) ?? matches[0];

    if (!contact) {
      return NextResponse.json({
        contact: {
          id: `external:${requestedEmail}`,
          hubspotId: null,
          name: requestedEmail,
          email: requestedEmail,
          company: "",
          url: "",
          inHubSpot: false,
        },
      });
    }

    const email = String(contact.properties.email ?? requestedEmail).trim().toLowerCase();
    const name = [contact.properties.firstname, contact.properties.lastname]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ") || email;
    const hubspotId = String(contact.id);

    return NextResponse.json({
      contact: {
        id: hubspotId,
        hubspotId,
        name,
        email,
        company: String(contact.properties.company ?? "").trim(),
        url: hubspotRecordUrl("contact", hubspotId),
        inHubSpot: true,
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
