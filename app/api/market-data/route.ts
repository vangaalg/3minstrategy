/**
 * GET /api/market-data
 * Returns live quotes for VIX, USD/INR, Brent, Dow, Dow futures.
 * Frontend polls this every 60s independently from the scan.
 */

import { NextResponse } from "next/server";
import { fetchMarketData } from "@/lib/market-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const quotes = await fetchMarketData();
    return NextResponse.json({ ok: true, quotes, timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
