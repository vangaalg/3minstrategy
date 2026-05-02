/**
 * POST /api/scan
 *
 * Resilient scan orchestrator. Every external fetch is wrapped — one failure
 * never kills the response. The scan returns whatever it could compute,
 * with a `data_sources` field showing the health of each input.
 *
 * Body (optional JSON):
 *   {
 *     model?: "claude-sonnet-4-6" | "claude-opus-4-7",
 *     sessionToken?: string,
 *     uploadedChain?: any[],          // CSV or screenshot-parsed chain
 *     uploadedAt?: string,
 *     uploadSource?: "csv" | "screenshot",
 *     preferUpload?: boolean,
 *   }
 */

import { NextResponse } from "next/server";
import {
  fetchNifty1MinBars,
  fetchNiftyOptionChain,
  nextNiftyWeeklyExpiry,
  fetchAdvanceDecline,
  type AdvanceDeclineSnapshot,
} from "@/lib/breeze";
import { resample1MinTo3Min, lastNBars } from "@/lib/resample";
import { runClaudeScan } from "@/lib/claude";
import type { ClaudeModel } from "@/lib/claude";
import { computeConfluence } from "@/lib/confluence";
import { proposeStrangle } from "@/lib/strangle";
import { analyzeDailyStructure } from "@/lib/daily-structure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// Helpers
// ============================================================================

interface SourceStatus {
  name: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  count?: number;
}

function getNSESessionRangeIST(now: Date): { fromISO: string; toISO: string } {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(now.getTime() + istOffsetMs);
  const y = istDate.getUTCFullYear();
  const m = istDate.getUTCMonth();
  const d = istDate.getUTCDate();
  const fromUTC = new Date(Date.UTC(y, m, d, 3, 45, 0, 0));
  const sessionEndUTC = new Date(Date.UTC(y, m, d, 10, 0, 0, 0));
  const toUTC = now < sessionEndUTC ? now : sessionEndUTC;
  return {
    fromISO: fromUTC.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
    toISO:   toUTC.toISOString().replace(/\.\d{3}Z$/, ".000Z"),
  };
}

function isThursdayIST(now: Date): boolean {
  const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return istDate.getUTCDay() === 4;
}

function formatISTTime(now: Date): string {
  return now.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour12: false,
    hour: "2-digit", minute: "2-digit",
    day: "2-digit", month: "short", year: "numeric",
  });
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Wrap any async fetch so it never throws — returns [value, error]. */
async function safe<T>(p: Promise<T>): Promise<[T | null, string | null]> {
  try {
    const v = await p;
    return [v, null];
  } catch (e) {
    return [null, errMsg(e)];
  }
}

// ============================================================================
// Route
// ============================================================================

export async function POST(req: Request) {
  const now = new Date();
  const sources: SourceStatus[] = [];
  const warnings: string[] = [];

  try {
    // ── Parse body ───────────────────────────────────────────────────────
    let body: {
      model?: string;
      sessionToken?: string;
      uploadedChain?: any[];
      uploadedAt?: string;
      uploadSource?: "csv" | "screenshot";
      preferUpload?: boolean;
    } = {};
    try { body = await req.json(); } catch { /* no body */ }

    const model: ClaudeModel =
      body.model === "claude-opus-4-7" ? "claude-opus-4-7" : "claude-sonnet-4-6";

    if (body.sessionToken && typeof body.sessionToken === "string") {
      process.env.BREEZE_SESSION_TOKEN = body.sessionToken.trim();
    }

    const hasUpload = Array.isArray(body.uploadedChain) && body.uploadedChain.length > 0;
    const uploadSourceLabel = body.uploadSource === "csv" ? "csv" : "screenshot";

    // ── Fetch all data sources in parallel — none can crash the route ───
    const { fromISO, toISO } = getNSESessionRangeIST(now);
    const expiry = nextNiftyWeeklyExpiry(now);

    const [
      [oneMinBars, barsErr],
      [breezeChain, chainErr],
      [adSnap, adErr],
    ] = await Promise.all([
      safe(fetchNifty1MinBars(fromISO, toISO)),
      hasUpload && body.preferUpload
        ? Promise.resolve<[any[], string | null]>([[], null])
        : safe(fetchNiftyOptionChain(expiry)),
      safe(fetchAdvanceDecline()),
    ]);

    // ── 1-min bars status ──
    let threeMinBars: ReturnType<typeof resample1MinTo3Min> = [];
    let recentBars: typeof threeMinBars = [];
    if (oneMinBars && oneMinBars.length > 0) {
      threeMinBars = resample1MinTo3Min(oneMinBars, true);
      recentBars = lastNBars(threeMinBars, 220);
      sources.push({
        name: "Breeze 1-min bars",
        status: "ok",
        detail: `${oneMinBars.length} 1-min bars → ${threeMinBars.length} 3-min bars`,
        count: threeMinBars.length,
      });
    } else {
      const reason = barsErr ?? "no bars returned (market closed or session expired)";
      sources.push({ name: "Breeze 1-min bars", status: "failed", detail: reason });
      warnings.push("Strategies 1-3 require 3-min bars — they will be skipped");
    }

    // ── Daily structure (depends on Breeze daily fetch) ──
    let dailyStructure = null;
    if (recentBars.length > 0) {
      const [ds, dsErr] = await safe(analyzeDailyStructure(threeMinBars));
      if (ds) {
        dailyStructure = ds;
        sources.push({
          name: "Daily structure (5-day)",
          status: "ok",
          detail: `Regime: ${ds.regime} (${ds.regime_basis})`,
        });
      } else {
        sources.push({
          name: "Daily structure (5-day)",
          status: "failed",
          detail: dsErr ?? "unknown error",
        });
      }
    } else {
      sources.push({
        name: "Daily structure (5-day)",
        status: "skipped",
        detail: "needs Breeze 1-min bars",
      });
    }

    // ── Options chain — Breeze + upload override logic ──
    let optionChain: any[] = breezeChain ?? [];
    let chainSource: "breeze" | "upload" | "none" = "breeze";
    let uploadedAtUsed: string | null = null;

    if (chainErr || (breezeChain?.length ?? 0) === 0) {
      sources.push({
        name: "Breeze options chain",
        status: chainErr ? "failed" : "skipped",
        detail: chainErr ?? (hasUpload && body.preferUpload ? "skipped (preferUpload)" : "empty response"),
      });
    } else {
      sources.push({
        name: "Breeze options chain",
        status: "ok",
        detail: `${breezeChain.length} strikes`,
        count: breezeChain.length,
      });
    }

    if (hasUpload && (body.preferUpload || optionChain.length === 0)) {
      optionChain = body.uploadedChain!;
      uploadedAtUsed = body.uploadedAt ?? null;
      chainSource = "upload";
      sources.push({
        name: `Uploaded ${uploadSourceLabel}`,
        status: "ok",
        detail: `${optionChain.length} strikes${uploadedAtUsed ? ` · uploaded ${new Date(uploadedAtUsed).toLocaleTimeString("en-IN")}` : ""}`,
        count: optionChain.length,
      });
    } else if (optionChain.length === 0) {
      chainSource = "none";
      warnings.push("No options chain available — OI buildup, wall migration, and strangle proposals will be skipped");
    }

    // ── A/D status ──
    if (adSnap) {
      sources.push({
        name: "Advance/Decline (50 stocks)",
        status: "ok",
        detail: `${adSnap.advances}↑ / ${adSnap.declines}↓ / ${adSnap.unchanged}=`,
        count: adSnap.total - adSnap.errors,
      });
    } else {
      sources.push({
        name: "Advance/Decline (50 stocks)",
        status: "failed",
        detail: adErr ?? "unknown error",
      });
    }

    // ── Spot price determination ──
    // Priority: last 3-min bar > uploaded chain ATM > 0
    let spot = threeMinBars[threeMinBars.length - 1]?.close ?? 0;
    if (spot === 0 && optionChain.length > 0) {
      // Estimate spot from chain — strike where call_ltp ≈ put_ltp
      let bestStrike = 0;
      let minDiff = Infinity;
      for (const r of optionChain) {
        const cl = r.call_ltp ?? 0;
        const pl = r.put_ltp ?? 0;
        if (cl > 0 && pl > 0) {
          const diff = Math.abs(cl - pl);
          if (diff < minDiff) { minDiff = diff; bestStrike = r.strike_price; }
        }
      }
      if (bestStrike > 0) {
        spot = bestStrike;
        warnings.push(`Spot estimated as ${spot} from option-chain ATM (no live bars available)`);
      }
    }

    // ── Decide if we should call Claude at all ──
    // Claude is most useful when we have either bars OR a chain.
    // If we have nothing, return early with the source status.
    if (recentBars.length === 0 && optionChain.length === 0) {
      return NextResponse.json({
        ok: true,
        degraded: true,
        timestamp: now.toISOString(),
        data_sources: sources,
        warnings: [...warnings, "No analyzable data — both Breeze bars and uploaded chain are unavailable"],
        result: null,
        meta: null,
        confluence: null,
        advance_decline: adSnap,
        strangle: null,
        daily_structure: dailyStructure,
        chain_meta: { source: "none", used_uploaded: false, uploaded_at: null, strikes_count: 0 },
      });
    }

    // ── Claude scan ──
    const [claudeRes, claudeErr] = await safe(runClaudeScan(
      {
        bars: recentBars,
        options_chain: optionChain,
        spot,
        vix: null,
        is_expiry_day: isThursdayIST(now),
        current_time_ist: formatISTTime(now),
      },
      model
    ));

    if (!claudeRes) {
      sources.push({ name: "Claude analysis", status: "failed", detail: claudeErr ?? "unknown" });
      return NextResponse.json({
        ok: true,
        degraded: true,
        timestamp: now.toISOString(),
        data_sources: sources,
        warnings: [...warnings, `Claude analysis failed: ${claudeErr}`],
        result: null,
        meta: null,
        confluence: null,
        advance_decline: adSnap,
        strangle: null,
        daily_structure: dailyStructure,
        chain_meta: {
          source: chainSource,
          used_uploaded: chainSource === "upload",
          uploaded_at: uploadedAtUsed,
          strikes_count: optionChain.length,
        },
      });
    }

    sources.push({
      name: "Claude analysis",
      status: "ok",
      detail: `${model} · ${claudeRes.meta.input_tokens.toLocaleString()} in / ${claudeRes.meta.output_tokens.toLocaleString()} out · $${claudeRes.meta.estimated_cost_usd.toFixed(5)}`,
    });

    const result = claudeRes.output;
    const meta = claudeRes.meta;

    // ── Deterministic post-processing ──
    const confluence = computeConfluence(result, adSnap, dailyStructure);
    const strangle   = proposeStrangle(result, optionChain, confluence, expiry, now, dailyStructure);

    const degraded = sources.some((s) => s.status === "failed");

    return NextResponse.json({
      ok: true,
      degraded,
      timestamp: now.toISOString(),
      bars_used: recentBars.length,
      total_3min_bars: threeMinBars.length,
      data_sources: sources,
      warnings,
      result,
      meta,
      confluence,
      advance_decline: adSnap,
      strangle,
      daily_structure: dailyStructure,
      chain_meta: {
        source: chainSource,
        used_uploaded: chainSource === "upload",
        uploaded_at: uploadedAtUsed,
        strikes_count: optionChain.length,
      },
    });
  } catch (err) {
    // Catch-all — should rarely fire because we wrap each fetch
    return NextResponse.json({
      ok: false,
      error: errMsg(err),
      data_sources: sources,
      warnings,
    }, { status: 500 });
  }
}
