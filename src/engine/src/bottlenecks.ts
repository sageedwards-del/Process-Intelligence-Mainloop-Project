import { computeDfgWithDurations, edgeKey, edgeName } from "./dfg.js";
import { throughputTime } from "./log.js";
import { DAY_MS, HOUR_MS, durationStats, median } from "./stats.js";
import { END, NO_RESOURCE, START, type DurationStats, type EventLog } from "./types.js";

/**
 * Assumptions used to translate time into money. Every figure the engine
 * reports in currency is derived from these, so the UI can show and edit them.
 */
export interface CostModel {
  currency: string;
  /** Fully loaded cost of one staff hour. */
  hourlyRate: number;
  /** Touch time per execution, by activity name, in minutes. */
  handlingMinutes: Record<string, number>;
  defaultHandlingMinutes: number;
  /** Cost of one case waiting one extra day (late fees, lost discounts, cash tied up). */
  delayCostPerCaseDay: number;
  /** Acceptable wait per transition ("A → B"), in hours. Waiting beyond it counts as excess. */
  waitTargetsHours?: Record<string, number>;
  /** What one violation of a rule costs, keyed by rule id. Rules without an entry cost nothing. */
  ruleImpacts?: Record<string, RuleImpact>;
}

/**
 * Money at stake per rule violation. `time` covers consequences of slowness
 * (a missed early-payment discount); `compliance` covers control failures
 * (a duplicate payment, a missing approval). Cost per violation =
 * `perViolation` + `share` × the case's numeric `attribute` (e.g. 2% of amount).
 */
export interface RuleImpact {
  category: "time" | "compliance";
  perViolation?: number;
  share?: { attribute: string; fraction: number };
}

export const DEFAULT_COST_MODEL: CostModel = {
  currency: "EUR",
  hourlyRate: 55,
  handlingMinutes: {},
  defaultHandlingMinutes: 10,
  delayCostPerCaseDay: 4,
};

/** A transition where cases wait. `id` is stable and safe to cite. */
export interface EdgeBottleneck {
  id: string;
  from: string;
  to: string;
  frequency: number;
  wait: DurationStats;
  totalWaitHours: number;
  /** Waiting hours above the configured target for this transition (0 target if none). */
  excessWaitHours: number;
  /** excessWaitHours expressed in days × delayCostPerCaseDay. */
  delayCost: number;
}

/** A resource whose cases wait noticeably longer before an activity than average. */
export interface ResourceBottleneck {
  id: string;
  activity: string;
  resource: string;
  executions: number;
  medianWaitHours: number;
  /** Median wait before this activity across all resources. */
  activityMedianWaitHours: number;
  /** medianWaitHours / activityMedianWaitHours. */
  slowdown: number;
  /** Σ max(0, wait − activity median) in hours. */
  excessWaitHours: number;
  delayCost: number;
}

/** An activity executed more than once in the same case. */
export interface ReworkHotspot {
  id: string;
  activity: string;
  /** Executions beyond the first, summed over cases. */
  repeatExecutions: number;
  casesAffected: number;
  shareOfCases: number;
  /** repeatExecutions × handling time × hourly rate. */
  handlingCost: number;
  medianThroughputWithHours: number;
  medianThroughputWithoutHours: number;
}

export interface BottleneckReport {
  currency: string;
  edges: EdgeBottleneck[];
  resources: ResourceBottleneck[];
  rework: ReworkHotspot[];
}

export interface BottleneckOptions {
  /** Ignore resource/activity pairs with fewer executions than this. Default 20. */
  minResourceExecutions?: number;
  /** Report resources at least this much slower than the activity median. Default 1.5. */
  minSlowdown?: number;
}

export function analyzeBottlenecks(
  log: EventLog,
  cost: CostModel = DEFAULT_COST_MODEL,
  opts: BottleneckOptions = {},
): BottleneckReport {
  return {
    currency: cost.currency,
    edges: edgeBottlenecks(log, cost),
    resources: resourceBottlenecks(log, cost, opts),
    rework: reworkHotspots(log, cost),
  };
}

function edgeBottlenecks(log: EventLog, cost: CostModel): EdgeBottleneck[] {
  const { dfg, durations } = computeDfgWithDurations(log);
  return dfg.edges
    .filter((e) => e.from !== START && e.to !== END)
    .map((e) => {
      const name = edgeName(log, e.from, e.to);
      const targetMs = (cost.waitTargetsHours?.[name] ?? 0) * HOUR_MS;
      let excess = 0;
      for (const d of durations.get(edgeKey(e.from, e.to)) ?? []) excess += Math.max(0, d - targetMs);
      return {
        id: `edge:${name}`,
        from: log.activities[e.from]!,
        to: log.activities[e.to]!,
        frequency: e.frequency,
        wait: e.duration,
        totalWaitHours: e.duration.total / HOUR_MS,
        excessWaitHours: excess / HOUR_MS,
        delayCost: (excess / DAY_MS) * cost.delayCostPerCaseDay,
      };
    })
    .sort((x, y) => y.delayCost - x.delayCost || y.excessWaitHours - x.excessWaitHours);
}

function resourceBottlenecks(log: EventLog, cost: CostModel, opts: BottleneckOptions): ResourceBottleneck[] {
  const minExec = opts.minResourceExecutions ?? 20;
  const minSlowdown = opts.minSlowdown ?? 1.5;

  // Wait before an event = time since the previous event in the same case.
  const byActivity = new Map<number, number[]>();
  const byPair = new Map<number, number[]>(); // key = activity * resourceCount + resource
  const rc = log.resources.length;
  for (const c of log.cases) {
    for (let i = 1; i < c.events.length; i++) {
      const e = c.events[i]!;
      const w = e.t - c.events[i - 1]!.t;
      let a = byActivity.get(e.a);
      if (!a) byActivity.set(e.a, (a = []));
      a.push(w);
      if (e.r === NO_RESOURCE) continue;
      const k = e.a * rc + e.r;
      let p = byPair.get(k);
      if (!p) byPair.set(k, (p = []));
      p.push(w);
    }
  }

  const activityMedian = new Map<number, number>();
  for (const [a, ws] of byActivity) activityMedian.set(a, median(ws));

  const out: ResourceBottleneck[] = [];
  for (const [k, ws] of byPair) {
    if (ws.length < minExec) continue;
    const a = Math.floor(k / rc);
    const r = k % rc;
    const actMed = activityMedian.get(a) ?? 0;
    const med = median(ws);
    const slowdown = actMed > 0 ? med / actMed : med > 0 ? Infinity : 1;
    if (slowdown < minSlowdown) continue;
    let excess = 0;
    for (const w of ws) excess += Math.max(0, w - actMed);
    const activity = log.activities[a]!;
    const resource = log.resources[r]!;
    out.push({
      id: `resource:${activity}@${resource}`,
      activity,
      resource,
      executions: ws.length,
      medianWaitHours: med / HOUR_MS,
      activityMedianWaitHours: actMed / HOUR_MS,
      slowdown,
      excessWaitHours: excess / HOUR_MS,
      delayCost: (excess / DAY_MS) * cost.delayCostPerCaseDay,
    });
  }
  return out.sort((x, y) => y.excessWaitHours - x.excessWaitHours);
}

function reworkHotspots(log: EventLog, cost: CostModel): ReworkHotspot[] {
  const repeats = new Map<number, number>();
  const affected = new Map<number, Set<number>>(); // activity -> case indexes
  log.cases.forEach((c, ci) => {
    const seen = new Map<number, number>();
    for (const e of c.events) seen.set(e.a, (seen.get(e.a) ?? 0) + 1);
    for (const [a, n] of seen) {
      if (n < 2) continue;
      repeats.set(a, (repeats.get(a) ?? 0) + n - 1);
      let s = affected.get(a);
      if (!s) affected.set(a, (s = new Set()));
      s.add(ci);
    }
  });

  const total = log.cases.length || 1;
  const out: ReworkHotspot[] = [];
  for (const [a, n] of repeats) {
    const activity = log.activities[a]!;
    const minutes = cost.handlingMinutes[activity] ?? cost.defaultHandlingMinutes;
    const withSet = affected.get(a)!;
    const withT: number[] = [];
    const withoutT: number[] = [];
    log.cases.forEach((c, ci) => (withSet.has(ci) ? withT : withoutT).push(throughputTime(c)));
    out.push({
      id: `rework:${activity}`,
      activity,
      repeatExecutions: n,
      casesAffected: withSet.size,
      shareOfCases: withSet.size / total,
      handlingCost: (n * minutes * cost.hourlyRate) / 60,
      medianThroughputWithHours: durationStats(withT).median / HOUR_MS,
      medianThroughputWithoutHours: durationStats(withoutT).median / HOUR_MS,
    });
  }
  return out.sort((x, y) => y.casesAffected - x.casesAffected);
}
