import { throughputTime } from "./log.ts";
import { durationStats } from "./stats.ts";
import type { Case, DurationStats, EventLog } from "./types.ts";

export const VARIANT_SEPARATOR = " → ";

export interface Variant {
  /** Activity names joined by " → ". Stable across filtered views of a log. */
  key: string;
  activities: string[];
  count: number;
  /** Share of cases in the log, 0..1. */
  share: number;
  throughput: DurationStats;
  caseIds: string[];
}

export function variantKey(log: EventLog, c: Case): string {
  return c.events.map((e) => log.activities[e.a]).join(VARIANT_SEPARATOR);
}

/** Group cases by their exact activity sequence, most frequent first. */
export function computeVariants(log: EventLog): Variant[] {
  const groups = new Map<string, Case[]>();
  for (const c of log.cases) {
    const k = variantKey(log, c);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(c);
  }
  const total = log.cases.length || 1;
  return [...groups.entries()]
    .map(([key, cases]) => ({
      key,
      activities: cases[0]!.events.map((e) => log.activities[e.a]!),
      count: cases.length,
      share: cases.length / total,
      throughput: durationStats(cases.map(throughputTime)),
      caseIds: cases.map((c) => c.id),
    }))
    .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key));
}
