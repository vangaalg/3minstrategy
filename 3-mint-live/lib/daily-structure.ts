/**
 * Daily structure analyzer.
 *
 * Pulls last 6-7 daily bars for Nifty (we need 6 to compare 5 day-over-day comparisons,
 * 7 if we want to include today). Classifies the multi-day regime using:
 *   - Yesterday's HH/HL vs day-before-yesterday (PRIMARY signal — weighted ~2x)
 *   - 5-day pattern of HH/HL vs LH/LL (CONTEXT signal)
 *
 * Also computes:
 *   - Today's intraday H/L (from the 3-min bars passed in)
 *   - Whether today is breaching yesterday's H or L (or both = outside bar)
 *   - Opening range (first 15-min, i.e. first five 3-min bars from 09:15 IST)
 *   - Opening range midpoint (the user's pivot for outside-bar days)
 */

import { fetchNifty1MinBars } from "./breeze";
import type { ThreeMinBar } from "./resample";

export interface DailyBar {
  date: string;       // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  // Day-over-day flags vs the PREVIOUS daily bar
  hh: boolean | null; // higher high than prev day (null on the earliest bar)
  hl: boolean | null;
  lh: boolean | null;
  ll: boolean | null;
}

export type DailyRegime =
  | "BULLISH"
  | "BEARISH"
  | "UNCERTAIN"        // outside bar — today breaks both yesterday's H and L
  | "REVERSAL_FORMING" // mixed pattern across last 5 days
  | "CHOPPY";

export interface OpeningRange {
  high: number;
  low: number;
  mid: number;
  open_price: number;
  bars_used: number; // typically 5 (first 15 min on a 3-min chart)
}

export interface TodayBreach {
  prev_day_high: number | null;
  prev_day_low: number | null;
  today_high: number | null;
  today_low: number | null;
  above_prev_high: boolean;
  below_prev_low: boolean;
  is_outside_bar: boolean;     // both true
  is_inside_bar: boolean;      // neither true (today still inside yesterday's range)
}

export interface DailyStructureSnapshot {
  regime: DailyRegime;
  regime_label: string;        // human-readable
  regime_score: number;        // -3..+3 — feeds the confluence as one signal source
  yesterday_signal: "HH+HL" | "HH+LL_outside" | "LH+HL_inside" | "LH+LL" | "MIXED" | "UNKNOWN";

  // Last 5 day-over-day stats (excluding today)
  hh_count: number;
  hl_count: number;
  lh_count: number;
  ll_count: number;
  total_compared: number;      // = 5 in the standard case

  // Daily bars
  bars_completed: DailyBar[];  // last 5 completed sessions
  bars_with_today: DailyBar[]; // same + today's live bar at the end

  // Today's breach analysis
  today_breach: TodayBreach;

  // Opening range
  opening_range: OpeningRange | null;

  // Trader's pivot (the actionable level for the day)
  pivot: {
    type: "OPENING_RANGE_MID" | "PRIOR_DAY_HIGH" | "PRIOR_DAY_LOW" | "PRIOR_DAY_CLOSE";
    value: number | null;
    rationale: string;
  };
}

// ──────────────────────────────────────────────────────────────────────────────

/**
 * Fetch last N completed daily Nifty bars from Breeze.
 * Uses interval=1day on the historicalcharts endpoint.
 */
async function fetchDailyBars(daysBack: number = 10): Promise<DailyBar[]> {
  const now = new Date();
  const fromDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);

  const fromISO = fromDate.toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const toISO   = now.toISOString().replace(/\.\d{3}Z$/, ".000Z");

  // Reuse the 1-min fetcher pattern but with interval=1day
  // Note: we can't use fetchNifty1MinBars directly because interval is hardcoded.
  // Instead we call breezeRequest via a tiny helper here — but to avoid duplicating
  // auth code, we re-export a daily fetcher from breeze.ts (added below).
  const { fetchNiftyDailyBars } = await import("./breeze");
  const raw = await fetchNiftyDailyBars(fromISO, toISO);

  return raw.map((b) => ({
    date: b.datetime.slice(0, 10),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    hh: null, hl: null, lh: null, ll: null,
  }));
}

/** Annotate each bar with day-over-day HH/HL/LH/LL flags vs the previous bar. */
function annotateDayOverDay(bars: DailyBar[]): DailyBar[] {
  return bars.map((bar, i) => {
    if (i === 0) return bar;
    const prev = bars[i - 1];
    return {
      ...bar,
      hh: bar.high > prev.high,
      hl: bar.low  > prev.low,
      lh: bar.high < prev.high,
      ll: bar.low  < prev.low,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Regime classification — yesterday gets 2x weight, 5-day pattern is context
// ──────────────────────────────────────────────────────────────────────────────

function classifyRegime(
  bars: DailyBar[],
  todayBreach: TodayBreach
): { regime: DailyRegime; label: string; score: number; yesterday_signal: DailyStructureSnapshot["yesterday_signal"] } {
  // Outside-bar override: today is breaching both yesterday's H and L
  if (todayBreach.is_outside_bar) {
    return {
      regime: "UNCERTAIN",
      label: "Uncertain — outside bar in progress",
      score: 0,
      yesterday_signal: "MIXED",
    };
  }

  if (bars.length < 2) {
    return { regime: "CHOPPY", label: "Insufficient daily history", score: 0, yesterday_signal: "UNKNOWN" };
  }

  const yesterday = bars[bars.length - 1];
  const dayBefore = bars[bars.length - 2];

  // Yesterday's signal vs the day before
  let ySig: DailyStructureSnapshot["yesterday_signal"] = "MIXED";
  const yHH = yesterday.high > dayBefore.high;
  const yHL = yesterday.low  > dayBefore.low;
  const yLH = yesterday.high < dayBefore.high;
  const yLL = yesterday.low  < dayBefore.low;

  if (yHH && yHL)  ySig = "HH+HL";
  else if (yLH && yLL)  ySig = "LH+LL";
  else if (yHH && yLL)  ySig = "HH+LL_outside";   // yesterday was already an outside day
  else if (yLH && yHL)  ySig = "LH+HL_inside";    // yesterday was an inside day

  // Count HH/HL/LH/LL across the last 5 day-over-day comparisons
  const recent = bars.slice(-5);
  let hh = 0, hl = 0, lh = 0, ll = 0;
  for (const b of recent) {
    if (b.hh)  hh++;
    if (b.hl)  hl++;
    if (b.lh)  lh++;
    if (b.ll)  ll++;
  }
  const total = recent.filter((b) => b.hh !== null).length;

  // Score yesterday (weight 2): +2 for HH+HL, -2 for LH+LL, 0 for in/outside
  let yWeight = 0;
  if (ySig === "HH+HL")        yWeight = 2;
  else if (ySig === "LH+LL")   yWeight = -2;
  else if (ySig === "LH+HL_inside") yWeight = 0;
  else if (ySig === "HH+LL_outside") yWeight = 0;

  // Score 5-day count (weight 1): +1 if HH+HL dominates, -1 if LH+LL dominates
  let cntWeight = 0;
  const bullishDays = Math.min(hh, hl); // a day counts as bullish if it had BOTH HH and HL
  const bearishDays = Math.min(lh, ll);
  if (bullishDays >= 3 && bullishDays > bearishDays) cntWeight = 1;
  else if (bearishDays >= 3 && bearishDays > bullishDays) cntWeight = -1;

  const score = yWeight + cntWeight; // range -3..+3

  // Final regime classification
  let regime: DailyRegime;
  let label: string;

  if (score >= 2) {
    regime = "BULLISH";
    if (score === 3) label = `Strong bullish — yesterday HH+HL, ${bullishDays}/${total} days bullish`;
    else label = `Bullish — yesterday HH+HL`;
  } else if (score <= -2) {
    regime = "BEARISH";
    if (score === -3) label = `Strong bearish — yesterday LH+LL, ${bearishDays}/${total} days bearish`;
    else label = `Bearish — yesterday LH+LL`;
  } else if (ySig === "LH+HL_inside") {
    // Yesterday was an inside day — coiling, often precedes a breakout
    regime = "REVERSAL_FORMING";
    label = "Inside day yesterday — coiling, breakout pending";
  } else if (ySig === "HH+LL_outside") {
    // Yesterday was an outside day → use opening-range pivot (user's rule)
    regime = "UNCERTAIN";
    label = "Outside day yesterday — trade off opening range midpoint";
  } else {
    regime = "CHOPPY";
    label = `Choppy — ${bullishDays} bull / ${bearishDays} bear days, no clear structure`;
  }

  return { regime, label, score, yesterday_signal: ySig };
}

// ──────────────────────────────────────────────────────────────────────────────
// Today's intraday H/L from 3-min bars
// ──────────────────────────────────────────────────────────────────────────────

function buildTodayBar(threeMinBars: ThreeMinBar[]): { high: number; low: number; open: number; close: number } | null {
  if (threeMinBars.length === 0) return null;
  // Filter for today's bars only (UTC date matches today's IST date)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayIST = new Date(Date.now() + istOffset).toISOString().slice(0, 10);
  const todayBars = threeMinBars.filter((b) => {
    const barIST = new Date(new Date(b.datetime).getTime() + istOffset).toISOString().slice(0, 10);
    return barIST === todayIST;
  });
  if (todayBars.length === 0) return null;
  return {
    open:  todayBars[0].open,
    close: todayBars[todayBars.length - 1].close,
    high:  Math.max(...todayBars.map((b) => b.high)),
    low:   Math.min(...todayBars.map((b) => b.low)),
  };
}

function computeBreach(
  today: { high: number; low: number } | null,
  prevHigh: number | null,
  prevLow: number | null
): TodayBreach {
  const todayHigh = today?.high ?? null;
  const todayLow  = today?.low  ?? null;
  const above = todayHigh != null && prevHigh != null && todayHigh > prevHigh;
  const below = todayLow  != null && prevLow  != null && todayLow  < prevLow;
  return {
    prev_day_high: prevHigh,
    prev_day_low: prevLow,
    today_high: todayHigh,
    today_low: todayLow,
    above_prev_high: above,
    below_prev_low: below,
    is_outside_bar: above && below,
    is_inside_bar: !above && !below && todayHigh != null && todayLow != null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Opening range (first 15 min = first 5 bars on 3-min chart)
// ──────────────────────────────────────────────────────────────────────────────

function computeOpeningRange(threeMinBars: ThreeMinBar[]): OpeningRange | null {
  if (threeMinBars.length < 1) return null;
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayIST = new Date(Date.now() + istOffset).toISOString().slice(0, 10);
  const todayBars = threeMinBars.filter((b) => {
    const barIST = new Date(new Date(b.datetime).getTime() + istOffset).toISOString().slice(0, 10);
    return barIST === todayIST;
  });
  if (todayBars.length === 0) return null;
  // First 5 bars = first 15 minutes (09:15 - 09:30 IST)
  const orBars = todayBars.slice(0, 5);
  if (orBars.length === 0) return null;
  const high = Math.max(...orBars.map((b) => b.high));
  const low  = Math.min(...orBars.map((b) => b.low));
  return {
    high, low,
    mid: (high + low) / 2,
    open_price: orBars[0].open,
    bars_used: orBars.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Pivot selection (the actionable level)
// ──────────────────────────────────────────────────────────────────────────────

function selectPivot(
  regime: DailyRegime,
  todayBreach: TodayBreach,
  openingRange: OpeningRange | null,
  bars: DailyBar[]
): DailyStructureSnapshot["pivot"] {
  const yesterday = bars[bars.length - 1] ?? null;

  // User's rule: outside bar / uncertain → trade off the first-15-min midpoint
  if (regime === "UNCERTAIN" && openingRange) {
    return {
      type: "OPENING_RANGE_MID",
      value: openingRange.mid,
      rationale: `Outside bar — today is breaching both yesterday's H (${yesterday?.high ?? "—"}) and L (${yesterday?.low ?? "—"}). Use opening range midpoint (${openingRange.mid.toFixed(2)}) as bias pivot — above mid favors longs toward yesterday's high, below mid favors shorts toward yesterday's low.`,
    };
  }

  // Bullish regime → yesterday's high is the breakout pivot
  if (regime === "BULLISH" && yesterday) {
    return {
      type: "PRIOR_DAY_HIGH",
      value: yesterday.high,
      rationale: `Bullish regime — yesterday's high (${yesterday.high}) is the continuation breakout level. A clean break above with volume extends the trend.`,
    };
  }

  // Bearish regime → yesterday's low is the breakdown pivot
  if (regime === "BEARISH" && yesterday) {
    return {
      type: "PRIOR_DAY_LOW",
      value: yesterday.low,
      rationale: `Bearish regime — yesterday's low (${yesterday.low}) is the continuation breakdown level. A clean break below with volume extends the trend.`,
    };
  }

  // Reversal forming or choppy → opening range mid if available, else PDC
  if (openingRange) {
    return {
      type: "OPENING_RANGE_MID",
      value: openingRange.mid,
      rationale: `Mixed structure — opening range midpoint (${openingRange.mid.toFixed(2)}) acts as the intraday pivot.`,
    };
  }

  return {
    type: "PRIOR_DAY_CLOSE",
    value: yesterday?.close ?? null,
    rationale: yesterday ? `Insufficient OR data — using prior day close (${yesterday.close}) as fallback pivot.` : "No prior day data.",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────────────────────────────────

export async function analyzeDailyStructure(
  threeMinBars: ThreeMinBar[]
): Promise<DailyStructureSnapshot> {
  // Fetch last 7 daily bars (gives us 6 day-over-day comparisons; we use last 5)
  const dailyRaw = await fetchDailyBars(10);

  // Today might or might not be present in the raw daily data depending on timing.
  // Strip today out and use the 3-min bars to construct today.
  const istOffset = 5.5 * 60 * 60 * 1000;
  const todayDateIST = new Date(Date.now() + istOffset).toISOString().slice(0, 10);
  const completed = dailyRaw.filter((b) => b.date < todayDateIST);

  const annotated = annotateDayOverDay(completed);
  const last5 = annotated.slice(-5);

  // Build today's bar from 3-min data
  const todayOHLC = buildTodayBar(threeMinBars);
  const yesterday = last5.length > 0 ? last5[last5.length - 1] : null;

  const todayBreach = computeBreach(
    todayOHLC ? { high: todayOHLC.high, low: todayOHLC.low } : null,
    yesterday?.high ?? null,
    yesterday?.low  ?? null
  );

  const openingRange = computeOpeningRange(threeMinBars);
  const { regime, label, score, yesterday_signal } = classifyRegime(annotated, todayBreach);
  const pivot = selectPivot(regime, todayBreach, openingRange, last5);

  // Build "with today" series
  const withToday: DailyBar[] = todayOHLC
    ? [...last5, {
        date: todayDateIST,
        open: todayOHLC.open,
        high: todayOHLC.high,
        low:  todayOHLC.low,
        close: todayOHLC.close,
        hh: yesterday ? todayOHLC.high > yesterday.high : null,
        hl: yesterday ? todayOHLC.low  > yesterday.low  : null,
        lh: yesterday ? todayOHLC.high < yesterday.high : null,
        ll: yesterday ? todayOHLC.low  < yesterday.low  : null,
      }]
    : last5;

  const recentForCounts = last5.filter((b) => b.hh !== null);
  const hh = recentForCounts.filter((b) => b.hh).length;
  const hl = recentForCounts.filter((b) => b.hl).length;
  const lh = recentForCounts.filter((b) => b.lh).length;
  const ll = recentForCounts.filter((b) => b.ll).length;

  return {
    regime,
    regime_label: label,
    regime_score: score,
    yesterday_signal,
    hh_count: hh, hl_count: hl, lh_count: lh, ll_count: ll,
    total_compared: recentForCounts.length,
    bars_completed: last5,
    bars_with_today: withToday,
    today_breach: todayBreach,
    opening_range: openingRange,
    pivot,
  };
}
