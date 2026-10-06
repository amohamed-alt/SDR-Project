import { NextRequest, NextResponse } from "next/server";
import { getMarketNews, NEWS_MARKETS, type NewsMarket } from "@/lib/market-news";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const market = request.nextUrl.searchParams.get("market") || "mena";
  if (!Object.hasOwn(NEWS_MARKETS, market)) return NextResponse.json({ error: "Choose a supported news market" }, { status: 400 });
  try { return NextResponse.json(await getMarketNews(market as NewsMarket), { headers: { "Cache-Control": "private, max-age=60" } }); }
  catch { return NextResponse.json({ error: "News is temporarily unavailable" }, { status: 503 }); }
}
