"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { parseNSEOptionChainCSV, type ParsedCSVChain, type ParsedStrike } from "@/lib/csv-parser";

export interface UploadedCSVData {
  chain: ParsedStrike[];
  detected_underlying: string;
  detected_expiry: string | null;
  filename: string;
  uploaded_at: string;     // ISO
  parse_warnings: string[];
}

const STORAGE_KEY = "3mint_uploaded_csv_chain";
const STALE_MINUTES = 20; // CSVs go stale faster than screenshots — OI moves fast

export function useUploadedCSV() {
  const [data, setData] = useState<UploadedCSVData | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setData(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const save = useCallback((d: UploadedCSVData | null) => {
    setData(d);
    try {
      if (d) localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      else   localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  return { data, save };
}

export function isCSVStale(uploadedAt: string): boolean {
  return (Date.now() - new Date(uploadedAt).getTime()) / 60000 > STALE_MINUTES;
}

export function csvAgeLabel(uploadedAt: string): string {
  const ageMin = Math.floor((Date.now() - new Date(uploadedAt).getTime()) / 60000);
  if (ageMin < 1) return "just now";
  if (ageMin === 1) return "1 min ago";
  if (ageMin < 60) return `${ageMin} min ago`;
  const hr = Math.floor(ageMin / 60);
  return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
}

interface Props {
  onParsed: (data: UploadedCSVData) => void;
  onCleared: () => void;
}

export function CSVUploader({ onParsed, onCleared }: Props) {
  const { data, save } = useUploadedCSV();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [, setTick] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh age label every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Please upload a .csv file (NSE option chain export)");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("File is over 2 MB — CSV exports are typically ~30 KB. Wrong file?");
      return;
    }

    setParsing(true);
    try {
      const text = await file.text();
      const parsed: ParsedCSVChain = parseNSEOptionChainCSV(text, file.name);

      if (parsed.chain.length === 0) {
        setError("No strikes parsed. " + parsed.parse_warnings.join(" "));
        setParsing(false);
        return;
      }

      const uploaded: UploadedCSVData = {
        chain: parsed.chain,
        detected_underlying: parsed.detected_underlying,
        detected_expiry: parsed.detected_expiry,
        filename: file.name,
        uploaded_at: new Date().toISOString(),
        parse_warnings: parsed.parse_warnings,
      };
      save(uploaded);
      onParsed(uploaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const clear = () => {
    save(null);
    onCleared();
  };

  if (data) {
    const stale = isCSVStale(data.uploaded_at);
    const ageLabel = csvAgeLabel(data.uploaded_at);

    // Quick stats
    const callOIStrikes = data.chain.filter((r) => (r.call_oi ?? 0) > 0).length;
    const putOIStrikes  = data.chain.filter((r) => (r.put_oi  ?? 0) > 0).length;

    // Find highest call OI and highest put OI for a quick preview
    const topCall = [...data.chain].sort((a, b) => (b.call_oi ?? 0) - (a.call_oi ?? 0))[0];
    const topPut  = [...data.chain].sort((a, b) => (b.put_oi  ?? 0) - (a.put_oi  ?? 0))[0];

    return (
      <div className={`csv-card ${stale ? "stale" : "fresh"}`}>
        <div className="csv-card-header">
          <span className="csv-status">
            {stale ? "⚠ Stale CSV" : "● Active CSV"}
          </span>
          <span className="csv-age">uploaded {ageLabel}</span>
        </div>

        <div className="csv-meta">
          <div className="csv-meta-row">
            <span className="meta-label">File</span>
            <span className="meta-value csv-filename">{data.filename}</span>
          </div>
          <div className="csv-meta-row">
            <span className="meta-label">Underlying</span>
            <span className="meta-value">{data.detected_underlying}</span>
          </div>
          {data.detected_expiry && (
            <div className="csv-meta-row">
              <span className="meta-label">Expiry</span>
              <span className="meta-value">{data.detected_expiry}</span>
            </div>
          )}
          <div className="csv-meta-row">
            <span className="meta-label">Strikes</span>
            <span className="meta-value">
              {data.chain.length} <span className="meta-sub">({callOIStrikes} call · {putOIStrikes} put OI)</span>
            </span>
          </div>
          {topCall && topCall.call_oi != null && (
            <div className="csv-meta-row">
              <span className="meta-label">Top Call OI</span>
              <span className="meta-value">
                {topCall.strike_price.toLocaleString("en-IN")} CE <span className="meta-sub">({topCall.call_oi.toLocaleString("en-IN")})</span>
              </span>
            </div>
          )}
          {topPut && topPut.put_oi != null && (
            <div className="csv-meta-row">
              <span className="meta-label">Top Put OI</span>
              <span className="meta-value">
                {topPut.strike_price.toLocaleString("en-IN")} PE <span className="meta-sub">({topPut.put_oi.toLocaleString("en-IN")})</span>
              </span>
            </div>
          )}
        </div>

        {stale && (
          <div className="csv-stale-warning">
            More than {STALE_MINUTES} min old — OI moves meaningfully every 5–15 min during market hours. Re-upload for accurate signal.
          </div>
        )}

        <div className="csv-actions">
          <button
            className="btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={parsing}
          >
            {parsing ? "Parsing…" : "↻ Replace"}
          </button>
          <button className="btn-danger" onClick={clear} disabled={parsing}>
            ✕ Remove
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
    );
  }

  return (
    <div
      className={`csv-dropzone ${dragOver ? "drag-over" : ""} ${parsing ? "parsing" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onClick={() => !parsing && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
      {parsing ? (
        <>
          <span className="spinner" />
          <div className="csv-dropzone-msg">Parsing CSV…</div>
        </>
      ) : (
        <>
          <div className="csv-dropzone-icon">📄</div>
          <div className="csv-dropzone-msg">Drop NSE option chain CSV here, or click to upload</div>
          <div className="csv-dropzone-sub">
            From <a href="https://www.nseindia.com/option-chain" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="csv-link">nseindia.com/option-chain</a> → Download (CSV) button · refresh every 15 min during market hours
          </div>
        </>
      )}
      {error && <div className="csv-error">{error}</div>}
    </div>
  );
}
