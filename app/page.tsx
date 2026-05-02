"use client";

import { useState, useEffect, useRef } from "react";
import type { ScanOutput, ScanMeta, ClaudeModel } from "@/lib/claude";
import type { ConfluenceReport } from "@/lib/confluence";
import type { AdvanceDeclineSnapshot } from "@/lib/breeze";
import type { StrangleProposal } from "@/lib/strangle";
import type { DailyStructureSnapshot } from "@/lib/daily-structure";
import { BiasCard } from "@/components/BiasCard";
import { StrategyCard } from "@/components/StrategyCard";
import { SessionStrip, OptionsSummary, Caveats } from "@/components/SessionContext";
import { OIBuildupCard } from "@/components/OIBuildupCard";
import { ConfluenceCard } from "@/components/ConfluenceCard";
import { AdvanceDeclineCard } from "@/components/AdvanceDeclineCard";
import { StrangleCard } from "@/components/StrangleCard";
import { DailyStructureCard } from "@/components/DailyStructureCard";
import { MarketTicker } from "@/components/MarketTicker";
import { SettingsPanel, useSettings } from "@/components/SettingsPanel";
import { OIScreenshotUploader, useUploadedChain } from "@/components/OIScreenshotUploader";
import type { UploadedChainData } from "@/components/OIScreenshotUploader";
import { CSVUploader, useUploadedCSV } from "@/components/CSVUploader";
import type { UploadedCSVData } from "@/components/CSVUploader";
import { DataSourcesPanel } from "@/components/DataSourcesPanel";

interface ChainMeta {
  source: "breeze" | "upload" | "none";
  used_uploaded: boolean;
  uploaded_at: string | null;
  strikes_count: number;
}

interface SourceStatus {
  name: string;
  status: "ok" | "failed" | "skipped";
  detail: string;
  count?: number;
}

interface ScanResponse {
  ok: boolean;
  degraded?: boolean;
  timestamp?: string;
  bars_used?: number;
  total_3min_bars?: number;
  data_sources?: SourceStatus[];
  warnings?: string[];
  result?: ScanOutput | null;
  meta?: ScanMeta | null;
  confluence?: ConfluenceReport | null;
  advance_decline?: AdvanceDeclineSnapshot | null;
  strangle?: StrangleProposal | null;
  daily_structure?: DailyStructureSnapshot | null;
  chain_meta?: ChainMeta;
  error?: string;
}

export default function Home() {
  const { settings, save: saveSettings } = useSettings();
  const { data: uploadedChain, save: saveUploadedChain } = useUploadedChain();
  const { data: uploadedCSV, save: saveUploadedCSV } = useUploadedCSV();
  const [showUploader, setShowUploader] = useState(false);
  const [data, setData] = useState<ScanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [scanCount, setScanCount] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const runScan = async (overrideModel?: ClaudeModel, overrideToken?: string) => {
    setLoading(true);
    setError(null);
    const model = overrideModel ?? settings.model;
    const sessionToken = overrideToken ?? settings.sessionToken;

    try {
      // Priority: uploaded CSV > uploaded screenshot > Breeze
      // CSV is structured and accurate; screenshot is OCR-based; Breeze is live API
      const chainToSend = uploadedCSV?.chain ?? uploadedChain?.chain;
      const chainSource = uploadedCSV ? "csv" : uploadedChain ? "screenshot" : null;
      const chainAt     = uploadedCSV?.uploaded_at ?? uploadedChain?.uploaded_at;

      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          sessionToken,
          uploadedChain: chainToSend,
          uploadedAt:    chainAt,
          uploadSource:  chainSource,
          preferUpload:  settings.preferUpload === true || !!chainToSend,
        }),
      });
      const json: ScanResponse = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Scan failed");
        setData(null);
      } else {
        setData(json);
        setScanCount((c) => c + 1);
        if (json.meta?.estimated_cost_usd) {
          setTotalCost((t) => t + json.meta!.estimated_cost_usd);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => runScan(), 3 * 60 * 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, settings]);

  const lastUpdated = data?.timestamp
    ? new Date(data.timestamp).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
      })
    : null;

  const meta = data?.meta;

  return (
    <main className="shell">
      {/* Header */}
      <header className="header">
        <div>
          <div className="brand">3-Mint <span className="accent">/</span> Nifty 50</div>
          <div className="subtitle">Three-strategy intraday scan · 3-min timeframe</div>
        </div>
        <div className="header-right">
          {lastUpdated && (
            <div className="timestamp">
              Last scan<br />
              <span className="value">{lastUpdated} IST</span>
              {data?.bars_used && <><br /><span style={{ fontSize: 9 }}>{data.bars_used} bars</span></>}
            </div>
          )}
          <SettingsPanel onSave={saveSettings} />
        </div>
      </header>

      {/* Market ticker */}
      <MarketTicker />

      {/* Controls */}
      <div className="controls">
        <button className="btn-primary" onClick={() => runScan()} disabled={loading}>
          {loading ? <><span className="spinner" />Scanning…</> : "▶ Run scan"}
        </button>

        <div
          className="toggle-wrap"
          onClick={() => setAutoRefresh((v) => !v)}
          style={{ cursor: "pointer" }}
        >
          <div className={`toggle ${autoRefresh ? "on" : ""}`} />
          Auto · 3 min
        </div>

        {/* Model badge */}
        <div className="model-badge">
          {settings.model === "claude-opus-4-7" ? "Opus 4.7" : "Sonnet 4.6"}
        </div>

        {/* OI source pill — clickable to open uploader */}
        <button
          className={`oi-source-pill ${
            data?.chain_meta?.source === "upload" ? "upload" :
            data?.chain_meta?.source === "breeze" ? "breeze" :
            (uploadedCSV || uploadedChain) ? "ready" : "idle"
          }`}
          onClick={() => setShowUploader((v) => !v)}
          title="Upload OI CSV (recommended) or screenshot as fallback for Breeze"
        >
          {data?.chain_meta?.source === "upload"
            ? `📄 ${uploadedCSV ? "CSV" : "Screenshot"} (${data.chain_meta.strikes_count})`
            : data?.chain_meta?.source === "breeze"
              ? `🔌 Breeze (${data.chain_meta.strikes_count})`
              : uploadedCSV
                ? `📄 CSV ready (${uploadedCSV.chain.length})`
                : uploadedChain
                  ? `📊 Screenshot ready (${uploadedChain.chain.length})`
                  : "📄 Upload OI"}
        </button>

        {/* Prompt cache status from last scan */}
        {meta && (
          <div className="cache-stat" title="Prompt cache savings from last scan">
            {meta.cache_read_tokens > 0
              ? `⚡ cached ${meta.cache_read_tokens.toLocaleString()} tok`
              : "○ no cache yet"}
          </div>
        )}

        <div className={`status ${error ? "error" : ""}`}>
          {error ? "✕ Error" : data ? "● Live" : "○ Idle"}
        </div>
      </div>

      {/* OI Upload panel — collapsible. Two methods: CSV (preferred) or screenshot */}
      {showUploader && (
        <div className="oi-upload-panel">
          <div className="oi-upload-panel-header">
            <div>
              <div className="oi-upload-title">OI Data Upload</div>
              <div className="oi-upload-hint">
                Use when Breeze fails or markets are closed. Two methods:
                <strong> CSV</strong> (recommended — structured, accurate, instant) or
                <strong> Screenshot</strong> (parsed via Claude Vision).
                If both are uploaded, CSV is used. Re-upload every 15 min during market hours for fresh OI signal.
              </div>
            </div>
            <button className="modal-close" onClick={() => setShowUploader(false)}>✕</button>
          </div>

          <div className="oi-upload-controls">
            <label className="oi-upload-toggle-row">
              <input
                type="checkbox"
                checked={settings.preferUpload === true}
                onChange={(e) => saveSettings({ ...settings, preferUpload: e.target.checked })}
              />
              <span>
                <strong>Always prefer upload over Breeze</strong>
                <span className="oi-upload-toggle-hint">
                  When checked, scans always use uploaded data, even if Breeze works.
                  Otherwise, upload is used only when Breeze fails or no upload is fresher.
                </span>
              </span>
            </label>
          </div>

          {/* CSV uploader (primary) */}
          <div className="oi-upload-section">
            <div className="oi-upload-section-title">
              <span className="oi-upload-section-num">1</span>
              CSV from NSE Option Chain · recommended
            </div>
            <CSVUploader
              onParsed={() => { /* state saved in component via useUploadedCSV */ }}
              onCleared={() => { /* component handles localStorage */ }}
            />
          </div>

          {/* Divider */}
          <div className="oi-upload-divider">
            <span>OR</span>
          </div>

          {/* Screenshot uploader (fallback) */}
          <div className="oi-upload-section">
            <div className="oi-upload-section-title">
              <span className="oi-upload-section-num">2</span>
              Screenshot of any options chain · fallback
            </div>
            <OIScreenshotUploader
              onParsed={() => { /* state saved via useUploadedChain */ }}
              onCleared={() => { /* component handles localStorage */ }}
            />
          </div>
        </div>
      )}

      {/* Cost tracker */}
      {scanCount > 0 && (
        <div className="cost-strip">
          <span>Session · {scanCount} scan{scanCount !== 1 ? "s" : ""}</span>
          <span className="cost-sep">·</span>
          <span>
            Last scan ~${meta?.estimated_cost_usd?.toFixed(5) ?? "—"}
            {meta?.cache_read_tokens ? " (cached)" : ""}
          </span>
          <span className="cost-sep">·</span>
          <span>Session total ~${totalCost.toFixed(4)}</span>
          {meta && (
            <>
              <span className="cost-sep">·</span>
              <span>in {meta.input_tokens.toLocaleString()} / out {meta.output_tokens.toLocaleString()} tok</span>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <strong>Error</strong>{error}
        </div>
      )}

      {!data && !loading && !error && (
        <div className="empty-state">
          <div className="big">No scan data yet.</div>
          <div>Press "Run scan" to fetch live Nifty data and compute the three strategies.</div>
          {!settings.sessionToken && (
            <div className="empty-hint">
              ⚙ Set your Breeze session token in Settings before scanning.
            </div>
          )}
        </div>
      )}

      {/* Data sources panel — always show when we have any scan response */}
      {data?.data_sources && (
        <DataSourcesPanel
          sources={data.data_sources}
          warnings={data.warnings}
          degraded={data.degraded}
        />
      )}

      {data?.result && (
        <>
          <SessionStrip session={data.result.session_context} />

          {/* Daily structure — regime context for everything below */}
          {data.daily_structure && <DailyStructureCard ds={data.daily_structure} />}

          {/* Confluence comes right after — it's the headline read */}
          {data.confluence && <ConfluenceCard confluence={data.confluence} />}

          <BiasCard bias={data.result.bias} />

          <div className="section-title">
            Strategy Signals
            <span className="small">VRL & EMA-anchored · R:R ≥ 1.5 to clear filter</span>
          </div>
          <div className="strategies-grid">
            {data.result.strategies.map((s) => (
              <StrategyCard key={s.strategy} signal={s} />
            ))}
          </div>

          {/* Market internals: A/D breadth */}
          {data.advance_decline && <AdvanceDeclineCard ad={data.advance_decline} />}

          <OptionsSummary summary={data.result.options_chain_summary} />
          {data.result.oi_buildup && <OIBuildupCard buildup={data.result.oi_buildup} />}
          {data.strangle && <StrangleCard strangle={data.strangle} />}
          <Caveats caveats={data.result.caveats} />
        </>
      )}

      <footer className="footer">
        Mechanical strategy signals + discretionary bias · Position sizing and final decisions are yours · Powered by Claude
      </footer>
    </main>
  );
}
