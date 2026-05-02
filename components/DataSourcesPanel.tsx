"use client";

interface SourceStatus {
  name: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  count?: number;
}

interface Props {
  sources: SourceStatus[];
  warnings?: string[];
  degraded?: boolean;
}

function statusIcon(s: SourceStatus["status"]): string {
  if (s === "ok") return "✓";
  if (s === "failed") return "✕";
  return "○";
}

export function DataSourcesPanel({ sources, warnings, degraded }: Props) {
  if (!sources || sources.length === 0) return null;

  const okCount = sources.filter((s) => s.status === "ok").length;
  const failedCount = sources.filter((s) => s.status === "failed").length;
  const skippedCount = sources.filter((s) => s.status === "skipped").length;

  return (
    <div className={`ds-panel ${degraded ? "degraded" : "healthy"}`}>
      <div className="ds-panel-header">
        <div className="ds-title">
          Data Sources
          <span className="ds-summary">
            <span className="ds-stat ok">{okCount} OK</span>
            {failedCount > 0 && <span className="ds-stat failed">{failedCount} failed</span>}
            {skippedCount > 0 && <span className="ds-stat skipped">{skippedCount} skipped</span>}
          </span>
        </div>
        {degraded && (
          <div className="ds-degraded-pill">⚠ Running degraded</div>
        )}
      </div>

      <div className="ds-rows">
        {sources.map((s, i) => (
          <div key={i} className={`ds-row ${s.status}`}>
            <span className="ds-icon">{statusIcon(s.status)}</span>
            <span className="ds-name">{s.name}</span>
            <span className="ds-detail">{s.detail}</span>
          </div>
        ))}
      </div>

      {warnings && warnings.length > 0 && (
        <div className="ds-warnings">
          {warnings.map((w, i) => (
            <div key={i} className="ds-warning">⚠ {w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
