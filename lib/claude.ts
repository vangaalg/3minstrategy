/**
 * Claude API client — runs the 3-Mint scan by sending OHLCV + options chain to Claude
 * and parsing the structured JSON response.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SKILL_SYSTEM_PROMPT } from "./skill-prompt";
import type { ThreeMinBar } from "./resample";
import type { OptionChainRow } from "./breeze";

export interface ScanInput {
  bars: ThreeMinBar[];
  options_chain: OptionChainRow[];
  spot: number;
  vix: number | null;
  is_expiry_day: boolean;
  current_time_ist: string; // human-readable IST time
}

export interface StrategySignal {
  strategy: 1 | 2 | 3;
  name: string;
  fired: boolean;
  direction: "BUY" | "SELL" | null;
  stage: "triggered" | "armed" | null;
  entry: number | null;
  stop_loss: number | null;
  target: number | null;
  rr_ratio: number | null;
  filter_passed: boolean;
  anchors: {
    ema_5: number | null;
    ema_45: number | null;
    ema_100: number | null;
    sma_20: number | null;
    sma_200: number | null;
    vrl_first: number | null;
    vrl_max: number | null;
    bb_upper: number | null;
    bb_lower: number | null;
  };
  why_fired: string;
  invalidation: string | null;
}

export interface OIWallMigration {
  current_strike: number | null;
  shifting_to: number | null;
  direction: "UP" | "DOWN" | "STABLE";
  interpretation: string;
}

export interface OITopStrike {
  strike: number;
  side: "CE" | "PE";
  oi: number;
  oi_change: number;
  ltp_change_pct: number | null;
  buildup_type: "Long Buildup" | "Short Buildup" | "Short Covering" | "Long Unwinding" | "Unclear";
  implication: string;
}

export interface OIBuildup {
  net_read: "BULLISH" | "BEARISH" | "NEUTRAL";
  summary: string;
  call_wall_migration: OIWallMigration;
  put_wall_migration: OIWallMigration;
  top_strikes: OITopStrike[];
}

export interface PriceProjection {
  has_target: boolean;
  target_price: number | null;
  target_basis: string;
  scenario: "PIN" | "TOUCH_AND_BOUNCE" | "RUNAWAY_TREND" | "NONE";
  expected_landing_price: number | null;
  confidence: "High" | "Moderate" | "Low";
  notes: string;
}

export interface ScanOutput {
  session_context: {
    spot: number;
    day_open: number;
    day_high: number;
    day_low: number;
    vix: number | null;
    is_expiry_day: boolean;
    time_of_day_note: string;
  };
  bias: {
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    confidence: "High" | "Moderate" | "Low";
    evidence: string[];
    conflicting_signals: string[];
    invalidated_if: string;
  };
  strategies: StrategySignal[];
  options_chain_summary: {
    pcr: number | null;
    max_pain: number | null;
    highest_call_oi_strike: number | null;
    highest_put_oi_strike: number | null;
    iv_skew_note: string;
  };
  oi_buildup: OIBuildup;
  caveats: string[];
  price_projection: PriceProjection;
}

export type ClaudeModel = "claude-sonnet-4-6" | "claude-opus-4-7";

export interface ScanMeta {
  model: ClaudeModel;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  estimated_cost_usd: number;
}

const MODEL_PRICING: Record<ClaudeModel, { input: number; output: number; cache_read: number; cache_write: number }> = {
  "claude-opus-4-7":  { input: 5.00,  output: 25.00, cache_read: 0.50,  cache_write: 6.25  },
  "claude-sonnet-4-6":{ input: 3.00,  output: 15.00, cache_read: 0.30,  cache_write: 3.75  },
};

export async function runClaudeScan(
  input: ScanInput,
  model: ClaudeModel = "claude-sonnet-4-6"
): Promise<{ output: ScanOutput; meta: ScanMeta }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY in env.");

  const client = new Anthropic({ apiKey });

  const userPayload = {
    current_time_ist: input.current_time_ist,
    spot: input.spot,
    vix: input.vix,
    is_expiry_day: input.is_expiry_day,
    bars: input.bars.map((b) => ({
      t: b.datetime,
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume,
    })),
    options_chain: input.options_chain.map((r) => {
      const callLtpChgPct =
        r.call_ltp != null && r.call_prev_close != null && r.call_prev_close > 0
          ? ((r.call_ltp - r.call_prev_close) / r.call_prev_close) * 100
          : null;
      const putLtpChgPct =
        r.put_ltp != null && r.put_prev_close != null && r.put_prev_close > 0
          ? ((r.put_ltp - r.put_prev_close) / r.put_prev_close) * 100
          : null;
      return {
        strike: r.strike_price,
        call_oi: r.call_oi ?? 0,
        call_oi_change: r.call_oi_change ?? 0,
        call_ltp: r.call_ltp ?? 0,
        call_ltp_chg_pct: callLtpChgPct,
        call_iv: r.call_iv ?? null,
        put_oi: r.put_oi ?? 0,
        put_oi_change: r.put_oi_change ?? 0,
        put_ltp: r.put_ltp ?? 0,
        put_ltp_chg_pct: putLtpChgPct,
        put_iv: r.put_iv ?? null,
      };
    }),
  };

  const userMessage = `Run a 3-Mint scan on this Nifty 50 data. Compute all three strategies. Return only the JSON object per the schema.\n\nDATA:\n${JSON.stringify(userPayload)}`;

  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    // Prompt caching: mark the system prompt with cache_control so Anthropic caches it
    // after the first call. Subsequent calls pay only ~10% of the system prompt input cost.
    system: [
      {
        type: "text",
        text: SKILL_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text content.");
  }

  let jsonText = textBlock.text.trim();
  jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  let scanOutput: ScanOutput;
  try {
    scanOutput = JSON.parse(jsonText) as ScanOutput;
  } catch {
    throw new Error(`Failed to parse Claude JSON. First 500 chars: ${jsonText.slice(0, 500)}`);
  }

  // Compute cost from usage
  const usage = response.usage as {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  const p = MODEL_PRICING[model];
  const inputTok  = usage.input_tokens ?? 0;
  const outputTok = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;

  const cost =
    (inputTok  / 1_000_000) * p.input  +
    (outputTok / 1_000_000) * p.output +
    (cacheRead  / 1_000_000) * p.cache_read +
    (cacheWrite / 1_000_000) * p.cache_write;

  return {
    output: scanOutput,
    meta: {
      model,
      input_tokens: inputTok,
      output_tokens: outputTok,
      cache_read_tokens: cacheRead,
      cache_write_tokens: cacheWrite,
      estimated_cost_usd: Math.round(cost * 100000) / 100000,
    },
  };
}
