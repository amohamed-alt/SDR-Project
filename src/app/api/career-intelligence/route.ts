import { NextRequest, NextResponse } from "next/server";
import { getCareerPortfolio, summarizeCareerPortfolio, type CareerStatus } from "@/lib/career-intelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<CareerStatus>([
  "needs_research",
  "processing",
  "found_verified",
  "no_public_career_page",
  "needs_manual_review",
  "website_domain_invalid",
  "insufficient_company_data",
]);

export async function GET(request: NextRequest) {
  try {
    const companies = await getCareerPortfolio(request.nextUrl.searchParams.get("refresh") === "1");
    const query = (request.nextUrl.searchParams.get("q") || "").trim().toLowerCase();
    const requestedStatus = request.nextUrl.searchParams.get("status") || "";
    const status = VALID_STATUSES.has(requestedStatus as CareerStatus) ? requestedStatus as CareerStatus : "";
    const pageSize = Math.max(10, Math.min(200, Number(request.nextUrl.searchParams.get("pageSize") || 50)));
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));

    const filtered = companies.filter((company) => {
      if (status && company.status !== status) return false;
      if (!query) return true;
      return [company.companyName, company.domain, company.careerPageUrl, company.detectedAts, company.verificationReason]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });

    const offset = (page - 1) * pageSize;
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      summary: summarizeCareerPortfolio(companies),
      filters: { query, status },
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        pages: Math.max(1, Math.ceil(filtered.length / pageSize)),
      },
      companies: filtered.slice(offset, offset + pageSize),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Career Intelligence" }, { status: 500 });
  }
}
