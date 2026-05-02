/**
 * POST /api/scan
 *
 * Body (optional JSON):
 *   { model?: "claude-sonnet-4-6" | "claude-opus-4-7", sessionToken?: string }
 *
 * Orchestrates a full 3-Mint scan:
 *   1. Fetch 1-min Nifty bars from Breeze (today's session up to now)
 *   2. Resample to 3-min bars
 *   3. Fetch nearest weekly option chain
 *   4. Send everything to Claude with prompt caching enabled
 *   5. Return structured signal JSON + token cost meta
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
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export async function POST(req: Request) {
  try {
    let body: {
      model?: string;
      sessionToken?: string;
      uploadedChain?: any[];        // OI screenshot upload override
      uploadedAt?: string;          // ISO timestamp
      preferUpload?: boolean;       // force-use upload even if Breeze works
    } = {};
    try { body = await req.json(); } catch { /* no body — defaults apply */ }

    const model: ClaudeModel =
      body.model === "claude-opus-4-7" ? "claude-opus-4-7" : "claude-sonnet-4-6";

    if (body.sessionToken && typeof body.sessionToken === "string") {
      process.env.BREEZE_SESSION_TOKEN = body.sessionToken.trim();
    }

    const now = new Date();
    const { fromISO, toISO } = getNSESessionRangeIST(now);

    const oneMinBars = await fetchNifty1MinBars(fromISO, toISO);
    if (oneMinBars.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No 1-min bars returned. Market may be closed or session token expired." },
        { status: 503 }
      );
    }

    const threeMinBars = resample1MinTo3Min(oneMinBars, true);
    const recentBars   = lastNBars(threeMinBars, 220);

    const expiry = nextNiftyWeeklyExpiry(now);
    const hasUpload = Array.isArray(body.uploadedChain) && body.uploadedChain.length > 0;

    // Fetch A/D and daily structure in parallel; options chain only if not using upload
    const optionChainPromise = (hasUpload && body.preferUpload)
      ? Promise.resolve([])  // skip Breeze fetch when user explicitly chose upload
      : fetchNiftyOptionChain(expiry).catch((err) => {
          console.error("Breeze options chain fetch failed:", err);
          return [];
        });

    const [optionChainResult, adResult, dailyResult] = await Promise.allSettled([
      optionChainPromise,
      fetchAdvanceDecline(),
      analyzeDailyStructure(threeMinBars),
    ]);

    let optionChain = optionChainResult.status === "fulfilled" ? optionChainResult.value : [];

    // OI screenshot fallback / override logic:
    //   - If user set preferUpload=true → always use upload (even if Breeze would work)
    //   - Else if Breeze returned empty/failed AND upload exists → use upload
    let usedUploadedChain = false;
    let chainSource: "breeze" | "upload" | "none" = "breeze";
    let uploadedAtUsed: string | null = null;

    if (hasUpload && (body.preferUpload || optionChain.length === 0)) {
      optionChain = body.uploadedChain!;
      usedUploadedChain = true;
      uploadedAtUsed = body.uploadedAt ?? null;
      chainSource = "upload";
    } else if (optionChain.length === 0) {
      chainSource = "none";
    }

    const adSnapshot: AdvanceDeclineSnapshot | null =
      adResult.status === "fulfilled" ? adResult.value : null;
    if (adResult.status === "rejected") {
      console.error("Advance/decline fetch failed (non-fatal):", adResult.reason);
    }

    const dailyStructure = dailyResult.status === "fulfilled" ? dailyResult.value : null;
    if (dailyResult.status === "rejected") {
      console.error("Daily structure analysis failed (non-fatal):", dailyResult.reason);
    }

    const spot = threeMinBars[threeMinBars.length - 1]?.close ?? 0;

    const { output: result, meta } = await runClaudeScan(
      {
        bars: recentBars,
        options_chain: optionChain,
        spot,
        vix: null,
        is_expiry_day: isThursdayIST(now),
        current_time_ist: formatISTTime(now),
      },
      model
    );

    // Compute confluence deterministically from Claude's output + A/D + daily structure
    const confluence = computeConfluence(result, adSnapshot, dailyStructure);

    // Propose a directional strangle (with daily-structure gates applied)
    const strangle = proposeStrangle(result, optionChain, confluence, expiry, now, dailyStructure);

    return NextResponse.json({
      ok: true,
      timestamp: now.toISOString(),
      bars_used: recentBars.length,
      total_3min_bars: threeMinBars.length,
      result,
      meta,
      confluence,
      advance_decline: adSnapshot,
      strangle,
      daily_structure: dailyStructure,
      chain_meta: {
        source: chainSource,
        used_uploaded: usedUploadedChain,
        uploaded_at: uploadedAtUsed,
        strikes_count: optionChain.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
