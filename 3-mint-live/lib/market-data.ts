/**
 * Live market data for the dashboard ticker strip.
 * Uses Yahoo Finance v8 quote endpoint — no API key required.
 *
 * Tickers:
 *   ^VIX       India VIX is not on Yahoo; we use CBOE VIX as a proxy.
 *              For real India VIX, the scan fetches it via Breeze separately.
 *   USDINR=X   USD / INR spot
 *   BZ=F       Brent crude futures ($/barrel)
 *   ^DJI       Dow Jones Industrial Average
 *   YM=F       Dow Jones futures (mini)
 *
 * Note: India VIX (^NSEI_VIX) is not available on Yahoo Finance.
 * We fetch it from a separate public source if possible, or mark n/a.
 */

export interface MarketQuote {
  symbol: string;
  label: string;
  price: number | null;
  change: number | null;       // absolute change
  change_pct: number | null;   // % change
  currency: string;
  unit: string;                // display unit e.g. "pts", "₹", "$/bbl"
  error?: string;
}

const TICKERS: { symbol: string; label: string; currency: string; unit: string }[] = [
  { symbol: "^VIX",    label: "CBOE VIX",    currency: "USD", unit: "pts"   },
  { symbol: "USDINR=X",label: "USD / INR",   currency: "INR", unit: "₹"    },
  { symbol: "BZ=F",    label: "Brent Crude", currency: "USD", unit: "$/bbl" },
  { symbol: "^DJI",    label: "Dow Jones",   currency: "USD", unit: "pts"   },
  { symbol: "YM=F",    label: "Dow Futures", currency: "USD", unit: "pts"   },
];

export async function fetchMarketData(): Promise<MarketQuote[]> {
  const symbols = TICKERS.map((t) => t.symbol).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,shortName`;

  let raw: any;
  try {
    const res = await fetch(url, {
      headers: {
        // Yahoo requires a User-Agent header
        "User-Agent": "Mozilla/5.0 (compatible; 3mint-scanner/1.0)",
        "Accept": "application/json",
      },
      cache: "no-store",
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    raw = await res.json();
  } catch (err) {
    // Return all as errors rather than crashing
    return TICKERS.map((t) => ({
      ...t,
      price: null,
      change: null,
      change_pct: null,
      error: err instanceof Error ? err.message : String(err),
    }));
  }

  const results: any[] = raw?.quoteResponse?.result ?? [];
  const bySymbol = new Map(results.map((r: any) => [r.symbol, r]));

  return TICKERS.map((t) => {
    const q = bySymbol.get(t.symbol);
    if (!q) {
      return { ...t, price: null, change: null, change_pct: null, error: "not found" };
    }
    return {
      symbol: t.symbol,
      label: t.label,
      currency: t.currency,
      unit: t.unit,
      price:      q.regularMarketPrice      ?? null,
      change:     q.regularMarketChange     ?? null,
      change_pct: q.regularMarketChangePercent ?? null,
    };
  });
}

/**
 * Attempt to fetch India VIX from NSE's public JSON endpoint.
 * Returns null on failure (not critical).
 */
export async function fetchIndiaVIX(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY",
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; 3mint-scanner/1.0)",
          "Accept": "application/json",
          "Referer": "https://www.nseindia.com/",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // NSE returns vixClose in some endpoints
    return data?.records?.underlyingValue ?? null;
  } catch {
    return null;
  }
}
