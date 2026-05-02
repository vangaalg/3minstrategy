/**
 * POST /api/parse-oi-screenshot
 *
 * Accepts a base64-encoded image of a Nifty options chain (NSE, Sensibull,
 * Opstra, Sensibull, broker terminal screenshot etc.) and returns a parsed
 * OptionChainRow[] array structurally identical to what Breeze returns.
 *
 * Body: { imageBase64: string, mediaType: "image/png" | "image/jpeg" | "image/webp" }
 * Response: { ok: true, chain: OptionChainRow[], parsed_at: string, usage: {...} } | { ok: false, error }
 *
 * Uses Claude with vision (Sonnet 4.6 by default — Opus 4.7 is overkill for OCR).
 * The prompt forces a strict JSON schema so the result drops directly into the scan pipeline.
 */

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VISION_SYSTEM_PROMPT = `You are an OCR specialist for Indian options chain screenshots (Nifty/Bank Nifty).

Your job: extract the option chain table from the user's screenshot into a strict JSON array.

Read CAREFULLY and respect Indian number formatting:
- "1.2K" = 1200, "12.5K" = 12500, "1.2L" = 120000, "1.2 Cr" = 12000000
- Numbers may have commas: "1,23,456" = 123456 (Indian comma grouping)
- Percentages and decimals as displayed
- A dash, "-", or empty cell = null

For each strike row, extract:
- strike_price (number, e.g. 24500)
- call_oi (Call Open Interest, in contracts — usually shown in lakhs/thousands)
- call_oi_change (Call Change in OI — can be negative)
- call_volume (Call Volume / qty traded)
- call_iv (Call Implied Volatility, %)
- call_ltp (Call Last Traded Price, ₹)
- put_oi (Put Open Interest)
- put_oi_change (Put Change in OI — can be negative)
- put_volume (Put Volume)
- put_iv (Put IV, %)
- put_ltp (Put LTP, ₹)

Output ONLY a JSON object — no markdown, no code fences, no commentary:

{
  "chain": [
    { "strike_price": 24400, "call_oi": 1234500, "call_oi_change": -45200, "call_volume": 1.23e6, "call_iv": 11.5, "call_ltp": 145.30, "put_oi": 987600, "put_oi_change": 23400, "put_volume": 2.45e6, "put_iv": 12.1, "put_ltp": 78.50 },
    ...
  ],
  "detected_underlying": "NIFTY" | "BANKNIFTY" | "OTHER" | null,
  "detected_expiry": "<string as shown in screenshot, or null>",
  "detected_spot": <number | null>,
  "confidence": "high" | "medium" | "low",
  "notes": "<any caveats — e.g. 'right edge truncated, last 2 strikes incomplete' or 'IV column not visible'>"
}

If a field is not visible / not clearly readable, set it to null. Do NOT guess. It's far better to return null than a wrong number.

Include EVERY visible strike — typically 10-30 rows in a screenshot. Sort by strike_price ascending.

If the screenshot is not an options chain (e.g. it's a chart or unrelated image), return:
{ "chain": [], "detected_underlying": null, "detected_expiry": null, "detected_spot": null, "confidence": "low", "notes": "Image does not appear to be an options chain" }`;

interface ParsedChain {
  chain: Array<{
    strike_price: number;
    call_oi?: number | null;
    call_oi_change?: number | null;
    call_volume?: number | null;
    call_iv?: number | null;
    call_ltp?: number | null;
    put_oi?: number | null;
    put_oi_change?: number | null;
    put_volume?: number | null;
    put_iv?: number | null;
    put_ltp?: number | null;
  }>;
  detected_underlying: string | null;
  detected_expiry: string | null;
  detected_spot: number | null;
  confidence: "high" | "medium" | "low";
  notes: string;
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: "Missing ANTHROPIC_API_KEY" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const imageBase64: string = body.imageBase64;
    const mediaType: string = body.mediaType ?? "image/png";

    if (!imageBase64) {
      return NextResponse.json({ ok: false, error: "Missing imageBase64" }, { status: 400 });
    }
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType)) {
      return NextResponse.json(
        { ok: false, error: `Unsupported mediaType ${mediaType}` },
        { status: 400 }
      );
    }

    // Strip data URL prefix if present (frontend may include it)
    const cleanBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-4-6", // Sonnet handles OCR well; cheaper than Opus
      max_tokens: 4000,
      system: VISION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
                data: cleanBase64,
              },
            },
            {
              type: "text",
              text: "Extract the options chain from this screenshot. Return JSON per the schema. Read carefully — every number matters.",
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { ok: false, error: "Claude returned no text content" },
        { status: 502 }
      );
    }

    let jsonText = textBlock.text.trim();
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

    let parsed: ParsedChain;
    try {
      parsed = JSON.parse(jsonText) as ParsedChain;
    } catch {
      return NextResponse.json(
        {
          ok: false,
          error: "Claude response was not valid JSON",
          raw: jsonText.slice(0, 500),
        },
        { status: 502 }
      );
    }

    // Convert to OptionChainRow[] shape (rename fields to match the rest of the system)
    const chain = parsed.chain.map((r) => ({
      strike_price: Number(r.strike_price),
      call_oi: r.call_oi ?? undefined,
      call_oi_change: r.call_oi_change ?? undefined,
      call_volume: r.call_volume ?? undefined,
      call_iv: r.call_iv ?? undefined,
      call_ltp: r.call_ltp ?? undefined,
      put_oi: r.put_oi ?? undefined,
      put_oi_change: r.put_oi_change ?? undefined,
      put_volume: r.put_volume ?? undefined,
      put_iv: r.put_iv ?? undefined,
      put_ltp: r.put_ltp ?? undefined,
    }));

    return NextResponse.json({
      ok: true,
      chain,
      detected_underlying: parsed.detected_underlying,
      detected_expiry: parsed.detected_expiry,
      detected_spot: parsed.detected_spot,
      confidence: parsed.confidence,
      notes: parsed.notes,
      parsed_at: new Date().toISOString(),
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
