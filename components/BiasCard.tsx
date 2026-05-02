import type { ScanOutput } from "@/lib/claude";

export function BiasCard({ bias }: { bias: ScanOutput["bias"] }) {
  const cls = bias.direction.toLowerCase(); // bullish | bearish | neutral

  return (
    <div className={`bias-card ${cls}`}>
      <div className="bias-header">
        <div>
          <div className="section-title" style={{ borderBottom: "none", marginBottom: 4, paddingBottom: 0 }}>
            Market Bias
          </div>
          <div className={`bias-direction ${cls}`}>{bias.direction}</div>
        </div>
        <span className="confidence-pill">Confidence · {bias.confidence}</span>
      </div>

      <div className="bias-evidence">
        <div>
          <h4>Evidence</h4>
          <ul>
            {bias.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
        {bias.conflicting_signals && bias.conflicting_signals.length > 0 && (
          <div>
            <h4>Conflicting</h4>
            <ul>
              {bias.conflicting_signals.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {bias.invalidated_if && (
        <div className="bias-invalidation">
          <strong>Invalidated if</strong>
          {bias.invalidated_if}
        </div>
      )}
    </div>
  );
}
