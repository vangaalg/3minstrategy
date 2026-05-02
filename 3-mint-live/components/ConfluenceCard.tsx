import type { ConfluenceReport } from "@/lib/confluence";

function tierClass(tier: ConfluenceReport["tier"]): string {
  switch (tier) {
    case "HIGH_BULL":     return "high-bull";
    case "MODERATE_BULL": return "mod-bull";
    case "MODERATE_BEAR": return "mod-bear";
    case "HIGH_BEAR":     return "high-bear";
    default:              return "no-edge";
  }
}

function ScoreBar({ score, max }: { score: number; max: number }) {
  // -max ... 0 ... +max → 0% ... 50% ... 100%
  const pct = ((score + max) / (max * 2)) * 100;
  const bullSide = score > 0;

  return (
    <div className="conf-bar">
      <div className="conf-bar-track">
        <div className="conf-bar-zero" />
        <div
          className={`conf-bar-fill ${bullSide ? "bull" : "bear"}`}
          style={{
            left: bullSide ? "50%" : `${pct}%`,
            width: bullSide ? `${pct - 50}%` : `${50 - pct}%`,
          }}
        />
      </div>
      <div className="conf-bar-labels">
        <span>−{max}</span>
        <span>0</span>
        <span>+{max}</span>
      </div>
    </div>
  );
}

export function ConfluenceCard({ confluence }: { confluence: ConfluenceReport }) {
  const cls = tierClass(confluence.tier);

  return (
    <div className={`conf-card ${cls}`}>
      <div className="conf-header">
        <div>
          <div className="section-title" style={{ borderBottom: "none", marginBottom: 4, paddingBottom: 0 }}>
            Confluence Score
          </div>
          <div className={`conf-tier ${cls}`}>{confluence.tier_label}</div>
        </div>
        <div className="conf-score">
          <span className="conf-score-num">
            {confluence.total_score >= 0 ? "+" : ""}{confluence.total_score}
          </span>
          <span className="conf-score-max">/ {confluence.max_score}</span>
        </div>
      </div>

      <ScoreBar score={confluence.total_score} max={confluence.max_score} />

      <div className="conf-guidance">{confluence.action_guidance}</div>

      {/* Component breakdown */}
      <div className="conf-components">
        <div className="conf-section-label">Signal sources</div>
        {confluence.components.map((c, i) => {
          const dotCls = c.score === 1 ? "bull" : c.score === -1 ? "bear" : "muted";
          const sign  = c.score === 1 ? "+1" : c.score === -1 ? "−1" : "0";
          return (
            <div key={i} className="conf-comp-row">
              <span className={`conf-dot ${dotCls}`}>{sign}</span>
              <span className="conf-comp-source">{c.source}</span>
              <span className="conf-comp-reason">{c.reason}</span>
            </div>
          );
        })}
      </div>

      {/* Contradictions */}
      {confluence.contradictions.length > 0 && (
        <div className="conf-contradictions">
          <div className="conf-section-label">⚠ Contradictions</div>
          {confluence.contradictions.map((c, i) => (
            <div key={i} className="conf-contr-row">{c}</div>
          ))}
        </div>
      )}
    </div>
  );
}
