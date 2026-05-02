/**
 * Parser for NSE option chain CSV exports.
 *
 * NSE format (https://www.nseindia.com/option-chain → Download):
 *   Row 1: "CALLS,,PUTS"  (section header)
 *   Row 2: column header — STRIKE column is at index 11
 *   Row 3+: data rows. "-" means no data (deep OTM).
 *           Numbers may be comma-separated and quoted: "1,28,635" → 12_865_05? No.
 *           Indian comma format: "1,28,635" = 128635 (lakh = 1,00,000)
 *
 * This parser is pure JS — no library needed.
 */

export interface ParsedCSVChain {
  chain: ParsedStrike[];
  detected_underlying: "NIFTY" | "BANKNIFTY" | "FINNIFTY" | "OTHER";
  detected_expiry: string | null;
  parse_warnings: string[];
}

export interface ParsedStrike {
  strike_price: number;
  call_oi?: number;
  call_oi_change?: number;
  call_volume?: number;
  call_iv?: number;
  call_ltp?: number;
  call_ltp_change?: number;
  put_oi?: number;
  put_oi_change?: number;
  put_volume?: number;
  put_iv?: number;
  put_ltp?: number;
  put_ltp_change?: number;
}

/** Parse an Indian-formatted number string into a JS number, or null if not parseable. */
function parseIndianNum(raw: string): number | null {
  if (!raw || raw === "-" || raw.trim() === "") return null;
  const cleaned = raw.replace(/[",\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/** Split a CSV line, respecting quoted commas. */
function splitCSVLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (c === "," && !inQuote) {
      out.push(current);
      current = "";
      continue;
    }
    current += c;
  }
  out.push(current);
  return out.map((s) => s.trim());
}

/** Detect underlying from filename or first row. */
function detectUnderlying(filename: string, firstLine: string): ParsedCSVChain["detected_underlying"] {
  const blob = (filename + " " + firstLine).toUpperCase();
  if (blob.includes("BANKNIFTY")) return "BANKNIFTY";
  if (blob.includes("FINNIFTY")) return "FINNIFTY";
  if (blob.includes("NIFTY")) return "NIFTY";
  return "OTHER";
}

/** Detect expiry from filename. NSE filename format: "option-chain-ED-NIFTY-05-May-2026.csv" */
function detectExpiryFromFilename(filename: string): string | null {
  const m = filename.match(/(\d{1,2})-([A-Za-z]{3,})-(\d{4})/);
  if (!m) return null;
  return `${m[1]} ${m[2]} ${m[3]}`;
}

export function parseNSEOptionChainCSV(
  text: string,
  filename: string = ""
): ParsedCSVChain {
  const warnings: string[] = [];

  // Normalize line endings, drop empty lines
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 3) {
    return {
      chain: [],
      detected_underlying: "OTHER",
      detected_expiry: null,
      parse_warnings: ["CSV has fewer than 3 lines — not a valid option chain export"],
    };
  }

  const detected_underlying = detectUnderlying(filename, lines[0]);
  const detected_expiry = detectExpiryFromFilename(filename);

  // Find the header row — usually row 2 (index 1), but be defensive: search for "STRIKE"
  let headerIdx = -1;
  let headerCols: string[] = [];
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    const cols = splitCSVLine(lines[i]).map((c) => c.toUpperCase());
    if (cols.includes("STRIKE")) {
      headerIdx = i;
      headerCols = cols;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      chain: [],
      detected_underlying,
      detected_expiry,
      parse_warnings: ["No STRIKE column header found — is this an NSE option chain CSV?"],
    };
  }

  // Map column positions by name (more robust than fixed index)
  const idx = (name: string): number => headerCols.indexOf(name.toUpperCase());

  const strikeI = idx("STRIKE");
  // Calls section (left of STRIKE)
  const cOI       = idx("OI");           // first OI = calls
  const cOIChng   = idx("CHNG IN OI");   // first CHNG IN OI = calls
  const cVolume   = idx("VOLUME");
  const cIV       = idx("IV");
  const cLtp      = idx("LTP");
  const cChng     = idx("CHNG");

  // Puts section — second occurrence of each column. lastIndexOf works.
  const pOI       = headerCols.lastIndexOf("OI");
  const pOIChng   = headerCols.lastIndexOf("CHNG IN OI");
  const pVolume   = headerCols.lastIndexOf("VOLUME");
  const pIV       = headerCols.lastIndexOf("IV");
  const pLtp      = headerCols.lastIndexOf("LTP");
  const pChng     = headerCols.lastIndexOf("CHNG");

  if (strikeI < 0) {
    return { chain: [], detected_underlying, detected_expiry, parse_warnings: ["No STRIKE column"] };
  }

  const chain: ParsedStrike[] = [];
  const seenStrikes = new Set<number>();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    if (cols.length < strikeI + 1) continue;

    const strike = parseIndianNum(cols[strikeI]);
    if (strike == null) continue;
    if (seenStrikes.has(strike)) continue;
    seenStrikes.add(strike);

    const row: ParsedStrike = { strike_price: strike };

    const setIfDef = (key: keyof ParsedStrike, colIdx: number) => {
      if (colIdx < 0 || colIdx >= cols.length) return;
      const v = parseIndianNum(cols[colIdx]);
      if (v != null) (row[key] as any) = v;
    };

    setIfDef("call_oi",         cOI);
    setIfDef("call_oi_change",  cOIChng);
    setIfDef("call_volume",     cVolume);
    setIfDef("call_iv",         cIV);
    setIfDef("call_ltp",        cLtp);
    setIfDef("call_ltp_change", cChng);
    setIfDef("put_oi",          pOI);
    setIfDef("put_oi_change",   pOIChng);
    setIfDef("put_volume",      pVolume);
    setIfDef("put_iv",          pIV);
    setIfDef("put_ltp",         pLtp);
    setIfDef("put_ltp_change",  pChng);

    chain.push(row);
  }

  // Sort by strike ascending
  chain.sort((a, b) => a.strike_price - b.strike_price);

  // Post-parse sanity check
  const withCallOI = chain.filter((r) => (r.call_oi ?? 0) > 0).length;
  const withPutOI  = chain.filter((r) => (r.put_oi  ?? 0) > 0).length;
  if (withCallOI < 5 && withPutOI < 5) {
    warnings.push("Very few strikes have OI data — file may be incomplete or stale");
  }
  if (chain.length === 0) {
    warnings.push("No strike rows parsed");
  } else {
    const minStrike = chain[0].strike_price;
    const maxStrike = chain[chain.length - 1].strike_price;
    warnings.push(`Parsed ${chain.length} strikes from ${minStrike.toLocaleString("en-IN")} to ${maxStrike.toLocaleString("en-IN")}`);
  }

  return {
    chain,
    detected_underlying,
    detected_expiry,
    parse_warnings: warnings,
  };
}
