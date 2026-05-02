"use client";

import { useState } from "react";
import type { DailyStructureSnapshot, DailyBar } from "@/lib/daily-structure";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function regimeClass(regime: DailyStructureSnapshot["regime"]): string {
  switch (regime) {
    case "BULLISH":           return "bull";
    case "BEARISH":           return "bear";
    case "UNCERTAIN":         return "uncertain";
    case "REVERSAL_FORMING":  return "reversal";
    default:                  return "choppy";
  }
}

function regimeBadge(regime: DailyStructureSnapshot["regime"]): string {
  switch (regime) {
    case "BULLISH":           return "▲▲ HH+HL";
    case "BEARISH":           return "▼▼ LH+LL";
    case "UNCERTAIN":         return "⬌ OUTSIDE";
    case "REVERSAL_FORMING":  return "↻ COILING";
    default:                  return "≈ CHOPPY";
  }
}

function dayLabel(date: string): string {
  // YYYY-MM-DD → "Mon DD"
  const d = new Date(date);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit" });
}

/** Mini visual representation of a single day's bar */
function MiniBar({ bar, index, total, allBars }: { bar: DailyBar; index: number; total: number; allBars: DailyBar[] }) {
  // Color by HH/HL pattern
  let cls = "neutral";
  if (bar.hh && bar.hl)       cls = "hh-hl";   // bullish day
  else if (bar.lh && bar.ll)  cls = "lh-ll";   // bearish day
  else if (bar.hh && bar.ll)  cls = "outside"; // outside day
  else if (bar.lh && bar.hl)  cls = "inside";  // inside day

  // Compute relative range positioning across all bars
  const allHigh = Math.max(...allBars.map((b) => b.high));
  const allLow  = Math.min(...allBars.map((b) => b.low));
  const range = allHigh - allLow || 1;

  const barTop    = ((allHigh - bar.high) / range) * 100;
  const barBottom = ((allHigh - bar.low)  / range) * 100;
  const barHeight = barBottom - barTop;

  return (
    <div className="ds-mini-bar-wrap">
      <div className="ds-mini-bar-rail">
        <div
          className={`ds-mini-bar ${cls}`}
          style={{ top: `${barTop}%`, height: `${barHeight}%` }}
          title={`H:${bar.high.toFixed(0)} L:${bar.low.toFixed(0)} C:${bar.close.toFixed(0)}`}
        />
      </div>
      <div className="ds-mini-label">{dayLabel(bar.date)}</div>
      <div className="ds-mini-flags">
        {bar.hh && <span className="flag hh">HH</span>}
        {bar.hl && <span className="flag hl">HL</span>}
        {bar.lh && <span className="flag lh">LH</span>}
        {bar.ll && <span className="flag ll">LL</span>}
      </div>
    </div>
  );
}

export function DailyStructureCard({ ds }: { ds: DailyStructureSnapshot }) {
  const [showWithToday, setShowWithToday] = useState(false);
  const cls = regimeClass(ds.regime);
  const bars = showWithToday ? ds.bars_with_today : ds.bars_completed;

  const breach = ds.today_breach;

  return (
    <div className={`ds-card ${cls}`}>
      <div className="section-title">
        Daily Structure · 5-day
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className={`ds-regime-badge ${cls}`}>{regimeBadge(ds.regime)}</span>
        </div>
      </div>

      {/* Regime label */}
      <div className="ds-label">{ds.regime_label}</div>

      {/* View toggle */}
      <div className="ds-view-toggle">
        <button
          className={!showWithToday ? "active" : ""}
          onClick={() => setShowWithToday(false)}
        >
          Completed only
        </button>
        <button
          className={showWithToday ? "active" : ""}
          onClick={() => setShowWithToday(true)}
        >
          + Today
        </button>
      </div>

      {/* Day-by-day visual */}
      <div className="ds-bars-row">
        {bars.map((bar, i) => (
          <MiniBar key={bar.date} bar={bar} index={i} total={bars.length} allBars={bars} />
        ))}
      </div>

      {/* Counts */}
      <div className="ds-counts">
        <div className="ds-count-cell bull">
          <span className="ds-count-num">{ds.hh_count}</span>
          <span className="ds-count-label">HH days</span>
        </div>
        <div className="ds-count-cell bull">
          <span className="ds-count-num">{ds.hl_count}</span>
          <span className="ds-count-label">HL days</span>
        </div>
        <div className="ds-count-cell bear">
          <span className="ds-count-num">{ds.lh_count}</span>
          <span className="ds-count-label">LH days</span>
        </div>
        <div className="ds-count-cell bear">
          <span className="ds-count-num">{ds.ll_count}</span>
          <span className="ds-count-label">LL days</span>
        </div>
        <div className="ds-count-cell yesterday">
          <span className="ds-count-num">{ds.yesterday_signal}</span>
          <span className="ds-count-label">Yesterday</span>
        </div>
      </div>

      {/* Today's breach */}
      <div className="ds-breach">
        <div className="ds-breach-header">Today vs Yesterday</div>
        <div className="ds-breach-grid">
          <div className="ds-breach-cell">
            <span className="label">Y. high</span>
            <span className="value">{fmt(breach.prev_day_high)}</span>
          </div>
          <div className={`ds-breach-cell ${breach.above_prev_high ? "breached-up" : ""}`}>
            <span className="label">Today high</span>
            <span className="value">{fmt(breach.today_high)}</span>
            {breach.above_prev_high && <span className="breach-badge bull">BREACHED ↑</span>}
          </div>
          <div className="ds-breach-cell">
            <span className="label">Y. low</span>
            <span className="value">{fmt(breach.prev_day_low)}</span>
          </div>
          <div className={`ds-breach-cell ${breach.below_prev_low ? "breached-down" : ""}`}>
            <span className="label">Today low</span>
            <span className="value">{fmt(breach.today_low)}</span>
            {breach.below_prev_low && <span className="breach-badge bear">BREACHED ↓</span>}
          </div>
        </div>
        {breach.is_outside_bar && (
          <div className="ds-outside-warning">
            ⬌ Outside bar in progress — your rule: trade off opening range midpoint
          </div>
        )}
        {breach.is_inside_bar && (
          <div className="ds-inside-note">
            ▼ Inside bar — today is within yesterday's range, low-conviction session
          </div>
        )}
      </div>

      {/* Pivot */}
      {ds.pivot.value != null && (
        <div className="ds-pivot">
          <div className="ds-pivot-header">
            <span className="ds-pivot-label">Today's pivot</span>
            <span className="ds-pivot-type">{ds.pivot.type.replace(/_/g, " ")}</span>
          </div>
          <div className="ds-pivot-value">{fmt(ds.pivot.value)}</div>
          <div className="ds-pivot-rationale">{ds.pivot.rationale}</div>
        </div>
      )}

      {/* Opening range summary */}
      {ds.opening_range && (
        <div className="ds-or">
          <span className="ds-or-label">First 15-min OR:</span>
          <span className="ds-or-val">
            H {fmt(ds.opening_range.high)} · L {fmt(ds.opening_range.low)} · Mid {fmt(ds.opening_range.mid)}
          </span>
          <span className="ds-or-bars">({ds.opening_range.bars_used}/5 bars)</span>
        </div>
      )}
    </div>
  );
}
