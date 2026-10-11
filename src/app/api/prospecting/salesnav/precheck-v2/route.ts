import { NextRequest, NextResponse } from "next/server";
import { POST as basePrecheck } from "@/app/api/prospecting/signalhire/precheck/route";

import { batchRead, readCompleteAssociations } from "@/lib/hubspot";
import { scanSalesNavCompany, salesNavGate } from "@/lib/salesnav-company-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JsonObject = Record<string, unknown>;

async function jsonFrom(response: Response) {
  const text = await response.text();
  if (!text.trim()) return {} as JsonObject;
  try { return JSON.parse(text) as JsonObject; }
  catch { throw new Error(`HubSpot precheck returned non-JSON: ${text.slice(0, 180)}`); }
}

const scans = new Map<string, { expiresAt: number; value: ReturnType<typeof scanSalesNavCompany> }>();
function scan(id: string, fresh: boolean) {
  const cached = scans.get(id);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const value = scanSalesNavCompany(id, { associations: readCompleteAssociations, records: batchRead });
  if (!fresh) {
    if (scans.size > 1000) scans.clear();
    scans.set(id, { value, expiresAt: Date.now() + 60_000 });
    void value.catch(() => scans.delete(id));
  }
  return value;
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

    if (company.inHubSpot && company.id) {
      try {
        Object.assign(company, await scan(String(company.id), body.fresh === true));
        company.engagementError = "";
      } catch (error) {
        company.engagementChecked = false;
        company.engagementError = error instanceof Error ? error.message : "Company scan failed.";
      }
    }
    const hasIdentity = Boolean(String(body.company || body.companyDomain || body.companyWebsite || "").trim());
    const reason = salesNavGate(contact, company, hasIdentity);
    company.protected = Boolean(reason);
    company.protectedReason = reason;
    company.gateReason = reason || (company.inHubSpot ? "Existing company · no connected call, meeting or protected deal" : "Net-new company");

    return NextResponse.json({
      ...payload,
      contact,
      company,
      policy: {
        readyPerson: "net-new-only",
        retention: "blocked",
        meeting: "blocked",
        retentionDeal: "blocked",
        openDeal: "blocked",
        connectedCallWithoutMeeting: "blocked",
        existingCompanyNoCommunication: "eligible",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sales Nav v2 HubSpot gate failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sales Nav HubSpot gate failed." }, { status: 500 });
  }
}
