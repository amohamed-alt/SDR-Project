import { NextRequest, NextResponse } from "next/server";
import { pushCareerResult, setCareerReview } from "@/lib/career-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as {
      companyId?: string;
      action?: "approve" | "reject" | "push";
      careerPageUrl?: string;
    };
    const companyId = String(body.companyId || "").trim();
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 });

    if (body.action === "push") {
      const company = await pushCareerResult(companyId);
      return NextResponse.json({ company }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "approve" || body.action === "reject") {
      const company = await setCareerReview(companyId, body.action, body.careerPageUrl);
      return NextResponse.json({ company }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "action must be approve, reject, or push" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Career action failed" }, { status: 500 });
  }
}
