/**
 * Confluence scoring — deterministic combiner.
 *
 * Takes Claude's ScanOutput plus an A/D snapshot and produces a single
 * confluence score (-6 to +6) and a confidence tier.
 *
 * Computed in code (not by Claude) so the output is reproducible and auditable.
 * Each input source contributes -1, 0, or +1 along the bullish/bearish axis.
 */

import type { ScanOutput } from "./claude";
import type { AdvanceDeclineSnapshot } from "./breeze";
import type { DailyStructureSnapshot } from "./daily-structure";

export type ConfluenceTier =
  | "HIGH_BULL"
  | "MODERATE_BULL"
  | "NO_EDGE"
  | "MODERATE_BEAR"
  | "HIGH_BEAR";

export interface ConfluenceComponent {
  source: string;
  score: -1 | 0 | 1;
  reason: string;
}

export interface ConfluenceReport {
  total_score: number;       // -6 to +6
  max_score: number;         // 6
  tier: ConfluenceTier;
  tier_label: string;        // human-readable
  direction: "BULLISH" | "BEARISH" | "NO_EDGE";
  components: ConfluenceComponent[];
  contradictions: string[];  // explicit conflicts to flag
  action_guidance: string;
}

function scoreStrategies(scan: ScanOutput): ConfluenceComponent {
  const fired = scan.strategies.filter((s) => s.fired && s.filter_passed);
  if (fired.length === 0) {
    const armed = scan.strategies.find((s) => s.stage === "armed");
    if (armed) {
      return { source: "Strategies", score: 0, reason: `S${armed.strategy} armed but not yet triggered` };
    }
    return { source: "Strategies", score: 0, reason: "No fired strategies passing R:R filter" };
  }
  const buys  = fired.filter((s) => s.direction === "BUY").length;
  const sells = fired.filter((s) => s.direction === "SELL").length;
  if (buys > 0 && sells === 0) {
    const names = fired.map((s) => `S${s.strategy}`).join(", ");
    return { source: "Strategies", score: 1, reason: `${names} fired BUY (R:R passed)` };
  }
  if (sells > 0 && buys === 0) {
    const names = fired.map((s) => `S${s.strategy}`).join(", ");
    return { source: "Strategies", score: -1, reason: `${names} fired SELL (R:R passed)` };
  }
  return { source: "Strategies", score: 0, reason: "Conflicting BUY and SELL strategies fired" };
}

function scoreBias(scan: ScanOutput): ConfluenceComponent {
  const dir = scan.bias.direction;
  const conf = scan.bias.confidence;
  if (dir === "BULLISH") return { source: "Discretionary bias", score: 1, reason: `${conf} confidence bullish read` };
  if (dir === "BEARISH") return { source: "Discretionary bias", score: -1, reason: `${conf} confidence bearish read` };
  return { source: "Discretionary bias", score: 0, reason: "Neutral bias" };
}

function scoreOINetRead(scan: ScanOutput): ConfluenceComponent {
  const oi = scan.oi_buildup;
  if (!oi) return { source: "OI net read", score: 0, reason: "No OI data" };
  if (oi.net_read === "BULLISH") return { source: "OI net read", score: 1, reason: oi.summary || "Net bullish OI positioning" };
  if (oi.net_read === "BEARISH") return { source: "OI net read", score: -1, reason: oi.summary || "Net bearish OI positioning" };
  return { source: "OI net read", score: 0, reason: "Neutral OI positioning" };
}

function scoreWallMigration(scan: ScanOutput): ConfluenceComponent {
  const oi = scan.oi_buildup;
  if (!oi) return { source: "Wall migration", score: 0, reason: "No OI data" };
  const c = oi.call_wall_migration?.direction ?? "STABLE";
  const p = oi.put_wall_migration?.direction ?? "STABLE";

  // Both UP = strong bullish, both DOWN = strong bearish
  // Mixed (e.g. call UP + put DOWN = range expanding) = neutral
  if (c === "UP" && p === "UP")     return { source: "Wall migration", score: 1, reason: "Both walls migrating UP" };
  if (c === "DOWN" && p === "DOWN") return { source: "Wall migration", score: -1, reason: "Both walls migrating DOWN" };
  if (c === "UP" && p === "STABLE") return { source: "Wall migration", score: 1, reason: "Call wall up; put wall stable" };
  if (c === "STABLE" && p === "UP") return { source: "Wall migration", score: 1, reason: "Put wall rising; call wall stable" };
  if (c === "DOWN" && p === "STABLE") return { source: "Wall migration", score: -1, reason: "Call wall compressing down" };
  if (c === "STABLE" && p === "DOWN") return { source: "Wall migration", score: -1, reason: "Put wall retreating down" };
  if (c === "UP" && p === "DOWN")   return { source: "Wall migration", score: 0, reason: "Walls expanding (volatility expansion)" };
  if (c === "DOWN" && p === "UP")   return { source: "Wall migration", score: 0, reason: "Walls compressing (pinning expected)" };
  return { source: "Wall migration", score: 0, reason: "Walls stable" };
}

function scoreTopStrikes(scan: ScanOutput): ConfluenceComponent {
  const oi = scan.oi_buildup;
  const strikes = oi?.top_strikes ?? [];
  if (strikes.length === 0) return { source: "Top strikes buildup", score: 0, reason: "No strike data" };

  // Bullish patterns:
  //   - Calls with "Short Covering" (resistance crumbling)
  //   - Puts with "Short Buildup" (support strengthening)
  // Bearish patterns:
  //   - Calls with "Long Buildup" (resistance reinforcing)
  //   - Puts with "Short Covering" (support crumbling)
  let bull = 0;
  let bear = 0;
  for (const s of strikes) {
    if (s.side === "CE") {
      if (s.buildup_type === "Short Covering") bull++;
      else if (s.buildup_type === "Long Buildup") bear++;
    } else {
      if (s.buildup_type === "Short Buildup") bull++;
      else if (s.buildup_type === "Short Covering") bear++;
    }
  }
  if (bull > bear + 1) return { source: "Top strikes buildup", score: 1,  reason: `${bull} bullish patterns vs ${bear} bearish` };
  if (bear > bull + 1) return { source: "Top strikes buildup", score: -1, reason: `${bear} bearish patterns vs ${bull} bullish` };
  return { source: "Top strikes buildup", score: 0, reason: `Balanced (${bull} bull / ${bear} bear)` };
}

function scoreAD(ad: AdvanceDeclineSnapshot | null): ConfluenceComponent {
  if (!ad) return { source: "Advances/Declines", score: 0, reason: "Not fetched" };
  if (ad.bias === "STRONG_UP")     return { source: "Advances/Declines", score: 1,  reason: `${ad.advances}/${ad.total} advancing` };
  if (ad.bias === "MODERATE_UP")   return { source: "Advances/Declines", score: 1,  reason: `${ad.advances}/${ad.total} advancing (moderate)` };
  if (ad.bias === "STRONG_DOWN")   return { source: "Advances/Declines", score: -1, reason: `${ad.declines}/${ad.total} declining` };
  if (ad.bias === "MODERATE_DOWN") return { source: "Advances/Declines", score: -1, reason: `${ad.declines}/${ad.total} declining (moderate)` };
  return { source: "Advances/Declines", score: 0, reason: `Balanced ${ad.advances}/${ad.declines}` };
}

function scoreDailyStructure(ds: DailyStructureSnapshot | null): ConfluenceComponent {
  if (!ds) return { source: "Daily structure (5d)", score: 0, reason: "Not fetched" };

  // The regime_score is already -3..+3 from yesterday(2x) + 5-day(1x).
  // For confluence we collapse to -1/0/+1 since each source contributes one unit.
  if (ds.regime === "BULLISH") {
    return { source: "Daily structure (5d)", score: 1, reason: ds.regime_label };
  }
  if (ds.regime === "BEARISH") {
    return { source: "Daily structure (5d)", score: -1, reason: ds.regime_label };
  }
  if (ds.regime === "UNCERTAIN") {
    return { source: "Daily structure (5d)", score: 0, reason: "Outside bar — uncertain regime, favor strangle/wait" };
  }
  if (ds.regime === "REVERSAL_FORMING") {
    return { source: "Daily structure (5d)", score: 0, reason: ds.regime_label };
  }
  return { source: "Daily structure (5d)", score: 0, reason: ds.regime_label };
}

function tierFromScore(score: number, max: number): { tier: ConfluenceTier; label: string; direction: ConfluenceReport["direction"]; guidance: string } {
  // Score range is -max to +max where max = 7 (7 sources × ±1)
  // Tier thresholds scale with max:
  //   HIGH: |score| >= ceil(max * 0.7) — i.e. 5 of 7 agreeing
  //   MODERATE: |score| >= ceil(max * 0.3) — i.e. 3 of 7 agreeing
  if (score >= 5)  return { tier: "HIGH_BULL",     label: "HIGH BULLISH",     direction: "BULLISH", guidance: "All-in alignment across price, OI, breadth, and 5-day structure. Take fired BUY setups at full conviction." };
  if (score >= 3)  return { tier: "MODERATE_BULL", label: "MODERATE BULLISH", direction: "BULLISH", guidance: "Most signals agree bullish. Take BUY setups at reduced size." };
  if (score <= -5) return { tier: "HIGH_BEAR",     label: "HIGH BEARISH",     direction: "BEARISH", guidance: "All-in alignment. Take fired SELL setups at full conviction." };
  if (score <= -3) return { tier: "MODERATE_BEAR", label: "MODERATE BEARISH", direction: "BEARISH", guidance: "Most signals agree bearish. Take SELL setups at reduced size." };
  return { tier: "NO_EDGE", label: "NO EDGE", direction: "NO_EDGE", guidance: "Signals conflict or are quiet. Skip directional — consider strangle if regime is uncertain/choppy." };
}

function findContradictions(components: ConfluenceComponent[], scan: ScanOutput): string[] {
  const contradictions: string[] = [];
  const strategy = components.find((c) => c.source === "Strategies");
  const oi       = components.find((c) => c.source === "OI net read");
  const walls    = components.find((c) => c.source === "Wall migration");
  const daily    = components.find((c) => c.source === "Daily structure (5d)");

  // Strategy fired one direction but OI says opposite
  if (strategy?.score === 1 && oi?.score === -1) {
    contradictions.push("Strategy fired BUY but OI net read is BEARISH — wait for OI confirmation before going long");
  }
  if (strategy?.score === -1 && oi?.score === 1) {
    contradictions.push("Strategy fired SELL but OI net read is BULLISH — wait for OI confirmation before shorting");
  }

  // Strategy fired BUY but walls migrating DOWN
  if (strategy?.score === 1 && walls?.score === -1) {
    contradictions.push("Strategy BUY but option walls migrating DOWN — institutions disagree with the breakout");
  }
  if (strategy?.score === -1 && walls?.score === 1) {
    contradictions.push("Strategy SELL but option walls migrating UP — institutions disagree with the breakdown");
  }

  // Bias contradicts strategy direction
  const bias = components.find((c) => c.source === "Discretionary bias");
  if (strategy?.score === 1 && bias?.score === -1) {
    contradictions.push("Strategy BUY but discretionary bias is BEARISH — price action contradicts setup");
  }
  if (strategy?.score === -1 && bias?.score === 1) {
    contradictions.push("Strategy SELL but discretionary bias is BULLISH — price action contradicts setup");
  }

  // Daily regime vs intraday strategy direction — counter-trend trade warning
  if (strategy?.score === 1 && daily?.score === -1) {
    contradictions.push("Intraday BUY against bearish 5-day structure — counter-trend, expect mean-reversion failure risk");
  }
  if (strategy?.score === -1 && daily?.score === 1) {
    contradictions.push("Intraday SELL against bullish 5-day structure — counter-trend, expect dip-buying failure risk");
  }

  return contradictions;
}

export function computeConfluence(
  scan: ScanOutput,
  ad: AdvanceDeclineSnapshot | null,
  dailyStructure: DailyStructureSnapshot | null
): ConfluenceReport {
  const components: ConfluenceComponent[] = [
    scoreStrategies(scan),
    scoreBias(scan),
    scoreOINetRead(scan),
    scoreWallMigration(scan),
    scoreTopStrikes(scan),
    scoreAD(ad),
    scoreDailyStructure(dailyStructure),
  ];

  const total = components.reduce((s, c) => s + c.score, 0);
  const max = components.length;

  const { tier, label, direction, guidance } = tierFromScore(total, max);
  const contradictions = findContradictions(components, scan);

  return {
    total_score: total,
    max_score: max,
    tier,
    tier_label: label,
    direction,
    components,
    contradictions,
    action_guidance: guidance,
  };
}
