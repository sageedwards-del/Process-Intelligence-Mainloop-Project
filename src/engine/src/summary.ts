import { eventCount, throughputTime } from "./log.ts";
import { DAY_MS, durationStats } from "./stats.ts";
import type { DurationStats, EventLog } from "./types.ts";
import { computeVariants } from "./variants.ts";

export interface LogSummary {
  caseCount: number;
  eventCount: number;
  activityCount: number;
  resourceCount: number;
  variantCount: number;
  /** Share of cases following the single most frequent variant. */
  topVariantShare: number;
  throughput: DurationStats;
  firstEvent: number | null;
  lastEvent: number | null;
}

export function summarize(log: EventLog): LogSummary {
  let first = Infinity;
  let last = -Infinity;
  for (const c of log.cases) {
    if (c.events.length === 0) continue;
    first = Math.min(first, c.events[0]!.t);
    last = Math.max(last, c.events[c.events.length - 1]!.t);
  }
  const variants = computeVariants(log);
  return {
    caseCount: log.cases.length,
    eventCount: eventCount(log),
    activityCount: log.activities.length,
    resourceCount: log.resources.length,
    variantCount: variants.length,
    topVariantShare: variants[0]?.share ?? 0,
    throughput: durationStats(log.cases.map(throughputTime)),
    firstEvent: Number.isFinite(first) ? first : null,
    lastEvent: Number.isFinite(last) ? last : null,
  };
}

export interface TrendPoint {
  /** Bucket start, epoch ms (UTC). */
  start: number;
  cases: number;
  medianThroughputDays: number;
}

/** Cases started and median throughput time, bucketed by ISO week or calendar month (UTC). */
export function throughputTrend(log: EventLog, bucket: "week" | "month"): TrendPoint[] {
  const buckets = new Map<number, number[]>();
  for (const c of log.cases) {
    if (c.events.length === 0) continue;
    const k = bucketStart(c.events[0]!.t, bucket);
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(throughputTime(c));
  }
  return [...buckets.entries()]
    .sort(([x], [y]) => x - y)
    .map(([start, ts]) => ({ start, cases: ts.length, medianThroughputDays: durationStats(ts).median / DAY_MS }));
}

function bucketStart(t: number, bucket: "week" | "month"): number {
  const d = new Date(t);
  if (bucket === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}
