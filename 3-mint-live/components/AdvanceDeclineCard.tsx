import type { AdvanceDeclineSnapshot, StockQuote } from "@/lib/breeze";

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function biasClass(bias: AdvanceDeclineSnapshot["bias"]): string {
  switch (bias) {
    case "STRONG_UP":     return "strong-up";
    case "MODERATE_UP":   return "mod-up";
    case "STRONG_DOWN":   return "strong-down";
    case "MODERATE_DOWN": return "mod-down";
    default:              return "balanced";
  }
}

function biasLabel(bias: AdvanceDeclineSnapshot["bias"]): string {
  switch (bias) {
    case "STRONG_UP":     return "Strong breadth ↑";
    case "MODERATE_UP":   return "Moderate breadth ↑";
    case "STRONG_DOWN":   return "Strong breadth ↓";
    case "MODERATE_DOWN": return "Moderate breadth ↓";
    default:              return "Balanced";
  }
}

function MoverRow({ q }: { q: StockQuote }) {
  const cls = (q.change_pct ?? 0) >= 0 ? "bull" : "bear";
  return (
    <div className="ad-mover-row">
      <span className="ad-mover-symbol">{q.symbol}</span>
      <span className={`ad-mover-pct ${cls}`}>{fmtPct(q.change_pct)}</span>
    </div>
  );
}

export function AdvanceDeclineCard({ ad }: { ad: AdvanceDeclineSnapshot }) {
  const advPct = (ad.advances / ad.total) * 100;
  const decPct = (ad.declines / ad.total) * 100;
  const uncPct = (ad.unchanged / ad.total) * 100;

  return (
    <div className="ad-card">
      <div className="section-title">
        Advances / Declines · Nifty 50
        <span className="small">{ad.total - ad.errors}/{ad.total} fetched</span>
      </div>

      {/* Header stats */}
      <div className="ad-header">
        <div className="ad-stat">
          <div className="ad-stat-label">Advances</div>
          <div className="ad-stat-value bull">{ad.advances}</div>
        </div>
        <div className="ad-stat">
          <div className="ad-stat-label">Declines</div>
          <div className="ad-stat-value bear">{ad.declines}</div>
        </div>
        <div className="ad-stat">
          <div className="ad-stat-label">Unchanged</div>
          <div className="ad-stat-value muted">{ad.unchanged}</div>
        </div>
        <div className="ad-stat">
          <div className="ad-stat-label">A/D Ratio</div>
          <div className="ad-stat-value">{ad.ratio.toFixed(2)}</div>
        </div>
        <div className={`ad-bias-pill ${biasClass(ad.bias)}`}>
          {biasLabel(ad.bias)}
        </div>
      </div>

      {/* Visual breadth bar */}
      <div className="ad-bar">
        <div className="ad-seg adv" style={{ width: `${advPct}%` }}>
          {advPct > 8 ? <span>{ad.advances} ↑</span> : null}
        </div>
        <div className="ad-seg unc" style={{ width: `${uncPct}%` }} />
        <div className="ad-seg dec" style={{ width: `${decPct}%` }}>
          {decPct > 8 ? <span>{ad.declines} ↓</span> : null}
        </div>
      </div>

      {/* Top movers */}
      <div className="ad-movers-grid">
        <div>
          <div className="ad-movers-header bull">Top gainers</div>
          {ad.top_gainers.map((q) => <MoverRow key={q.symbol} q={q} />)}
        </div>
        <div>
          <div className="ad-movers-header bear">Top losers</div>
          {ad.top_losers.map((q) => <MoverRow key={q.symbol} q={q} />)}
        </div>
      </div>
    </div>
  );
}
