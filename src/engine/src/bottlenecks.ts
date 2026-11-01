import { validateWorkCalendar, workingMs, type WorkCalendar } from "./calendar.ts";
import { computeDfg, edgeName } from "./dfg.ts";
import { throughputTime } from "./log.ts";
import { DAY_MS, HOUR_MS, durationStats, median } from "./stats.ts";
import { END, NO_RESOURCE, START, type DurationStats, type EventLog } from "./types.ts";

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
  /** Flat cost of one case waiting one extra day (late fees, chasing, customer goodwill). */
  delayCostPerCaseDay: number;
  /**
   * Cash tied up while a case waits: per extra day, the case's numeric
   * `attribute` × annualRate / 365. Use it where waiting delays money coming
   * in (billing, receivables), not for payables, where paying later saves cash.
   */
  capitalCost?: CapitalCost;
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

export interface CapitalCost {
  /** Numeric case attribute holding the money at stake, e.g. "amount". Cases without it cost nothing here. */
  attribute: string;
  /** Annual cost of capital as a fraction, e.g. 0.08. */
  annualRate: number;
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
  /** The same waits counted in working hours only; present when a calendar is given. */
  workingWait?: DurationStats;
  /** Waiting hours above the configured target for this transition (0 target if none). */
  excessWaitHours: number;
  /** Σ excess days × (delayCostPerCaseDay + the case's daily capital cost). */
  delayCost: number;
  /** The capital-cost part of delayCost (0 without `capitalCost`). */
  capitalCost: number;
}

/** A resource whose cases wait noticeably longer before an activity than average. */
export interface ResourceBottleneck {
  id: string;
  activity: string;
  resource: string;
  executions: number;
  /** Wait figures below are in the report's `waitBasis` (calendar or working hours). */
  medianWaitHours: number;
  /** Median wait before this activity across all resources. */
  activityMedianWaitHours: number;
  /** medianWaitHours / activityMedianWaitHours. */
  slowdown: number;
  /** Σ max(0, wait − activity median) in hours. */
  excessWaitHours: number;
  /** Calendar-time excess over the activity's calendar median, priced like EdgeBottleneck.delayCost. */
  delayCost: number;
  capitalCost: number;
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
  /** How resource waits were compared: working hours when a calendar was given. */
  waitBasis: "calendar" | "working";
  edges: EdgeBottleneck[];
  resources: ResourceBottleneck[];
  rework: ReworkHotspot[];
}

export interface BottleneckOptions {
  /** Ignore resource/activity pairs with fewer executions than this. Default 20. */
  minResourceExecutions?: number;
  /** Report resources at least this much slower than the activity median. Default 1.5. */
  minSlowdown?: number;
  /**
   * Working hours. When given, edges also report working-time waits and
   * resources are compared on working time, so a Friday-evening handoff
   * doesn't count against Monday's approver. Delay costs stay on calendar time.
   */
  calendar?: WorkCalendar;
}

export function analyzeBottlenecks(
  log: EventLog,
  cost: CostModel = DEFAULT_COST_MODEL,
  opts: BottleneckOptions = {},
): BottleneckReport {
  if (opts.calendar) validateWorkCalendar(opts.calendar);
  return {
    currency: cost.currency,
    waitBasis: opts.calendar ? "working" : "calendar",
    edges: edgeBottlenecks(log, cost, opts.calendar),
    resources: resourceBottlenecks(log, cost, opts),
    rework: reworkHotspots(log, cost),
  };
}

/** Daily cost of keeping each case waiting, split into flat and capital parts, by case index. */
function caseDayCosts(log: EventLog, cost: CostModel): { flat: number; capital: Float64Array } {
  const capital = new Float64Array(log.cases.length);
  const cc = cost.capitalCost;
  if (cc) {
    log.cases.forEach((c, ci) => {
      const v = c.attrs[cc.attribute];
      if (typeof v === "number" && Number.isFinite(v)) capital[ci] = (v * cc.annualRate) / 365;
    });
  }
  return { flat: cost.delayCostPerCaseDay, capital };
}

function edgeBottlenecks(log: EventLog, cost: CostModel, cal: WorkCalendar | undefined): EdgeBottleneck[] {
  const dfg = computeDfg(log);
  const working = cal ? workingEdgeWaits(log, cal) : null;
  const n = log.activities.length;

  // Excess waits and their price per transition (key = from * n + to), case by case,
  // because the capital cost depends on each case's amount.
  const targetMs = new Float64Array(n * n);
  for (const e of dfg.edges) {
    if (e.from === START || e.to === END) continue;
    targetMs[e.from * n + e.to] = (cost.waitTargetsHours?.[edgeName(log, e.from, e.to)] ?? 0) * HOUR_MS;
  }
  const day = caseDayCosts(log, cost);
  const excessMs = new Float64Array(n * n);
  const flatCost = new Float64Array(n * n);
  const capitalCost = new Float64Array(n * n);
  log.cases.forEach((c, ci) => {
    for (let i = 1; i < c.events.length; i++) {
      const k = c.events[i - 1]!.a * n + c.events[i]!.a;
      const ex = Math.max(0, c.events[i]!.t - c.events[i - 1]!.t - targetMs[k]!);
      excessMs[k]! += ex;
      flatCost[k]! += (ex / DAY_MS) * day.flat;
      capitalCost[k]! += (ex / DAY_MS) * day.capital[ci]!;
    }
  });

  return dfg.edges
    .filter((e) => e.from !== START && e.to !== END)
    .map((e) => {
      const k = e.from * n + e.to;
      return {
        id: `edge:${edgeName(log, e.from, e.to)}`,
        from: log.activities[e.from]!,
        to: log.activities[e.to]!,
        frequency: e.frequency,
        wait: e.duration,
        totalWaitHours: e.duration.total / HOUR_MS,
        ...(working && { workingWait: durationStats(working.get(k) ?? []) }),
        excessWaitHours: excessMs[k]! / HOUR_MS,
        delayCost: flatCost[k]! + capitalCost[k]!,
        capitalCost: capitalCost[k]!,
      };
    })
    .sort((x, y) => y.delayCost - x.delayCost || y.excessWaitHours - x.excessWaitHours);
}

/** Working-time waits per transition, keyed by from * activityCount + to. */
function workingEdgeWaits(log: EventLog, cal: WorkCalendar): Map<number, number[]> {
  const n = log.activities.length;
  const out = new Map<number, number[]>();
  for (const c of log.cases) {
    for (let i = 1; i < c.events.length; i++) {
      const prev = c.events[i - 1]!;
      const e = c.events[i]!;
      const k = prev.a * n + e.a;
      let ws = out.get(k);
      if (!ws) out.set(k, (ws = []));
      ws.push(workingMs(prev.t, e.t, cal));
    }
  }
  return out;
}

interface Waits {
  /** In the comparison basis (calendar or working time). */
  basis: number[];
  calendar: number[];
  /** Daily capital cost of the waiting case. */
  capitalPerDay: number[];
}

function resourceBottlenecks(log: EventLog, cost: CostModel, opts: BottleneckOptions): ResourceBottleneck[] {
  const minExec = opts.minResourceExecutions ?? 20;
  const minSlowdown = opts.minSlowdown ?? 1.5;
  const cal = opts.calendar;

  // Wait before an event = time since the previous event in the same case.
  const byActivity = new Map<number, Waits>();
  const byPair = new Map<number, Waits>(); // key = activity * resourceCount + resource
  const day = caseDayCosts(log, cost);
  const push = (m: Map<number, Waits>, k: number, b: number, w: number, cap: number) => {
    let x = m.get(k);
    if (!x) m.set(k, (x = { basis: [], calendar: [], capitalPerDay: [] }));
    x.basis.push(b);
    x.calendar.push(w);
    x.capitalPerDay.push(cap);
  };
  const rc = log.resources.length;
  log.cases.forEach((c, ci) => {
    for (let i = 1; i < c.events.length; i++) {
      const e = c.events[i]!;
      const prevT = c.events[i - 1]!.t;
      const w = e.t - prevT;
      const b = cal ? workingMs(prevT, e.t, cal) : w;
      push(byActivity, e.a, b, w, day.capital[ci]!);
      if (e.r !== NO_RESOURCE) push(byPair, e.a * rc + e.r, b, w, day.capital[ci]!);
    }
  });

  const activityMedian = new Map<number, { basis: number; calendar: number }>();
  for (const [a, ws] of byActivity) activityMedian.set(a, { basis: median(ws.basis), calendar: median(ws.calendar) });

  const out: ResourceBottleneck[] = [];
  for (const [k, ws] of byPair) {
    if (ws.basis.length < minExec) continue;
    const a = Math.floor(k / rc);
    const r = k % rc;
    const actMed = activityMedian.get(a) ?? { basis: 0, calendar: 0 };
    const med = median(ws.basis);
    const slowdown = actMed.basis > 0 ? med / actMed.basis : med > 0 ? Infinity : 1;
    if (slowdown < minSlowdown) continue;
    let excess = 0;
    for (const w of ws.basis) excess += Math.max(0, w - actMed.basis);
    let flatCost = 0;
    let capitalCost = 0;
    ws.calendar.forEach((w, i) => {
      const days = Math.max(0, w - actMed.calendar) / DAY_MS;
      flatCost += days * day.flat;
      capitalCost += days * ws.capitalPerDay[i]!;
    });
    const activity = log.activities[a]!;
    const resource = log.resources[r]!;
    out.push({
      id: `resource:${activity}@${resource}`,
      activity,
      resource,
      executions: ws.basis.length,
      medianWaitHours: med / HOUR_MS,
      activityMedianWaitHours: actMed.basis / HOUR_MS,
      slowdown,
      excessWaitHours: excess / HOUR_MS,
      delayCost: flatCost + capitalCost,
      capitalCost,
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
