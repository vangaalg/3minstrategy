/**
 * ICICI Breeze REST API client.
 *
 * Auth model: every request includes headers:
 *   X-AppKey            = API key
 *   X-SessionToken      = base64-encoded session token (the apisession from daily login)
 *   X-Checksum          = "token " + SHA256(timeStamp + JSON.stringify(body) + secret)
 *   X-Timestamp         = ISO 8601 UTC timestamp e.g. "2026-05-02T08:30:00.000Z"
 *
 * FIX (2026-05-04): Breeze /historicalcharts does NOT accept POST — returns 405.
 * All GET endpoints now send params as URL query string, not as request body.
 * Only true write/action endpoints (if any) use POST with a body.
 *
 * Docs: https://api.icicidirect.com/breezeapi/documents/index.html
 */

import { createHash } from "crypto";

const BREEZE_BASE_URL = "https://api.icicidirect.com/breezeapi/api/v1";

interface BreezeCreds {
  apiKey: string;
  apiSecret: string;
  sessionToken: string;
}

function getCreds(): BreezeCreds {
  const apiKey = process.env.BREEZE_API_KEY;
  const apiSecret = process.env.BREEZE_API_SECRET;
  const sessionToken = process.env.BREEZE_SESSION_TOKEN;
  if (!apiKey || !apiSecret || !sessionToken) {
    throw new Error(
      "Missing Breeze credentials. Set BREEZE_API_KEY, BREEZE_API_SECRET, and BREEZE_SESSION_TOKEN in .env.local"
    );
  }
  return { apiKey, apiSecret, sessionToken };
}

/** Encode session token as base64 (Breeze expects base64 of "apiKey:sessionToken"). */
function encodeSessionToken(apiKey: string, sessionToken: string): string {
  return Buffer.from(`${apiKey}:${sessionToken}`).toString("base64");
}

function computeChecksum(timestamp: string, body: string, secret: string): string {
  const raw = timestamp + body + secret;
  const hash = createHash("sha256").update(raw).digest("hex");
  return `token ${hash}`;
}

/**
 * Send a Breeze GET request with params as query string.
 * Checksum is computed over an empty body string "" (no body on GET).
 */
async function breezeGet<T = any>(
  endpoint: string,
  params: Record<string, any>,
  timeoutMs: number = 8000
): Promise<T> {
  const { apiKey, apiSecret, sessionToken } = getCreds();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");

  // GET requests: checksum over empty body
  const checksum = computeChecksum(timestamp, "", apiSecret);

  // Build query string
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const url = `${BREEZE_BASE_URL}${endpoint}?${qs}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Checksum": checksum,
        "X-Timestamp": timestamp,
        "X-AppKey": apiKey,
        "X-SessionToken": encodeSessionToken(apiKey, sessionToken),
      },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as any)?.name === "AbortError") {
      throw new Error(`Breeze ${endpoint} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Breeze ${endpoint} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

/**
 * Send a Breeze POST request with JSON body.
 * Only use this for endpoints that genuinely require POST (write/action endpoints).
 */
async function breezePost<T = any>(
  endpoint: string,
  body: Record<string, any>,
  timeoutMs: number = 8000
): Promise<T> {
  const { apiKey, apiSecret, sessionToken } = getCreds();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const bodyStr = JSON.stringify(body);
  const checksum = computeChecksum(timestamp, bodyStr, apiSecret);

  const url = `${BREEZE_BASE_URL}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Checksum": checksum,
        "X-Timestamp": timestamp,
        "X-AppKey": apiKey,
        "X-SessionToken": encodeSessionToken(apiKey, sessionToken),
      },
      body: bodyStr,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as any)?.name === "AbortError") {
      throw new Error(`Breeze ${endpoint} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Breeze ${endpoint} failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<T>;
}

// ============================================================================
// Public API
// ============================================================================

export interface BreezeBar {
  datetime: string; // ISO timestamp from Breeze
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BreezeHistoricalResponse {
  Success?: BreezeBar[];
  Error?: string | null;
  Status?: number;
}

/**
 * Fetch historical 1-min OHLCV for the Nifty 50 index.
 * Uses GET with query params (POST returns 405 on /historicalcharts).
 */
export async function fetchNifty1MinBars(
  fromDate: string,
  toDate: string
): Promise<BreezeBar[]> {
  const resp = await breezeGet<BreezeHistoricalResponse>(
    "/historicalcharts",
    {
      interval: "1minute",
      from_date: fromDate,
      to_date: toDate,
      stock_code: "NIFTY",
      exchange_code: "NSE",
      product_type: "cash",
    }
  );

  if (resp.Error) {
    throw new Error(`Breeze historical charts error: ${resp.Error}`);
  }

  return resp.Success ?? [];
}

/**
 * Fetch historical daily OHLCV for the Nifty 50 index.
 * Used by the daily structure analyzer for HH/HL/LH/LL regime classification.
 */
export async function fetchNiftyDailyBars(
  fromDate: string,
  toDate: string
): Promise<BreezeBar[]> {
  const resp = await breezeGet<BreezeHistoricalResponse>(
    "/historicalcharts",
    {
      interval: "1day",
      from_date: fromDate,
      to_date: toDate,
      stock_code: "NIFTY",
      exchange_code: "NSE",
      product_type: "cash",
    }
  );

  if (resp.Error) {
    throw new Error(`Breeze daily bars error: ${resp.Error}`);
  }

  return resp.Success ?? [];
}

export interface OptionChainRow {
  strike_price: number;
  call_oi?: number;
  call_oi_change?: number;
  call_volume?: number;
  call_iv?: number;
  call_ltp?: number;
  call_prev_close?: number;
  put_oi?: number;
  put_oi_change?: number;
  put_volume?: number;
  put_iv?: number;
  put_ltp?: number;
  put_prev_close?: number;
}

/**
 * Fetch the Nifty options chain for a given expiry.
 * /optionchain also uses GET with query params.
 */
export async function fetchNiftyOptionChain(
  expiryDate: string
): Promise<OptionChainRow[]> {
  const fetchSide = async (right: "call" | "put") => {
    const resp = await breezeGet<{ Success?: any[]; Error?: string }>(
      "/optionchain",
      {
        stock_code: "NIFTY",
        exchange_code: "NFO",
        product_type: "options",
        expiry_date: expiryDate,
        right,
      }
    );
    if (resp.Error) throw new Error(`Breeze option chain (${right}) error: ${resp.Error}`);
    return resp.Success ?? [];
  };

  const [calls, puts] = await Promise.all([fetchSide("call"), fetchSide("put")]);

  const byStrike = new Map<number, OptionChainRow>();

  for (const c of calls) {
    const strike = Number(c.strike_price);
    const row = byStrike.get(strike) ?? { strike_price: strike };
    row.call_oi = Number(c.open_interest ?? 0);
    row.call_oi_change = Number(c.chnge_oi ?? 0);
    row.call_volume = Number(c.total_quantity_traded ?? 0);
    row.call_iv = c.implied_volatility != null ? Number(c.implied_volatility) : undefined;
    row.call_ltp = Number(c.ltp ?? 0);
    row.call_prev_close = c.previous_close != null ? Number(c.previous_close) : undefined;
    byStrike.set(strike, row);
  }

  for (const p of puts) {
    const strike = Number(p.strike_price);
    const row = byStrike.get(strike) ?? { strike_price: strike };
    row.put_oi = Number(p.open_interest ?? 0);
    row.put_oi_change = Number(p.chnge_oi ?? 0);
    row.put_volume = Number(p.total_quantity_traded ?? 0);
    row.put_iv = p.implied_volatility != null ? Number(p.implied_volatility) : undefined;
    row.put_ltp = Number(p.ltp ?? 0);
    row.put_prev_close = p.previous_close != null ? Number(p.previous_close) : undefined;
    byStrike.set(strike, row);
  }

  return Array.from(byStrike.values()).sort((a, b) => a.strike_price - b.strike_price);
}

/**
 * Compute the next Thursday's weekly expiry (Nifty weekly expiry day).
 */
export function nextNiftyWeeklyExpiry(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCHours(6, 0, 0, 0);
  const dow = d.getUTCDay();
  let daysToAdd = (4 - dow + 7) % 7;
  if (dow === 4 && now.getUTCHours() >= 10) daysToAdd = 7;
  if (daysToAdd === 0 && dow !== 4) daysToAdd = 7;
  d.setUTCDate(d.getUTCDate() + daysToAdd);
  return d.toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

// ============================================================================
// Advance / Decline for Nifty 50 constituents
// ============================================================================

import { NIFTY_50_BREEZE_CODES } from "./nifty50-list";

export interface StockQuote {
  symbol: string;
  name: string;
  ltp: number | null;
  prev_close: number | null;
  change_pct: number | null;
  status: "advance" | "decline" | "unchanged" | "error";
}

export interface AdvanceDeclineSnapshot {
  advances: number;
  declines: number;
  unchanged: number;
  errors: number;
  total: number;
  ratio: number;
  bias: "STRONG_UP" | "MODERATE_UP" | "BALANCED" | "MODERATE_DOWN" | "STRONG_DOWN";
  top_gainers: StockQuote[];
  top_losers: StockQuote[];
  fetched_at: string;
}

/**
 * Fetch a single stock quote via Breeze /quotes endpoint (GET).
 */
async function fetchOneQuote(breezeCode: string): Promise<{ ltp: number; prev: number } | null> {
  try {
    const resp = await breezeGet<{ Success?: any[]; Error?: string }>(
      "/quotes",
      {
        stock_code: breezeCode,
        exchange_code: "NSE",
        product_type: "cash",
      }
    );
    if (resp.Error) return null;
    const data = resp.Success?.[0];
    if (!data) return null;
    return {
      ltp:  Number(data.ltp ?? 0),
      prev: Number(data.previous_close ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch advance/decline snapshot for all Nifty 50 stocks.
 */
export async function fetchAdvanceDecline(): Promise<AdvanceDeclineSnapshot> {
  const stocks = NIFTY_50_BREEZE_CODES;
  const CONCURRENCY = 10;
  const quotes: StockQuote[] = [];

  for (let i = 0; i < stocks.length; i += CONCURRENCY) {
    const batch = stocks.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (s) => {
        const q = await fetchOneQuote(s.breeze);
        if (!q || q.prev <= 0) {
          return {
            symbol: s.symbol,
            name: s.name,
            ltp: null,
            prev_close: null,
            change_pct: null,
            status: "error" as const,
          };
        }
        const change = q.ltp - q.prev;
        const changePct = (change / q.prev) * 100;
        let status: StockQuote["status"];
        if (Math.abs(changePct) < 0.05) status = "unchanged";
        else if (change > 0) status = "advance";
        else status = "decline";
        return {
          symbol: s.symbol,
          name: s.name,
          ltp: q.ltp,
          prev_close: q.prev,
          change_pct: changePct,
          status,
        };
      })
    );
    quotes.push(...batchResults);
  }

  const advances  = quotes.filter((q) => q.status === "advance").length;
  const declines  = quotes.filter((q) => q.status === "decline").length;
  const unchanged = quotes.filter((q) => q.status === "unchanged").length;
  const errors    = quotes.filter((q) => q.status === "error").length;
  const total     = quotes.length;
  const ratio     = advances / Math.max(declines, 1);

  let bias: AdvanceDeclineSnapshot["bias"];
  if (advances >= 40)      bias = "STRONG_UP";
  else if (advances >= 30) bias = "MODERATE_UP";
  else if (declines >= 40) bias = "STRONG_DOWN";
  else if (declines >= 30) bias = "MODERATE_DOWN";
  else                     bias = "BALANCED";

  const valid = quotes.filter((q) => q.change_pct != null);
  const top_gainers = [...valid].sort((a, b) => b.change_pct! - a.change_pct!).slice(0, 5);
  const top_losers  = [...valid].sort((a, b) => a.change_pct! - b.change_pct!).slice(0, 5);

  return {
    advances, declines, unchanged, errors, total,
    ratio: Math.round(ratio * 100) / 100,
    bias,
    top_gainers,
    top_losers,
    fetched_at: new Date().toISOString(),
  };
}
