import type { StrategySignal } from "@/lib/claude";

const STRATEGY_NAMES: Record<number, string> = {
  1: "EMA 5 × SMA 20 mean-reversion",
  2: "Bollinger VRL recovery breakout",
  3: "SMA 20 pullback continuation",
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function fmtRR(n: number | null): string {
  if (n == null) return "—";
  return `1 : ${n.toFixed(2)}`;
}

export function StrategyCard({ signal }: { signal: StrategySignal }) {
  const fired = signal.fired && signal.direction;
  const cls = fired
    ? signal.direction === "BUY"
      ? "fired-buy"
      : "fired-sell"
    : "";

  return (
    <div className={`strategy-card ${cls}`}>
      <div className="strategy-header">
        <span className="strategy-num">
          <strong>S{signal.strategy}</strong>
          {signal.stage ? `· ${signal.stage}` : ""}
        </span>
        <span
          className={`strategy-status ${
            fired
              ? signal.direction === "BUY"
                ? "buy"
                : "sell"
              : "idle"
          }`}
        >
          {fired ? signal.direction : "no signal"}
        </span>
      </div>

      <div className="strategy-name">
        {signal.name || STRATEGY_NAMES[signal.strategy]}
      </div>

      {fired && (
        <div className="strategy-levels">
          <div className="level">
            <span className="label">Entry</span>
            <span className="value entry">{fmt(signal.entry)}</span>
          </div>
          <div className="level">
            <span className="label">Stop</span>
            <span className="value stop">{fmt(signal.stop_loss)}</span>
          </div>
          <div className="level">
            <span className="label">Target</span>
            <span className="value target">{fmt(signal.target)}</span>
          </div>
          <div className="level">
            <span className="label">R : R</span>
            <span className={`value rr ${signal.filter_passed ? "" : "fail"}`}>
              {fmtRR(signal.rr_ratio)}
              {!signal.filter_passed && (
                <span style={{ fontSize: 9, marginLeft: 6, letterSpacing: "0.05em" }}>
                  · filter fail
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      <div className="strategy-why">
        <span className="why-label">{fired ? "Why fired" : "Status"}</span>
        {signal.why_fired}
      </div>
    </div>
  );
}
