import { validateWorkCalendar, workingMs, type WorkCalendar } from "./calendar.js";
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
  /** The same waits counted in working hours only; present when a calendar is given. */
  workingWait?: DurationStats;
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
  /** Wait figures below are in the report's `waitBasis` (calendar or working hours). */
  medianWaitHours: number;
  /** Median wait before this activity across all resources. */
  activityMedianWaitHours: number;
  /** medianWaitHours / activityMedianWaitHours. */
  slowdown: number;
  /** Σ max(0, wait − activity median) in hours. */
  excessWaitHours: number;
  /** Calendar-time excess over the activity's calendar median, in days × delayCostPerCaseDay. */
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

function edgeBottlenecks(log: EventLog, cost: CostModel, cal: WorkCalendar | undefined): EdgeBottleneck[] {
  const { dfg, durations } = computeDfgWithDurations(log);
  const working = cal ? workingEdgeWaits(log, cal) : null;
  const n = log.activities.length;
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
        ...(working && { workingWait: durationStats(working.get(e.from * n + e.to) ?? []) }),
        excessWaitHours: excess / HOUR_MS,
        delayCost: (excess / DAY_MS) * cost.delayCostPerCaseDay,
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
}

function resourceBottlenecks(log: EventLog, cost: CostModel, opts: BottleneckOptions): ResourceBottleneck[] {
  const minExec = opts.minResourceExecutions ?? 20;
  const minSlowdown = opts.minSlowdown ?? 1.5;
  const cal = opts.calendar;

  // Wait before an event = time since the previous event in the same case.
  const byActivity = new Map<number, Waits>();
  const byPair = new Map<number, Waits>(); // key = activity * resourceCount + resource
  const push = (m: Map<number, Waits>, k: number, b: number, w: number) => {
    let x = m.get(k);
    if (!x) m.set(k, (x = { basis: [], calendar: [] }));
    x.basis.push(b);
    x.calendar.push(w);
  };
  const rc = log.resources.length;
  for (const c of log.cases) {
    for (let i = 1; i < c.events.length; i++) {
      const e = c.events[i]!;
      const prevT = c.events[i - 1]!.t;
      const w = e.t - prevT;
      const b = cal ? workingMs(prevT, e.t, cal) : w;
      push(byActivity, e.a, b, w);
      if (e.r !== NO_RESOURCE) push(byPair, e.a * rc + e.r, b, w);
    }
  }

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
    let calendarExcess = 0;
    for (const w of ws.calendar) calendarExcess += Math.max(0, w - actMed.calendar);
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
      delayCost: (calendarExcess / DAY_MS) * cost.delayCostPerCaseDay,
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
