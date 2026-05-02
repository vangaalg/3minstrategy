"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface UploadedChainData {
  chain: any[]; // OptionChainRow[]
  detected_underlying: string | null;
  detected_expiry: string | null;
  detected_spot: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
  uploaded_at: string;     // when user uploaded
  parsed_at: string;       // when Claude parsed
  imageDataUrl?: string;   // for preview
}

const STORAGE_KEY = "3mint_uploaded_oi_chain";
const STALE_MINUTES = 15; // warn if uploaded chain is older than 15 min

export function useUploadedChain() {
  const [data, setData] = useState<UploadedChainData | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setData(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  const save = useCallback((d: UploadedChainData | null) => {
    setData(d);
    try {
      if (d) localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
      else   localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  return { data, save };
}

export function isChainStale(uploadedAt: string): boolean {
  const age = (Date.now() - new Date(uploadedAt).getTime()) / 60000;
  return age > STALE_MINUTES;
}

export function chainAgeLabel(uploadedAt: string): string {
  const ageMin = Math.floor((Date.now() - new Date(uploadedAt).getTime()) / 60000);
  if (ageMin < 1) return "just now";
  if (ageMin === 1) return "1 min ago";
  if (ageMin < 60) return `${ageMin} min ago`;
  const hr = Math.floor(ageMin / 60);
  return hr === 1 ? "1 hour ago" : `${hr} hours ago`;
}

interface Props {
  onParsed: (data: UploadedChainData) => void;
  onCleared: () => void;
}

export function OIScreenshotUploader({ onParsed, onCleared }: Props) {
  const { data, save } = useUploadedChain();
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [tick, setTick] = useState(0); // forces age label re-render
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Refresh age label every 30s
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file (PNG / JPG / WebP)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image is over 10 MB — please compress before uploading");
      return;
    }

    setParsing(true);

    // Read as data URL for preview
    const reader = new FileReader();
    reader.onload = async () => {
      const imageDataUrl = reader.result as string;
      const base64 = imageDataUrl.split(",")[1];

      try {
        const res = await fetch("/api/parse-oi-screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mediaType: file.type }),
        });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error ?? "Parse failed");
          setParsing(false);
          return;
        }
        if (!json.chain || json.chain.length === 0) {
          setError("No options chain detected in the image. " + (json.notes ?? ""));
          setParsing(false);
          return;
        }

        const uploaded: UploadedChainData = {
          chain: json.chain,
          detected_underlying: json.detected_underlying,
          detected_expiry: json.detected_expiry,
          detected_spot: json.detected_spot,
          confidence: json.confidence,
          notes: json.notes,
          uploaded_at: new Date().toISOString(),
          parsed_at: json.parsed_at,
          imageDataUrl,
        };
        save(uploaded);
        onParsed(uploaded);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setParsing(false);
      }
    };
    reader.readAsDataURL(file);
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

  // Pasted screenshots support
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            handleFile(file);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (data) {
    const stale = isChainStale(data.uploaded_at);
    const ageLabel = chainAgeLabel(data.uploaded_at);

    return (
      <div className={`oi-upload-card ${stale ? "stale" : "fresh"}`}>
        <div className="oi-upload-header">
          <span className="oi-upload-status">
            {stale ? "⚠ Stale screenshot" : "● Active screenshot"}
          </span>
          <span className="oi-upload-age">uploaded {ageLabel}</span>
        </div>

        <div className="oi-upload-body">
          {data.imageDataUrl && (
            <img src={data.imageDataUrl} alt="OI screenshot" className="oi-upload-thumb" />
          )}

          <div className="oi-upload-meta">
            <div className="meta-row">
              <span className="meta-label">Strikes parsed</span>
              <span className="meta-value">{data.chain.length}</span>
            </div>
            {data.detected_underlying && (
              <div className="meta-row">
                <span className="meta-label">Underlying</span>
                <span className="meta-value">{data.detected_underlying}</span>
              </div>
            )}
            {data.detected_expiry && (
              <div className="meta-row">
                <span className="meta-label">Expiry</span>
                <span className="meta-value">{data.detected_expiry}</span>
              </div>
            )}
            {data.detected_spot != null && (
              <div className="meta-row">
                <span className="meta-label">Spot</span>
                <span className="meta-value">{data.detected_spot.toLocaleString("en-IN")}</span>
              </div>
            )}
            <div className="meta-row">
              <span className="meta-label">Confidence</span>
              <span className={`meta-value conf-${data.confidence}`}>{data.confidence}</span>
            </div>
          </div>
        </div>

        {data.notes && data.notes.length > 0 && (
          <div className="oi-upload-notes">{data.notes}</div>
        )}

        {stale && (
          <div className="oi-upload-stale-warning">
            Screenshot is more than {STALE_MINUTES} min old — OI changes meaningfully every few minutes during market hours. Re-upload for fresh signal.
          </div>
        )}

        <div className="oi-upload-actions">
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
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
    );
  }

  return (
    <div
      className={`oi-upload-dropzone ${dragOver ? "drag-over" : ""} ${parsing ? "parsing" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(false)}
      onClick={() => !parsing && fileInputRef.current?.click()}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />

      {parsing ? (
        <>
          <span className="spinner" />
          <div className="oi-upload-msg">Parsing screenshot via Claude Vision…</div>
          <div className="oi-upload-sub">~3-5 seconds</div>
        </>
      ) : (
        <>
          <div className="oi-upload-icon">📊</div>
          <div className="oi-upload-msg">Drop OI screenshot here, paste from clipboard, or click to upload</div>
          <div className="oi-upload-sub">
            NSE / Sensibull / Opstra / broker terminal · PNG, JPG, WebP · max 10 MB
          </div>
        </>
      )}

      {error && <div className="oi-upload-error">{error}</div>}
    </div>
  );
}
