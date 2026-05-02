/**
 * Resample 1-min OHLCV bars to 3-min bars, anchored to the NSE session start (09:15 IST).
 *
 * Resampling rules:
 *   - open   = open of the first 1-min bar in the 3-min bucket
 *   - high   = max of the three 1-min highs
 *   - low    = min of the three 1-min lows
 *   - close  = close of the last 1-min bar in the bucket
 *   - volume = sum of the three 1-min volumes
 *   - datetime = timestamp of the first 1-min bar in the bucket
 *
 * Buckets align to 09:15, 09:18, 09:21, ..., 15:27 IST. Incomplete buckets
 * (e.g. only 1-2 bars at the live edge) are dropped by default to avoid noise,
 * but `includePartial` retains the latest partial bar (useful for live scans).
 */

import type { BreezeBar } from "./breeze";

export interface ThreeMinBar extends BreezeBar {
  bar_count: number; // how many 1-min bars went into this bucket (1, 2, or 3)
}

const NSE_OPEN_HHMM_IST = { hours: 9, minutes: 15 };

/** Convert any Date to its IST minute-of-day (minutes since 00:00 IST). */
function istMinuteOfDay(d: Date): number {
  // IST is UTC+5:30
  const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (utcMinutes + 5 * 60 + 30) % (24 * 60);
}

/** Bucket index relative to NSE open (09:15 IST = bucket 0, 09:18 = bucket 1, ...). */
function bucketIndex(d: Date): number {
  const mod = istMinuteOfDay(d);
  const openMod = NSE_OPEN_HHMM_IST.hours * 60 + NSE_OPEN_HHMM_IST.minutes;
  const minutesFromOpen = mod - openMod;
  return Math.floor(minutesFromOpen / 3);
}

export function resample1MinTo3Min(
  bars: BreezeBar[],
  includePartial: boolean = false
): ThreeMinBar[] {
  if (bars.length === 0) return [];

  // Sort defensively
  const sorted = [...bars].sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
  );

  const buckets = new Map<string, BreezeBar[]>();
  for (const bar of sorted) {
    const d = new Date(bar.datetime);
    const dateKey = d.toISOString().slice(0, 10); // YYYY-MM-DD
    const bIdx = bucketIndex(d);
    if (bIdx < 0) continue; // pre-market
    const key = `${dateKey}#${bIdx}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(bar);
  }

  const out: ThreeMinBar[] = [];
  const sortedKeys = Array.from(buckets.keys()).sort();

  for (const key of sortedKeys) {
    const group = buckets.get(key)!;
    if (group.length === 0) continue;
    if (group.length < 3 && !includePartial) continue;

    const first = group[0];
    const last = group[group.length - 1];
    const high = Math.max(...group.map((b) => b.high));
    const low = Math.min(...group.map((b) => b.low));
    const volume = group.reduce((s, b) => s + (b.volume ?? 0), 0);

    out.push({
      datetime: first.datetime,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
      bar_count: group.length,
    });
  }

  return out;
}

/**
 * Get the most recent N 3-min bars, in chronological order.
 * Useful for slicing what gets sent to Claude (the strategies need ~200 bars max).
 */
export function lastNBars<T>(bars: T[], n: number): T[] {
  if (bars.length <= n) return bars;
  return bars.slice(bars.length - n);
}
