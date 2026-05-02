/**
 * Directional short strangle proposer.
 *
 * Takes Claude's price projection + the option chain + confluence,
 * selects the optimal strike, computes premium / breakevens / max loss,
 * and runs all risk filters. Output is suitable for direct rendering.
 *
 * Strike selection is mechanical (not asked of Claude) so it's auditable
 * and reproducible.
 */

import type { ScanOutput, PriceProjection } from "./claude";
import type { OptionChainRow } from "./breeze";
import type { ConfluenceReport } from "./confluence";
import type { DailyStructureSnapshot } from "./daily-structure";

export interface StrangleProposal {
  status: "PROPOSED" | "NOT_ACTIONABLE" | "NO_PROPOSAL";
  reason: string; // explanation of status

  path?: "TARGET_BASED" | "OPENING_RANGE";   // which selection logic was used
  scenario?: "PIN" | "TOUCH_AND_BOUNCE" | "OPENING_RANGE";
  strike?: number;
  strike_basis?: string;

  ce?: { strike: number; ltp: number; oi: number; oi_change: number; iv: number | null };
  pe?: { strike: number; ltp: number; oi: number; oi_change: number; iv: number | null };

  total_premium?: number;        // points (per share)
  premium_per_lot?: number;      // ₹ value per lot of 75
  upper_breakeven?: number;
  lower_breakeven?: number;
  profit_zone_width?: number;    // points
  max_profit_at_strike?: number; // points = total_premium

  estimated_loss_2pct_up?: number;
  estimated_loss_2pct_down?: number;

  hours_to_expiry?: number;

  filter_results?: { filter: string; passed: boolean; detail: string }[];
  warnings: string[];
  adjustment_notes?: string[];
}

const NIFTY_LOT_SIZE = 75; // current Nifty F&O lot size

// Risk filter thresholds
const MIN_TOTAL_PREMIUM         = 30;   // points
const MIN_LEG_LTP               = 10;   // points per leg
const MIN_IV_AT_STRIKE          = 12;   // %
const MIN_CONFLUENCE_ABS        = 4;    // |confluence.total_score|
const MAX_HOURS_TO_EXPIRY       = 48;   // 2 trading days
const EXPIRY_DAY_CUTOFF_IST_HRS = 14;   // 14:30 IST = no new strangles after this

function nearestStrike(price: number, step: number = 50): number {
  return Math.round(price / step) * step;
}

function findStrikeRow(chain: OptionChainRow[], strike: number): OptionChainRow | null {
  return chain.find((r) => r.strike_price === strike) ?? null;
}

function hoursToNiftyExpiry(now: Date, expiryISO: string): number {
  const expiry = new Date(expiryISO);
  // Nifty weekly expiry settles at 15:30 IST = 10:00 UTC
  expiry.setUTCHours(10, 0, 0, 0);
  return (expiry.getTime() - now.getTime()) / (1000 * 60 * 60);
}

function isAfterExpiryCutoff(now: Date): boolean {
  const istHours = (now.getUTCHours() + 5.5) % 24;
  return istHours >= EXPIRY_DAY_CUTOFF_IST_HRS;
}

function isThursdayIST(now: Date): boolean {
  const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return istDate.getUTCDay() === 4;
}

export function proposeStrangle(
  scan: ScanOutput,
  chain: OptionChainRow[],
  confluence: ConfluenceReport,
  expiryISO: string,
  now: Date = new Date(),
  dailyStructure: DailyStructureSnapshot | null = null
): StrangleProposal {
  const proj: PriceProjection | undefined = scan.price_projection;

  // ── Daily-structure gates (your trading framework) ──────────────────────
  // Your rule: don't strangle in a strong directional regime — directional trades win there.
  // Strangles are best in UNCERTAIN, REVERSAL_FORMING, or CHOPPY regimes where price is
  // expected to oscillate rather than trend.
  let openingRangeOverride: { strike: number; rationale: string } | null = null;

  if (dailyStructure) {
    if (dailyStructure.regime === "BULLISH" && Math.abs(dailyStructure.regime_score) >= 3) {
      return {
        status: "NO_PROPOSAL",
        reason: `Strong bullish 5-day structure (yesterday HH+HL, ${dailyStructure.hh_count}/${dailyStructure.total_compared} bullish days) — directional BUY trade preferred over strangle`,
        warnings: [],
      };
    }
    if (dailyStructure.regime === "BEARISH" && Math.abs(dailyStructure.regime_score) >= 3) {
      return {
        status: "NO_PROPOSAL",
        reason: `Strong bearish 5-day structure (yesterday LH+LL, ${dailyStructure.ll_count}/${dailyStructure.total_compared} bearish days) — directional SELL trade preferred over strangle`,
        warnings: [],
      };
    }
    // UNCERTAIN regime → user's rule: strangle at the OPENING RANGE MIDPOINT strike.
    // This overrides the projected-target strike below.
    if (dailyStructure.regime === "UNCERTAIN" && dailyStructure.opening_range) {
      const orMidStrike = nearestStrike(dailyStructure.opening_range.mid);
      openingRangeOverride = {
        strike: orMidStrike,
        rationale: `Outside-bar regime — using first-15-min midpoint (${dailyStructure.opening_range.mid.toFixed(2)}, OR high ${dailyStructure.opening_range.high.toFixed(2)} / low ${dailyStructure.opening_range.low.toFixed(2)}) rounded to ${orMidStrike} as strangle strike. Both legs sold expecting price to oscillate around this level.`,
      };
    }
    // UNCERTAIN regime but opening range not yet formed (pre-09:30 IST)
    if (dailyStructure.regime === "UNCERTAIN" && !dailyStructure.opening_range) {
      return {
        status: "NO_PROPOSAL",
        reason: "Outside-bar regime detected, but first 15-min candle not yet complete — wait until 09:30 IST for opening-range strike",
        warnings: [],
      };
    }
  }

  // ── Path A: Opening Range Strangle (UNCERTAIN regime override) ─────────
  // When yesterday OR today is an outside bar, your rule is: trade off the
  // first-15-min midpoint. This bypasses the projection-target logic entirely
  // — the OR-mid IS the strangle strike. Confluence requirement is also relaxed
  // since the OR strangle is a theta play on indecision, not a directional bet.
  const useOpeningRange = openingRangeOverride !== null;

  if (!useOpeningRange) {
    // ── Path B gate 1: projection must exist ──
    if (!proj || !proj.has_target || proj.target_price == null) {
      return {
        status: "NO_PROPOSAL",
        reason: "No price target projected — confluence too mixed or signals conflict",
        warnings: [],
      };
    }

    if (proj.scenario === "RUNAWAY_TREND") {
      return {
        status: "NO_PROPOSAL",
        reason: `Runaway trend toward ${proj.target_price} — strangle inappropriate, price likely to overshoot`,
        warnings: [],
      };
    }

    if (proj.scenario === "NONE") {
      return {
        status: "NO_PROPOSAL",
        reason: "No clear scenario classification — insufficient signal alignment for a strangle",
        warnings: [],
      };
    }

    if (proj.confidence === "Low") {
      return {
        status: "NO_PROPOSAL",
        reason: "Price projection confidence too low for a strangle proposal",
        warnings: [],
      };
    }
  }

  // Gate 2: Confluence must be decisive (relaxed for non-trending and OR paths)
  const isNonTrending = dailyStructure
    ? (dailyStructure.regime === "CHOPPY" || dailyStructure.regime === "REVERSAL_FORMING")
    : false;
  const requiredConfluence = useOpeningRange ? 0 : (isNonTrending ? 2 : MIN_CONFLUENCE_ABS);

  if (!useOpeningRange && Math.abs(confluence.total_score) < requiredConfluence) {
    return {
      status: "NO_PROPOSAL",
      reason: `Confluence score ${confluence.total_score >= 0 ? "+" : ""}${confluence.total_score} not decisive enough (need |score| >= ${requiredConfluence}${isNonTrending ? " in choppy regime" : ""})`,
      warnings: [],
    };
  }

  // Gate 3: Expiry day cutoff (always applies)
  if (isThursdayIST(now) && isAfterExpiryCutoff(now)) {
    return {
      status: "NO_PROPOSAL",
      reason: "Past 14:30 IST on expiry day — gamma risk too high for new strangle entries",
      warnings: [],
    };
  }

  // Determine strike — OR override wins, else use projected target
  let strikeBasis: string;
  let targetStrike: number;

  if (useOpeningRange && openingRangeOverride) {
    targetStrike = openingRangeOverride.strike;
    strikeBasis  = openingRangeOverride.rationale;
  } else if (proj && proj.scenario === "PIN") {
    targetStrike = nearestStrike(proj.target_price!);
    strikeBasis  = `Pin scenario — strike at projected target ${proj.target_price} (rounded to ${targetStrike})`;
  } else if (proj) {
    // TOUCH_AND_BOUNCE — use the landing price (post-bounce zone)
    const landing = proj.expected_landing_price ?? proj.target_price!;
    targetStrike = nearestStrike(landing);
    strikeBasis  = `Touch-and-bounce — strike at expected landing ${landing} (rounded to ${targetStrike}). Price expected to touch ${proj.target_price} then revert.`;
  } else {
    // Should never reach here due to gates above
    return {
      status: "NO_PROPOSAL",
      reason: "Internal: no path matched for strike selection",
      warnings: [],
    };
  }

  // Look up chain row for chosen strike
  const row = findStrikeRow(chain, targetStrike);
  if (!row) {
    return {
      status: "NO_PROPOSAL",
      reason: `Strike ${targetStrike} not present in option chain (closest available may differ)`,
      warnings: [],
    };
  }

  const cePremium = row.call_ltp ?? 0;
  const pePremium = row.put_ltp  ?? 0;
  const totalPremium = cePremium + pePremium;

  // Gate 4: Premium thresholds
  const filters: { filter: string; passed: boolean; detail: string }[] = [];

  filters.push({
    filter: "Min total premium ≥ 30",
    passed: totalPremium >= MIN_TOTAL_PREMIUM,
    detail: `Total = ${totalPremium.toFixed(2)} points`,
  });
  filters.push({
    filter: "CE leg LTP ≥ 10",
    passed: cePremium >= MIN_LEG_LTP,
    detail: `CE LTP = ${cePremium.toFixed(2)}`,
  });
  filters.push({
    filter: "PE leg LTP ≥ 10",
    passed: pePremium >= MIN_LEG_LTP,
    detail: `PE LTP = ${pePremium.toFixed(2)}`,
  });

  const ceIV = row.call_iv ?? null;
  const peIV = row.put_iv  ?? null;
  const avgIV = ceIV != null && peIV != null ? (ceIV + peIV) / 2 : ceIV ?? peIV;

  filters.push({
    filter: `IV at strike ≥ ${MIN_IV_AT_STRIKE}`,
    passed: avgIV != null && avgIV >= MIN_IV_AT_STRIKE,
    detail: avgIV != null ? `Avg IV = ${avgIV.toFixed(1)}` : "IV unavailable",
  });

  const hoursToExp = hoursToNiftyExpiry(now, expiryISO);
  filters.push({
    filter: `Time to expiry ≤ ${MAX_HOURS_TO_EXPIRY}h`,
    passed: hoursToExp > 0 && hoursToExp <= MAX_HOURS_TO_EXPIRY,
    detail: `${hoursToExp.toFixed(1)} hours`,
  });

  filters.push({
    filter: "Confluence decisive",
    passed: Math.abs(confluence.total_score) >= requiredConfluence,
    detail: `Score ${confluence.total_score >= 0 ? "+" : ""}${confluence.total_score}/${confluence.max_score}${isNonTrending ? " (choppy regime threshold)" : ""}`,
  });

  // Compute breakevens and max loss estimates
  const upperBE = targetStrike + totalPremium;
  const lowerBE = targetStrike - totalPremium;
  const zoneWidth = totalPremium * 2;

  const spot = scan.session_context.spot;
  // At ±2% from current spot, naive estimate of strangle loss:
  //   loss = max(0, spot_at_close − upperBE) + max(0, lowerBE − spot_at_close) − totalPremium received
  //   But since we already collected totalPremium, P&L = totalPremium − intrinsic_at_close
  const spotPlus2  = spot * 1.02;
  const spotMinus2 = spot * 0.98;
  const intrinsicUp   = Math.max(0, spotPlus2  - targetStrike) + Math.max(0, targetStrike - spotPlus2);
  const intrinsicDown = Math.max(0, spotMinus2 - targetStrike) + Math.max(0, targetStrike - spotMinus2);
  const lossUp   = Math.max(0, intrinsicUp   - totalPremium);
  const lossDown = Math.max(0, intrinsicDown - totalPremium);

  const allPassed = filters.every((f) => f.passed);

  const warnings: string[] = [
    "Naked short options carry unbounded loss risk. Use only with margin and active risk management.",
    "Hard stop loss recommended: close if losing more than 1.5× total premium received.",
    "If price moves to within 50 points of either breakeven, consider rolling or closing the threatened leg.",
  ];
  if (isThursdayIST(now)) {
    warnings.push("⚠ Today is Nifty weekly expiry — gamma accelerates sharply through the day.");
  }
  if (useOpeningRange) {
    warnings.push("Opening-range strangle assumes price oscillates around the OR midpoint. If price trends decisively beyond OR high or low, exit immediately.");
  } else if (proj && proj.scenario === "TOUCH_AND_BOUNCE") {
    warnings.push("Touch-and-bounce scenarios assume the projected support/resistance holds — false breaks invalidate the trade.");
  }

  const adjustmentNotes: string[] = [
    "Profit-take rule: close at 60-70% of max profit if achieved before expiry to lock gains.",
    "Defensive roll: if one leg ITM by > 30% of premium, roll that leg further OTM (reduces but doesn't eliminate risk).",
  ];

  // Determine scenario tag for the response
  const scenarioTag: "PIN" | "TOUCH_AND_BOUNCE" | "OPENING_RANGE" = useOpeningRange
    ? "OPENING_RANGE"
    : (proj && proj.scenario === "PIN" ? "PIN" : "TOUCH_AND_BOUNCE");
  const pathTag: "TARGET_BASED" | "OPENING_RANGE" = useOpeningRange ? "OPENING_RANGE" : "TARGET_BASED";

  if (!allPassed) {
    const failed = filters.filter((f) => !f.passed).map((f) => f.filter).join("; ");
    return {
      status: "NOT_ACTIONABLE",
      reason: `Risk filters failed: ${failed}`,
      path: pathTag,
      scenario: scenarioTag,
      strike: targetStrike,
      strike_basis: strikeBasis,
      ce: { strike: targetStrike, ltp: cePremium, oi: row.call_oi ?? 0, oi_change: row.call_oi_change ?? 0, iv: ceIV },
      pe: { strike: targetStrike, ltp: pePremium, oi: row.put_oi  ?? 0, oi_change: row.put_oi_change  ?? 0, iv: peIV },
      total_premium: totalPremium,
      premium_per_lot: totalPremium * NIFTY_LOT_SIZE,
      upper_breakeven: upperBE,
      lower_breakeven: lowerBE,
      profit_zone_width: zoneWidth,
      max_profit_at_strike: totalPremium,
      estimated_loss_2pct_up: lossUp,
      estimated_loss_2pct_down: lossDown,
      hours_to_expiry: hoursToExp,
      filter_results: filters,
      warnings,
      adjustment_notes: adjustmentNotes,
    };
  }

  return {
    status: "PROPOSED",
    reason: "All risk filters passed",
    path: pathTag,
    scenario: scenarioTag,
    strike: targetStrike,
    strike_basis: strikeBasis,
    ce: { strike: targetStrike, ltp: cePremium, oi: row.call_oi ?? 0, oi_change: row.call_oi_change ?? 0, iv: ceIV },
    pe: { strike: targetStrike, ltp: pePremium, oi: row.put_oi  ?? 0, oi_change: row.put_oi_change  ?? 0, iv: peIV },
    total_premium: totalPremium,
    premium_per_lot: totalPremium * NIFTY_LOT_SIZE,
    upper_breakeven: upperBE,
    lower_breakeven: lowerBE,
    profit_zone_width: zoneWidth,
    max_profit_at_strike: totalPremium,
    estimated_loss_2pct_up: lossUp,
    estimated_loss_2pct_down: lossDown,
    hours_to_expiry: hoursToExp,
    filter_results: filters,
    warnings,
    adjustment_notes: adjustmentNotes,
  };
}
