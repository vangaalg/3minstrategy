import type { OIBuildup, OIWallMigration, OITopStrike } from "@/lib/claude";

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtSigned(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + n.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function buildupClass(t: OITopStrike["buildup_type"]): string {
  switch (t) {
    case "Long Buildup":   return "bear"; // on calls = bearish; on puts = bearish; net usually bearish at the wall
    case "Short Buildup":  return "bull";
    case "Short Covering": return "bull";
    case "Long Unwinding": return "bear";
    default: return "muted";
  }
}

function MigrationCell({ title, mig }: { title: string; mig: OIWallMigration }) {
  const arrow = mig.direction === "UP" ? "↑" : mig.direction === "DOWN" ? "↓" : "→";
  const cls = mig.direction === "UP" ? "bull" : mig.direction === "DOWN" ? "bear" : "muted";
  return (
    <div className="oi-mig-cell">
      <div className="oi-mig-title">{title}</div>
      <div className={`oi-mig-flow ${cls}`}>
        <span className="oi-mig-strike">{fmt(mig.current_strike)}</span>
        <span className="oi-mig-arrow">{arrow}</span>
        <span className="oi-mig-strike">{fmt(mig.shifting_to) || "—"}</span>
      </div>
      <div className="oi-mig-note">{mig.interpretation}</div>
    </div>
  );
}

export function OIBuildupCard({ buildup }: { buildup: OIBuildup }) {
  if (!buildup) return null;

  const netCls = buildup.net_read === "BULLISH" ? "bull"
              : buildup.net_read === "BEARISH" ? "bear"
              : "neutral";

  const callStrikes = (buildup.top_strikes ?? []).filter((s) => s.side === "CE");
  const putStrikes  = (buildup.top_strikes ?? []).filter((s) => s.side === "PE");

  return (
    <div className="oi-card">
      <div className="section-title">
        OI Buildup
        <span className={`oi-net-pill ${netCls}`}>{buildup.net_read}</span>
      </div>

      <div className="oi-summary">{buildup.summary}</div>

      {/* Wall migration */}
      <div className="oi-migration-grid">
        <MigrationCell title="Call wall" mig={buildup.call_wall_migration} />
        <MigrationCell title="Put wall"  mig={buildup.put_wall_migration} />
      </div>

      {/* Top strikes table */}
      <div className="oi-strikes-wrap">
        <div className="oi-strikes-side">
          <div className="oi-side-header oi-side-call">CALLS · resistance</div>
          <table className="oi-table">
            <thead>
              <tr>
                <th>Strike</th>
                <th>OI</th>
                <th>ΔOI</th>
                <th>Δ%</th>
                <th>Buildup</th>
              </tr>
            </thead>
            <tbody>
              {callStrikes.length === 0 && (
                <tr><td colSpan={5} className="oi-empty">no data</td></tr>
              )}
              {callStrikes.map((s) => (
                <tr key={`CE-${s.strike}`}>
                  <td className="oi-strike">{fmt(s.strike)}</td>
                  <td>{fmt(s.oi)}</td>
                  <td className={s.oi_change >= 0 ? "bull" : "bear"}>{fmtSigned(s.oi_change)}</td>
                  <td className={(s.ltp_change_pct ?? 0) >= 0 ? "bull" : "bear"}>
                    {s.ltp_change_pct != null ? fmtSigned(s.ltp_change_pct, 1) + "%" : "—"}
                  </td>
                  <td><span className={`oi-tag ${buildupClass(s.buildup_type)}`}>{s.buildup_type}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="oi-strikes-side">
          <div className="oi-side-header oi-side-put">PUTS · support</div>
          <table className="oi-table">
            <thead>
              <tr>
                <th>Strike</th>
                <th>OI</th>
                <th>ΔOI</th>
                <th>Δ%</th>
                <th>Buildup</th>
              </tr>
            </thead>
            <tbody>
              {putStrikes.length === 0 && (
                <tr><td colSpan={5} className="oi-empty">no data</td></tr>
              )}
              {putStrikes.map((s) => (
                <tr key={`PE-${s.strike}`}>
                  <td className="oi-strike">{fmt(s.strike)}</td>
                  <td>{fmt(s.oi)}</td>
                  <td className={s.oi_change >= 0 ? "bull" : "bear"}>{fmtSigned(s.oi_change)}</td>
                  <td className={(s.ltp_change_pct ?? 0) >= 0 ? "bull" : "bear"}>
                    {s.ltp_change_pct != null ? fmtSigned(s.ltp_change_pct, 1) + "%" : "—"}
                  </td>
                  <td><span className={`oi-tag ${buildupClass(s.buildup_type)}`}>{s.buildup_type}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-strike implication notes */}
      {(buildup.top_strikes ?? []).some((s) => s.implication) && (
        <div className="oi-implications">
          {buildup.top_strikes.map((s, i) =>
            s.implication ? (
              <div key={i} className="oi-impl-row">
                <span className={`oi-impl-side ${s.side === "CE" ? "side-call" : "side-put"}`}>
                  {fmt(s.strike)} {s.side}
                </span>
                <span className="oi-impl-text">{s.implication}</span>
              </div>
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
