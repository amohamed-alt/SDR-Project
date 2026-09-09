import { NextRequest, NextResponse } from "next/server";
import { POST as basePrecheck } from "@/app/api/prospecting/signalhire/precheck/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

async function jsonFrom(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {} as JsonObject;
  try { return JSON.parse(text) as JsonObject; }
  catch { throw new Error(`HubSpot precheck returned non-JSON: ${text.slice(0, 180)}`); }
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const forwarded = new NextRequest(new URL("/api/prospecting/signalhire/precheck", request.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = await basePrecheck(forwarded);
    const payload = await jsonFrom(response);
    if (!response.ok) {
      return NextResponse.json(payload, { status: response.status, headers: { "Cache-Control": "no-store" } });
    }

    const contact = (payload.contact && typeof payload.contact === "object" ? payload.contact : {}) as JsonObject;
    const rawCompany = (payload.company && typeof payload.company === "object" ? payload.company : {}) as JsonObject;
    const company: JsonObject = { ...rawCompany };

    const existingPerson = Boolean(contact.inHubSpot);
    const companyExists = Boolean(company.inHubSpot);
    const retention = normalize(company.accountType) === "retention";
    const meetingCount = Math.max(0, Number(company.meetingCount || 0) || 0);
    const connectedCallCount = Math.max(0, Number(company.connectedCallCount || 0) || 0);
    const communicationUnknown = companyExists && company.engagementChecked === false;

    // Ready-to-Push policy requested by Abdullah:
    // 1) Person must be net-new in HubSpot.
    // 2) Retention companies are always excluded.
    // 3) Any meaningful meeting blocks the company.
    // 4) Connected calls WITHOUT a meeting remain eligible, regardless of age.
    // 5) Existing company with no call/meeting is eligible.
    if (existingPerson) {
      company.protected = true;
      company.protectedReason = `Existing HubSpot person${contact.matchedBy ? ` · matched by ${String(contact.matchedBy)}` : ""} — Ready to Push is for net-new people only.`;
      company.gateReason = "Existing person blocked";
    } else if (retention) {
      company.protected = true;
      company.protectedReason = "Retention account — excluded from acquisition / SDR prospecting.";
      company.gateReason = "Retention blocked";
    } else if (meetingCount > 0) {
      company.protected = true;
      company.protectedReason = `${meetingCount} existing meeting${meetingCount === 1 ? "" : "s"} — do not push another SDR prospect from this search.`;
      company.gateReason = "Meeting blocked";
    } else if (communicationUnknown) {
      company.protected = true;
      company.protectedReason = String(company.engagementError || company.protectedReason || "Company communication could not be verified. Review before Push.");
      company.gateReason = "Communication check incomplete";
    } else {
      company.protected = false;
      company.protectedReason = "";
      if (!companyExists) {
        company.gateReason = "Net-new company";
      } else if (connectedCallCount > 0) {
        const age = company.connectedCallAgeDays === null || company.connectedCallAgeDays === undefined ? "" : ` · latest ${String(company.connectedCallAgeDays)}d ago`;
        company.gateReason = `Connected call allowed · no meeting${age}`;
      } else {
        company.gateReason = "Existing company · no connected call or meeting";
      }
    }

    return NextResponse.json({
      ...payload,
      contact,
      company,
      policy: {
        readyPerson: "net-new-only",
        retention: "blocked",
        meeting: "blocked",
        connectedCallWithoutMeeting: "eligible",
        existingCompanyNoCommunication: "eligible",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sales Nav v2 HubSpot gate failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav HubSpot gate failed." }, { status: 500 });
  }
}
