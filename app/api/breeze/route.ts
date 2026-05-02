/**
 * GET /api/breeze
 *
 * Diagnostic endpoint — fetches raw 1-min Nifty bars + resampled 3-min bars
 * without calling Claude. Useful for verifying Breeze auth and resampling
 * before burning Claude tokens.
 */

import { NextResponse } from "next/server";
import { fetchNifty1MinBars } from "@/lib/breeze";
import { resample1MinTo3Min } from "@/lib/resample";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const now = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffsetMs);
    const y = istDate.getUTCFullYear();
    const m = istDate.getUTCMonth();
    const d = istDate.getUTCDate();
    const fromUTC = new Date(Date.UTC(y, m, d, 3, 45, 0, 0));
    const sessionEndUTC = new Date(Date.UTC(y, m, d, 10, 0, 0, 0));
    const toUTC = now < sessionEndUTC ? now : sessionEndUTC;

    const fromISO = fromUTC.toISOString().replace(/\.\d{3}Z$/, ".000Z");
    const toISO = toUTC.toISOString().replace(/\.\d{3}Z$/, ".000Z");

    const oneMin = await fetchNifty1MinBars(fromISO, toISO);
    const threeMin = resample1MinTo3Min(oneMin, true);

    return NextResponse.json({
      ok: true,
      from: fromISO,
      to: toISO,
      one_min_count: oneMin.length,
      three_min_count: threeMin.length,
      first_3min: threeMin[0] ?? null,
      last_3min: threeMin[threeMin.length - 1] ?? null,
      sample_3min: threeMin.slice(-5),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
