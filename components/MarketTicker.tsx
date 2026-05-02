"use client";

import { useState, useEffect } from "react";
import type { MarketQuote } from "@/lib/market-data";

interface TickerData {
  ok: boolean;
  quotes: MarketQuote[];
  timestamp: string;
}

function QuoteCell({ q }: { q: MarketQuote }) {
  const up   = (q.change_pct ?? 0) >= 0;
  const cls  = q.error ? "muted" : up ? "up" : "down";
  const sign = up ? "+" : "";

  return (
    <div className="ticker-cell">
      <div className="ticker-label">{q.label}</div>
      {q.error ? (
        <div className="ticker-value muted">n/a</div>
      ) : (
        <>
          <div className={`ticker-value ${cls}`}>
            {q.price != null
              ? q.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })
              : "—"}
            <span className="ticker-unit">{q.unit}</span>
          </div>
          <div className={`ticker-change ${cls}`}>
            {q.change_pct != null
              ? `${sign}${q.change_pct.toFixed(2)}%`
              : ""}
          </div>
        </>
      )}
    </div>
  );
}

export function MarketTicker() {
  const [data, setData] = useState<TickerData | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const fetchData = async () => {
    try {
      const res = await fetch("/api/market-data");
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }));
    } catch { /* silent fail — ticker is non-critical */ }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60_000); // refresh every 60s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="ticker-strip">
      <div className="ticker-label-global">GLOBAL</div>
      {data?.quotes ? (
        data.quotes.map((q) => <QuoteCell key={q.symbol} q={q} />)
      ) : (
        <div className="ticker-loading">fetching market data…</div>
      )}
      {lastUpdated && (
        <div className="ticker-timestamp">{lastUpdated} IST</div>
      )}
    </div>
  );
}
