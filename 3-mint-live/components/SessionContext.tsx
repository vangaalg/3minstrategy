import type { ScanOutput } from "@/lib/claude";

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function SessionStrip({ session }: { session: ScanOutput["session_context"] }) {
  const change = session.spot - session.day_open;
  const changePct = session.day_open ? (change / session.day_open) * 100 : 0;
  const changeCls = change >= 0 ? "bull" : "bear";

  return (
    <div className="session-strip">
      <div className="session-cell">
        <div className="label">Spot</div>
        <div className="value">{fmt(session.spot)}</div>
      </div>
      <div className="session-cell">
        <div className="label">Δ from open</div>
        <div className={`value ${changeCls}`}>
          {change >= 0 ? "+" : ""}
          {fmt(change)} ({change >= 0 ? "+" : ""}
          {changePct.toFixed(2)}%)
        </div>
      </div>
      <div className="session-cell">
        <div className="label">Day H / L</div>
        <div className="value" style={{ fontSize: 14 }}>
          {fmt(session.day_high)} / {fmt(session.day_low)}
        </div>
      </div>
      <div className="session-cell">
        <div className="label">VIX</div>
        <div className="value">{fmt(session.vix)}</div>
      </div>
      <div className="session-cell">
        <div className="label">{session.is_expiry_day ? "⚠ Expiry day" : "Session"}</div>
        <div className="value" style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          {session.time_of_day_note}
        </div>
      </div>
    </div>
  );
}

export function OptionsSummary({ summary }: { summary: ScanOutput["options_chain_summary"] }) {
  return (
    <div className="options-summary">
      <div className="section-title">Options Chain</div>
      <div className="opt-grid">
        <div className="opt-cell">
          <div className="label">PCR</div>
          <div className="value">{summary.pcr != null ? summary.pcr.toFixed(2) : "—"}</div>
        </div>
        <div className="opt-cell">
          <div className="label">Max Pain</div>
          <div className="value">{fmt(summary.max_pain)}</div>
        </div>
        <div className="opt-cell">
          <div className="label">Call wall</div>
          <div className="value">{fmt(summary.highest_call_oi_strike)}</div>
        </div>
        <div className="opt-cell">
          <div className="label">Put wall</div>
          <div className="value">{fmt(summary.highest_put_oi_strike)}</div>
        </div>
      </div>
      {summary.iv_skew_note && <div className="iv-skew-note">{summary.iv_skew_note}</div>}
    </div>
  );
}

export function Caveats({ caveats }: { caveats: string[] }) {
  if (!caveats || caveats.length === 0) return null;
  return (
    <div className="caveats">
      <div className="section-title">Caveats</div>
      <ul>
        {caveats.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
    </div>
  );
}
