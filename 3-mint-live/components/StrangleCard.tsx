import type { StrangleProposal } from "@/lib/strangle";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function StatusPill({ status }: { status: StrangleProposal["status"] }) {
  if (status === "PROPOSED") {
    return <span className="strangle-status proposed">✓ Proposed</span>;
  }
  if (status === "NOT_ACTIONABLE") {
    return <span className="strangle-status not-actionable">⚠ Not actionable</span>;
  }
  return <span className="strangle-status no-proposal">○ No proposal</span>;
}

function ScenarioBadge({ scenario }: { scenario?: "PIN" | "TOUCH_AND_BOUNCE" | "OPENING_RANGE" }) {
  if (!scenario) return null;
  const cls = scenario === "PIN" ? "pin" : scenario === "TOUCH_AND_BOUNCE" ? "bounce" : "or";
  const label =
    scenario === "PIN"           ? "PIN AT TARGET" :
    scenario === "TOUCH_AND_BOUNCE" ? "TOUCH & BOUNCE" :
    "OPENING-RANGE STRANGLE";
  return <span className={`scenario-badge ${cls}`}>{label}</span>;
}

export function StrangleCard({ strangle }: { strangle: StrangleProposal }) {
  if (!strangle) return null;

  // Minimal card when no proposal — just one line of explanation
  if (strangle.status === "NO_PROPOSAL") {
    return (
      <div className="strangle-card no-proposal-card">
        <div className="section-title">
          Directional Strangle
          <StatusPill status={strangle.status} />
        </div>
        <div className="strangle-no-prop-reason">{strangle.reason}</div>
      </div>
    );
  }

  const isProposed = strangle.status === "PROPOSED";

  return (
    <div className={`strangle-card ${isProposed ? "actionable" : "warning"}`}>
      <div className="section-title">
        Directional Strangle
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ScenarioBadge scenario={strangle.scenario} />
          <StatusPill status={strangle.status} />
        </span>
      </div>

      {/* Strike + basis */}
      <div className="strangle-strike-row">
        <div className="strangle-strike-num">{fmtInt(strangle.strike)}</div>
        <div className="strangle-strike-basis">{strangle.strike_basis}</div>
      </div>

      {/* Two legs side by side */}
      <div className="strangle-legs">
        <div className="strangle-leg ce">
          <div className="leg-header">
            <span className="leg-label">SHORT CE</span>
            <span className="leg-strike">{fmtInt(strangle.ce?.strike)}</span>
          </div>
          <div className="leg-stats">
            <div className="leg-stat">
              <span className="leg-stat-label">LTP</span>
              <span className="leg-stat-value">₹{fmt(strangle.ce?.ltp)}</span>
            </div>
            <div className="leg-stat">
              <span className="leg-stat-label">OI</span>
              <span className="leg-stat-value">{fmtInt(strangle.ce?.oi)}</span>
            </div>
            <div className="leg-stat">
              <span className="leg-stat-label">ΔOI</span>
              <span className={`leg-stat-value ${(strangle.ce?.oi_change ?? 0) >= 0 ? "bull" : "bear"}`}>
                {(strangle.ce?.oi_change ?? 0) >= 0 ? "+" : ""}{fmtInt(strangle.ce?.oi_change)}
              </span>
            </div>
            <div className="leg-stat">
              <span className="leg-stat-label">IV</span>
              <span className="leg-stat-value">{strangle.ce?.iv != null ? fmt(strangle.ce.iv, 1) + "%" : "—"}</span>
            </div>
          </div>
        </div>

        <div className="strangle-leg pe">
          <div className="leg-header">
            <span className="leg-label">SHORT PE</span>
            <span className="leg-strike">{fmtInt(strangle.pe?.strike)}</span>
          </div>
          <div className="leg-stats">
            <div className="leg-stat">
              <span className="leg-stat-label">LTP</span>
              <span className="leg-stat-value">₹{fmt(strangle.pe?.ltp)}</span>
            </div>
            <div className="leg-stat">
              <span className="leg-stat-label">OI</span>
              <span className="leg-stat-value">{fmtInt(strangle.pe?.oi)}</span>
            </div>
            <div className="leg-stat">
              <span className="leg-stat-label">ΔOI</span>
              <span className={`leg-stat-value ${(strangle.pe?.oi_change ?? 0) >= 0 ? "bull" : "bear"}`}>
                {(strangle.pe?.oi_change ?? 0) >= 0 ? "+" : ""}{fmtInt(strangle.pe?.oi_change)}
              </span>
            </div>
            <div className="leg-stat">
              <span className="leg-stat-label">IV</span>
              <span className="leg-stat-value">{strangle.pe?.iv != null ? fmt(strangle.pe.iv, 1) + "%" : "—"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Premium + breakeven economics */}
      <div className="strangle-econ">
        <div className="econ-cell highlight">
          <div className="econ-label">Total premium</div>
          <div className="econ-value">{fmt(strangle.total_premium)} pts</div>
          <div className="econ-sub">₹{fmtInt(strangle.premium_per_lot)} / lot (75)</div>
        </div>
        <div className="econ-cell">
          <div className="econ-label">Profit zone</div>
          <div className="econ-value">
            {fmt(strangle.lower_breakeven)} – {fmt(strangle.upper_breakeven)}
          </div>
          <div className="econ-sub">{fmt(strangle.profit_zone_width)} pts wide</div>
        </div>
        <div className="econ-cell">
          <div className="econ-label">Max profit at strike</div>
          <div className="econ-value bull">{fmt(strangle.max_profit_at_strike)} pts</div>
          <div className="econ-sub">if held to expiry</div>
        </div>
        <div className="econ-cell">
          <div className="econ-label">Time to expiry</div>
          <div className="econ-value">{fmt(strangle.hours_to_expiry, 1)} h</div>
          <div className="econ-sub">{strangle.hours_to_expiry != null && strangle.hours_to_expiry < 8 ? "expiry day" : "till settlement"}</div>
        </div>
      </div>

      {/* Loss estimates at ±2% */}
      <div className="strangle-loss-row">
        <div className="loss-cell">
          <span className="loss-label">Est. loss at +2% from spot</span>
          <span className="loss-value">{fmt(strangle.estimated_loss_2pct_up)} pts</span>
        </div>
        <div className="loss-cell">
          <span className="loss-label">Est. loss at −2% from spot</span>
          <span className="loss-value">{fmt(strangle.estimated_loss_2pct_down)} pts</span>
        </div>
      </div>

      {/* Risk filters */}
      {strangle.filter_results && (
        <div className="strangle-filters">
          <div className="strangle-filters-label">Risk filters</div>
          {strangle.filter_results.map((f, i) => (
            <div key={i} className={`filter-row ${f.passed ? "passed" : "failed"}`}>
              <span className="filter-icon">{f.passed ? "✓" : "✕"}</span>
              <span className="filter-name">{f.filter}</span>
              <span className="filter-detail">{f.detail}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {strangle.warnings.length > 0 && (
        <div className="strangle-warnings">
          <div className="strangle-warnings-label">⚠ Risk warnings</div>
          {strangle.warnings.map((w, i) => (
            <div key={i} className="warning-row">{w}</div>
          ))}
        </div>
      )}

      {/* Adjustment notes */}
      {strangle.adjustment_notes && strangle.adjustment_notes.length > 0 && (
        <div className="strangle-adjustments">
          <div className="strangle-adjustments-label">Position management</div>
          {strangle.adjustment_notes.map((n, i) => (
            <div key={i} className="adjustment-row">▸ {n}</div>
          ))}
        </div>
      )}
    </div>
  );
}
