import { filterLog, type CaseFilter } from "./filters.ts";
import { quantileSorted } from "./stats.ts";
import type { AttrValue, Case, EventLog } from "./types.ts";

/**
 * Which case segments are over-represented among cases with an outcome
 * (slow cases, rework, rule violations). This finds correlation, not cause:
 * a segment can look bad because it gets the hardest work. Every factor
 * carries its n so the UI can flag thin evidence.
 */
export interface RootCauseOptions {
  /** Case attributes to examine. Default: every case-level attribute. */
  attributes?: string[];
  /** Also segment by who performed these activities (first execution in the case). */
  resourceActivities?: string[];
  /** Number of quantile buckets for numeric attributes. Default 4. */
  numericBuckets?: number;
  /** Skip categorical attributes with more distinct values than this (ids, free text). Default 30. */
  maxValues?: number;
  /** Segments smaller than this are flagged `smallSample`. Default 30. */
  minCases?: number;
  /** |z| needed to call a segment `significant`. Default 3, to allow for many comparisons. */
  minZ?: number;
}

/** One segment (attribute = value). `id` is stable and safe to cite. */
export interface RootCauseFactor {
  id: string;
  attribute: string;
  /** Display value: the category, or a numeric range such as "[1000, 5000)". */
  value: string;
  cases: number;
  outcomeCases: number;
  /** outcomeCases / cases. */
  rate: number;
  /** Outcome rate among cases outside the segment. */
  restRate: number;
  /** rate / overall rate. */
  lift: number;
  /** outcomeCases − cases × overall rate: outcome cases beyond what the segment's size predicts. */
  excessCases: number;
  /** Two-proportion z-score of rate vs restRate. */
  z: number;
  smallSample: boolean;
  significant: boolean;
}

export interface RootCauseReport {
  totalCases: number;
  outcomeCases: number;
  overallRate: number;
  /** Sorted by excessCases, most over-represented first. Empty if the outcome hits no case or every case. */
  factors: RootCauseFactor[];
}

export function analyzeRootCauses(
  log: EventLog,
  outcome: readonly CaseFilter[],
  opts: RootCauseOptions = {},
): RootCauseReport {
  const minCases = opts.minCases ?? 30;
  const minZ = opts.minZ ?? 3;
  const hit = new Set(filterLog(log, outcome).cases);
  const total = log.cases.length;
  const overall = total > 0 ? hit.size / total : 0;
  const report: RootCauseReport = { totalCases: total, outcomeCases: hit.size, overallRate: overall, factors: [] };
  if (hit.size === 0 || hit.size === total) return report;

  for (const [attribute, segmentOf] of segmenters(log, opts)) {
    const counts = new Map<string, { cases: number; outcome: number }>();
    for (const c of log.cases) {
      const value = segmentOf(c);
      let s = counts.get(value);
      if (!s) counts.set(value, (s = { cases: 0, outcome: 0 }));
      s.cases++;
      if (hit.has(c)) s.outcome++;
    }
    if (counts.size < 2) continue;
    for (const [value, s] of counts) {
      const rest = total - s.cases;
      const rate = s.outcome / s.cases;
      const restRate = (hit.size - s.outcome) / rest;
      const se = Math.sqrt(overall * (1 - overall) * (1 / s.cases + 1 / rest));
      const z = (rate - restRate) / se;
      const smallSample = s.cases < minCases;
      report.factors.push({
        id: `segment:${attribute}=${value}`,
        attribute,
        value,
        cases: s.cases,
        outcomeCases: s.outcome,
        rate,
        restRate,
        lift: rate / overall,
        excessCases: s.outcome - s.cases * overall,
        z,
        smallSample,
        significant: !smallSample && Math.abs(z) >= minZ,
      });
    }
  }
  report.factors.sort((x, y) => y.excessCases - x.excessCases || x.id.localeCompare(y.id));
  return report;
}

const MISSING = "(missing)";

/** [attribute label, case → segment value] for every attribute worth examining. */
function segmenters(log: EventLog, opts: RootCauseOptions): [string, (c: Case) => string][] {
  const maxValues = opts.maxValues ?? 30;
  const out: [string, (c: Case) => string][] = [];

  const names = opts.attributes ?? [...new Set(log.cases.flatMap((c) => Object.keys(c.attrs)))].sort();
  for (const name of names) {
    const values = log.cases.map((c) => c.attrs[name] ?? null);
    const present = values.filter((v): v is Exclude<AttrValue, null> => v !== null);
    if (present.length > 0 && present.every((v) => typeof v === "number")) {
      out.push([name, numericSegmenter(name, present as number[], opts.numericBuckets ?? 4)]);
      continue;
    }
    if (new Set(values.map(String)).size > maxValues) continue;
    out.push([name, (c) => (c.attrs[name] == null ? MISSING : String(c.attrs[name]))]);
  }

  for (const activity of opts.resourceActivities ?? []) {
    const a = log.activities.indexOf(activity);
    if (a < 0) continue;
    out.push([
      `resource@${activity}`,
      (c) => {
        const r = c.events.find((e) => e.a === a)?.r ?? -1;
        return r >= 0 ? log.resources[r]! : MISSING;
      },
    ]);
  }
  return out;
}

/** Buckets at (rounded) quantile cut points; ranges are [lo, hi) except the last, which is closed. */
function numericSegmenter(name: string, values: number[], buckets: number): (c: Case) => string {
  const sorted = [...values].sort((x, y) => x - y);
  // Interior cut points rounded to 3 significant digits so labels and ids read well.
  const raw = Array.from({ length: buckets + 1 }, (_, i) => quantileSorted(sorted, i / buckets));
  const cuts = [...new Set(raw.map((v, i) => (i === 0 || i === buckets ? v : Number(v.toPrecision(3)))))];
  const labels = cuts.slice(0, -1).map((lo, i) => `[${lo}, ${cuts[i + 1]}${i === cuts.length - 2 ? "]" : ")"}`);
  if (labels.length === 0) labels.push(`[${cuts[0]}, ${cuts[0]}]`);
  return (c) => {
    const v = c.attrs[name];
    if (typeof v !== "number") return MISSING;
    let i = 0;
    while (i < labels.length - 1 && v >= cuts[i + 1]!) i++;
    return labels[i]!;
  };
}
