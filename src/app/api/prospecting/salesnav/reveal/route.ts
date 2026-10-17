import type { NextRequest } from "next/server";
import { POST as revealSalesNavPerson } from "../reveal-fast/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep older dashboard clients on the same identity, eligibility and durable
// credit reservation path. Optional company research remains deferred.
export async function POST(request: NextRequest) {
  return revealSalesNavPerson(request);
}
