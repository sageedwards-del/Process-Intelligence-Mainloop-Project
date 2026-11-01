import { throughputTime, withCases } from "./log.ts";
import { variantKey } from "./variants.ts";
import type { AttrValue, Case, EventLog } from "./types.ts";

/**
 * Serializable case filters. They refer to activities by name (not id) so a
 * saved filter stays valid for any log with the same activity names.
 */
export type CaseFilter =
  | { kind: "timeframe"; from?: number; to?: number; mode: "started" | "completed" | "contained" | "intersecting" }
  | { kind: "attribute"; key: string; values: AttrValue[]; exclude?: boolean }
  | { kind: "variant"; keys: string[]; exclude?: boolean }
  | { kind: "throughput"; minMs?: number; maxMs?: number }
  | { kind: "activity"; activity: string; mode: "includes" | "excludes" }
  | { kind: "cases"; ids: string[]; exclude?: boolean };

/** Apply all filters (logical AND). */
export function filterLog(log: EventLog, filters: readonly CaseFilter[]): EventLog {
  if (filters.length === 0) return log;
  const predicates = filters.map((f) => compile(log, f));
  return withCases(log, log.cases.filter((c) => predicates.every((p) => p(c))));
}

function compile(log: EventLog, f: CaseFilter): (c: Case) => boolean {
  switch (f.kind) {
    case "timeframe": {
      const from = f.from ?? -Infinity;
      const to = f.to ?? Infinity;
      return (c) => {
        if (c.events.length === 0) return false;
        const s = c.events[0]!.t;
        const e = c.events[c.events.length - 1]!.t;
        switch (f.mode) {
          case "started":
            return s >= from && s <= to;
          case "completed":
            return e >= from && e <= to;
          case "contained":
            return s >= from && e <= to;
          case "intersecting":
            return s <= to && e >= from;
        }
      };
    }
    case "attribute": {
      const values = new Set(f.values);
      return (c) => values.has(c.attrs[f.key] ?? null) !== Boolean(f.exclude);
    }
    case "variant": {
      const keys = new Set(f.keys);
      return (c) => keys.has(variantKey(log, c)) !== Boolean(f.exclude);
    }
    case "throughput": {
      const min = f.minMs ?? 0;
      const max = f.maxMs ?? Infinity;
      return (c) => {
        const t = throughputTime(c);
        return t >= min && t <= max;
      };
    }
    case "activity": {
      const id = log.activities.indexOf(f.activity);
      const includes = (c: Case) => id >= 0 && c.events.some((e) => e.a === id);
      return f.mode === "includes" ? includes : (c) => !includes(c);
    }
    case "cases": {
      const ids = new Set(f.ids);
      return (c) => ids.has(c.id) !== Boolean(f.exclude);
    }
  }
}
