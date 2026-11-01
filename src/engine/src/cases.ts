import type { CaseFilter } from "./filters.ts";
import { throughputTime } from "./log.ts";
import { quantileSorted } from "./stats.ts";
import { NO_RESOURCE, type AttrValue, type Attrs, type EventLog } from "./types.ts";

/** One case laid out for a person to read: events in order and the wait before each. */
export interface CaseTimeline {
  id: string;
  attrs: Attrs;
  start: number;
  end: number;
  throughputMs: number;
  events: {
    activity: string;
    timestamp: number;
    resource: string | null;
    /** Time since the previous event of the case; 0 for the first. */
    waitMs: number;
    attrs: Attrs;
  }[];
}

export function caseTimeline(log: EventLog, caseId: string): CaseTimeline | null {
  const c = log.cases.find((x) => x.id === caseId);
  if (!c) return null;
  return {
    id: c.id,
    attrs: { ...c.attrs },
    start: c.events[0]?.t ?? 0,
    end: c.events[c.events.length - 1]?.t ?? 0,
    throughputMs: throughputTime(c),
    events: c.events.map((e, i) => ({
      activity: log.activities[e.a]!,
      timestamp: e.t,
      resource: e.r === NO_RESOURCE ? null : log.resources[e.r]!,
      waitMs: i === 0 ? 0 : e.t - c.events[i - 1]!.t,
      attrs: { ...e.attrs },
    })),
  };
}

export interface CaseRow {
  id: string;
  start: number;
  throughputMs: number;
  steps: number;
}

/** The longest-running cases, slowest first (ties by id). */
export function slowestCases(log: EventLog, limit: number): CaseRow[] {
  return log.cases
    .map((c) => ({ id: c.id, start: c.events[0]?.t ?? 0, throughputMs: throughputTime(c), steps: c.events.length }))
    .sort((x, y) => y.throughputMs - x.throughputMs || x.id.localeCompare(y.id))
    .slice(0, limit);
}

/**
 * The outcome "slow cases": a throughput filter at the given percentile of
 * case duration (e.g. 0.9 → the slowest ~10%). Cases at the threshold count.
 */
export function slowCasesFilter(log: EventLog, percentile: number): CaseFilter {
  const sorted = log.cases.map(throughputTime).sort((x, y) => x - y);
  return { kind: "throughput", minMs: quantileSorted(sorted, percentile) };
}

/** A case attribute, summarised for building filters. */
export interface AttributeOverview {
  key: string;
  type: "number" | "category";
  /** Distinct values among cases (null = missing). */
  distinct: number;
  /** Most common values first, at most `maxValues`; empty for numbers. */
  values: { value: AttrValue; count: number }[];
  /** Numeric range, for numbers. */
  min?: number;
  max?: number;
}

/** Case-level attributes with their most common values, sorted by key. */
export function attributeOverview(log: EventLog, maxValues = 50): AttributeOverview[] {
  const keys = [...new Set(log.cases.flatMap((c) => Object.keys(c.attrs)))].sort();
  return keys.map((key) => {
    const counts = new Map<AttrValue, number>();
    let numeric = true;
    let min = Infinity;
    let max = -Infinity;
    for (const c of log.cases) {
      const v = c.attrs[key] ?? null;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      if (v === null) continue;
      if (typeof v === "number") {
        min = Math.min(min, v);
        max = Math.max(max, v);
      } else numeric = false;
    }
    if (numeric && Number.isFinite(min)) return { key, type: "number" as const, distinct: counts.size, values: [], min, max };
    const values = [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((x, y) => y.count - x.count || String(x.value).localeCompare(String(y.value)))
      .slice(0, maxValues);
    return { key, type: "category" as const, distinct: counts.size, values };
  });
}
