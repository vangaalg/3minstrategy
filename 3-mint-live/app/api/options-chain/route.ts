/**
 * GET /api/options-chain
 *
 * Diagnostic — fetches Nifty options chain for the nearest weekly expiry.
 */

import { NextResponse } from "next/server";
import { fetchNiftyOptionChain, nextNiftyWeeklyExpiry } from "@/lib/breeze";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const expiry = nextNiftyWeeklyExpiry();
    const chain = await fetchNiftyOptionChain(expiry);
    return NextResponse.json({
      ok: true,
      expiry,
      strike_count: chain.length,
      sample: chain.slice(0, 5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
