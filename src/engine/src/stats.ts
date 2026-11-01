import type { DurationStats } from "./types.ts";

/** Linear-interpolated quantile of an ascending-sorted array (q in [0, 1]). */
export function quantileSorted(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loVal = sorted[lo]!;
  if (lo === hi) return loVal;
  return loVal + (sorted[hi]! - loVal) * (pos - lo);
}

export function median(values: readonly number[]): number {
  return quantileSorted([...values].sort((x, y) => x - y), 0.5);
}

export function durationStats(values: readonly number[]): DurationStats {
  if (values.length === 0) {
    return { count: 0, min: 0, max: 0, mean: 0, median: 0, p90: 0, total: 0 };
  }
  const sorted = [...values].sort((x, y) => x - y);
  let total = 0;
  for (const v of sorted) total += v;
  return {
    count: sorted.length,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    mean: total / sorted.length,
    median: quantileSorted(sorted, 0.5),
    p90: quantileSorted(sorted, 0.9),
    total,
  };
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
