/**
 * ICICI Breeze REST API client.
 *
 * Auth model (ALL requests including GET):
 *   X-AppKey        = API key
 *   X-SessionToken  = base64("apiKey:sessionToken")
 *   X-Checksum      = "token " + SHA256(timestamp + JSON.stringify(body) + secret)
 *   X-Timestamp     = ISO 8601 UTC e.g. "2026-05-04T09:15:00.000Z"
 *
 * IMPORTANT — Breeze's quirk:
 *   /historicalcharts, /optionchain, /quotes are all declared as GET in the docs,
 *   BUT they require the params as a JSON body (not query string).
 *   Standard fetch/Undici on Node 20 silently drops body on GET.
 *   FIX: use method "GET" but send via http.request (Node built-in) with body,
 *   OR simply use POST — but Breeze returns 405 on POST for these endpoints.
 *   REAL FIX: use the `undici` dispatcher trick: pass body with GET via
 *   a custom dispatcher that allows body on GET.
 *   SIMPLEST FIX that actually works: use Node's `https` module directly.
 *
 * Docs: https://api.icicidirect.com/breezeapi/documents/index.html
 */

import { createHash } from "crypto";
import https from "https";

const BREEZE_BASE_HOST = "api.icicidirect.com";
const BREEZE_BASE_PATH = "/breezeapi/api/v1";

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

function encodeSessionToken(apiKey: string, sessionToken: string): string {
  return Buffer.from(`${apiKey}:${sessionToken}`).toString("base64");
}

function computeChecksum(timestamp: string, bodyStr: string, secret: string): string {
  const raw = timestamp + bodyStr + secret;
  const hash = createHash("sha256").update(raw).digest("hex");
  return `token ${hash}`;
}

/**
 * Make a Breeze API request using Node's https module directly.
 * This allows sending a JSON body with GET (which fetch/Undici blocks on Node 20+).
 * Breeze's GET endpoints require the payload in the request body, not the query string.
 */
function breezeRequest<T = any>(
  method: "GET" | "POST",
  endpoint: string,
  body: Record<string, any>,
  timeoutMs = 8000
): Promise<T> {
  const { apiKey, apiSecret, sessionToken } = getCreds();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const bodyStr = JSON.stringify(body);
  const checksum = computeChecksum(timestamp, bodyStr, apiSecret);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Checksum": checksum,
    "X-Timestamp": timestamp,
    "X-AppKey": apiKey,
    "X-SessionToken": encodeSessionToken(apiKey, sessionToken),
    "Content-Length": Buffer.byteLength(bodyStr).toString(),
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: BREEZE_BASE_HOST,
        path: `${BREEZE_BASE_PATH}${endpoint}`,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Breeze ${endpoint} failed: ${res.statusCode} ${data}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Breeze ${endpoint} invalid JSON: ${data}`));
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Breeze ${endpoint} timed out after ${timeoutMs}ms`));
    });

    req.on("error", (err) => reject(err));

    // Write body — works on GET too via Node's https module
    req.write(bodyStr);
    req.end();
  });
}

// ============================================================================
// Public API
// ============================================================================

export interface BreezeBar {
  datetime: string;
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
 * Fetch historical 1-min OHLCV for Nifty 50.
 * Uses GET with JSON body (Breeze's non-standard convention).
 */
export async function fetchNifty1MinBars(
  fromDate: string,
  toDate: string
): Promise<BreezeBar[]> {
  const resp = await breezeRequest<BreezeHistoricalResponse>("GET", "/historicalcharts", {
    interval: "1minute",
    from_date: fromDate,
    to_date: toDate,
    stock_code: "NIFTY",
    exchange_code: "NSE",
    product_type: "cash",
  });

  if (resp.Error) throw new Error(`Breeze historical charts error: ${resp.Error}`);
  return resp.Success ?? [];
}

/**
 * Fetch historical daily OHLCV for Nifty 50.
 * Used by the daily structure analyzer for HH/HL/LH/LL regime classification.
 */
export async function fetchNiftyDailyBars(
  fromDate: string,
  toDate: string
): Promise<BreezeBar[]> {
  const resp = await breezeRequest<BreezeHistoricalResponse>("GET", "/historicalcharts", {
    interval: "1day",
    from_date: fromDate,
    to_date: toDate,
    stock_code: "NIFTY",
    exchange_code: "NSE",
    product_type: "cash",
  });

  if (resp.Error) throw new Error(`Breeze daily bars error: ${resp.Error}`);
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
 * Fetch Nifty options chain for a given expiry.
 * /optionchain also uses GET with JSON body.
 */
export async function fetchNiftyOptionChain(
  expiryDate: string
): Promise<OptionChainRow[]> {
  const fetchSide = async (right: "call" | "put") => {
    const resp = await breezeRequest<{ Success?: any[]; Error?: string }>(
      "GET",
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
 * Compute the next Thursday weekly expiry for Nifty.
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

async function fetchOneQuote(breezeCode: string): Promise<{ ltp: number; prev: number } | null> {
  try {
    const resp = await breezeRequest<{ Success?: any[]; Error?: string }>(
      "GET",
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
      ltp: Number(data.ltp ?? 0),
      prev: Number(data.previous_close ?? 0),
    };
  } catch {
    return null;
  }
}

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
          return { symbol: s.symbol, name: s.name, ltp: null, prev_close: null, change_pct: null, status: "error" as const };
        }
        const change = q.ltp - q.prev;
        const changePct = (change / q.prev) * 100;
        let status: StockQuote["status"];
        if (Math.abs(changePct) < 0.05) status = "unchanged";
        else if (change > 0) status = "advance";
        else status = "decline";
        return { symbol: s.symbol, name: s.name, ltp: q.ltp, prev_close: q.prev, change_pct: changePct, status };
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
    bias, top_gainers, top_losers,
    fetched_at: new Date().toISOString(),
  };
}
