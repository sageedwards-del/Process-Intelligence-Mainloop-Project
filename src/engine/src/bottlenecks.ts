import { validateWorkCalendar, workingMs, type WorkCalendar } from "./calendar.ts";
import { computeDfg, edgeName } from "./dfg.ts";
import { throughputTime } from "./log.ts";
import { evaluateRule, type Rule } from "./rules.ts";
import { DAY_MS, HOUR_MS, durationStats, median } from "./stats.ts";
import { END, NO_RESOURCE, START, type Dfg, type DurationStats, type EventLog } from "./types.ts";

/**
 * Assumptions used to translate time into money. Every figure the engine
 * reports in currency is derived from these, so the UI can show and edit them.
 * The reasoning and sources are in docs/adr/0002-cost-model.md.
 */
export interface CostModel {
  currency: string;
  /** Fully loaded cost of one staff hour. */
  hourlyRate: number;
  /** Touch time per execution, by activity name, in minutes. */
  handlingMinutes: Record<string, number>;
  defaultHandlingMinutes: number;
  /**
   * Any other cost of one case waiting one extra day that no rule already
   * prices, e.g. a contractual penalty per day. Default 0: waiting costs
   * money through its consequences (time rules, capital), not by itself.
   */
  delayCostPerCaseDay: number;
  /**
   * Cash tied up while a case waits: per extra day, the case's numeric
   * `attribute` × annualRate / 365. Use it where waiting delays money coming
   * in (billing, receivables), not for payables, where paying later saves cash.
   */
  capitalCost?: CapitalCost;
  /**
   * Acceptable wait per transition ("A → B"), in hours. Waiting beyond it
   * counts as excess. Transitions without a target use their median wait.
   */
  waitTargetsHours?: Record<string, number>;
  /** What one violation of a rule costs, keyed by rule id. Rules without an entry cost nothing. */
  ruleImpacts?: Record<string, RuleImpact>;
}

/**
 * Money at stake per rule violation, as an expected loss. `time` covers
 * consequences of slowness (a missed early-payment discount); `compliance`
 * covers control failures (a duplicate payment, a missing approval).
 * Cost per violation = `perViolation` + `share` × the case's numeric
 * `attribute` × (1 − `recoveryRate`).
 */
export interface RuleImpact {
  category: "time" | "compliance";
  /** Fixed cost of each violation, e.g. the effort to follow it up or recover the money. */
  perViolation?: number;
  share?: { attribute: string; fraction: number };
  /** Fraction of the `share` amount expected to come back (0..1), e.g. a duplicate payment clawed back. */
  recoveryRate?: number;
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
  delayCostPerCaseDay: 0,
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
  /** The wait counted as normal: the configured target, else the median wait. */
  targetHours: number;
  targetSource: "configured" | "median";
  /** Waiting hours above `targetHours`, summed over cases. */
  excessWaitHours: number;
  /**
   * Σ excess days × (delayCostPerCaseDay + the case's daily capital cost),
   * plus `consequenceCost`.
   */
  delayCost: number;
  /** The capital-cost part of delayCost (0 without `capitalCost`). */
  capitalCost: number;
  /**
   * The part of delayCost allocated from time-rule violations (e.g. missed
   * discounts): each violation's cost is split over its case's waits in
   * proportion to their excess. The same money the rule reports, not extra.
   */
  consequenceCost: number;
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
  /** Time-rule cost allocated to the waits before this person's executions (see EdgeBottleneck). */
  consequenceCost: number;
}

/**
 * Baseline labour per case, time-driven activity-based costing style:
 * every execution × its handling minutes × the hourly rate.
 */
export interface CostToServe {
  /** Σ over all executions. */
  total: number;
  /** total / cases. */
  perCase: number;
  activities: { id: string; activity: string; executions: number; minutes: number; cost: number }[];
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
  costToServe: CostToServe;
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
  /**
   * Rules whose `time` impacts (from `cost.ruleImpacts`) are allocated to the
   * waits that caused them, so transitions and people carry that money.
   */
  rules?: readonly Rule[];
}

export function analyzeBottlenecks(
  log: EventLog,
  cost: CostModel = DEFAULT_COST_MODEL,
  opts: BottleneckOptions = {},
): BottleneckReport {
  if (opts.calendar) validateWorkCalendar(opts.calendar);
  const dfg = computeDfg(log);
  const targets = edgeTargets(log, cost, dfg);
  const allocated = allocateTimeCosts(log, cost, opts.rules ?? [], targets);
  return {
    currency: cost.currency,
    waitBasis: opts.calendar ? "working" : "calendar",
    edges: edgeBottlenecks(log, cost, dfg, targets, allocated, opts.calendar),
    resources: resourceBottlenecks(log, cost, opts, allocated),
    rework: reworkHotspots(log, cost),
    costToServe: costToServe(log, cost),
  };
}

/** Normal wait per transition (key = from * n + to), in ms: the configured target, else the median. */
interface EdgeTargets {
  ms: Float64Array;
  configured: Uint8Array;
}

function edgeTargets(log: EventLog, cost: CostModel, dfg: Dfg): EdgeTargets {
  const n = log.activities.length;
  const ms = new Float64Array(n * n);
  const configured = new Uint8Array(n * n);
  for (const e of dfg.edges) {
    if (e.from === START || e.to === END) continue;
    const k = e.from * n + e.to;
    const target = cost.waitTargetsHours?.[edgeName(log, e.from, e.to)];
    if (target !== undefined) configured[k] = 1;
    ms[k] = target !== undefined ? target * HOUR_MS : e.duration.median;
  }
  return { ms, configured };
}

/**
 * Splits each priced `time`-rule violation over the waits that caused it:
 * for an SLA rule the waits between its `from` and `to`, otherwise the whole
 * case, in proportion to each wait's excess over its transition's target
 * (or to the raw waits if none is in excess). Returns, per case, the money
 * allocated to the wait before each event.
 */
function allocateTimeCosts(log: EventLog, cost: CostModel, rules: readonly Rule[], targets: EdgeTargets): Map<number, Float64Array> {
  const out = new Map<number, Float64Array>();
  const timeRules = rules.filter((r) => cost.ruleImpacts?.[r.id]?.category === "time");
  if (timeRules.length === 0) return out;
  const n = log.activities.length;
  const caseIndex = new Map(log.cases.map((c, ci) => [c.id, ci]));

  for (const rule of timeRules) {
    for (const v of evaluateRule(log, rule, cost).violations) {
      if (v.cost <= 0) continue;
      const ci = caseIndex.get(v.caseId)!;
      const c = log.cases[ci]!;
      let first = 1;
      let last = c.events.length - 1;
      if (rule.type === "sla") {
        const from = log.activities.indexOf(rule.from);
        const to = log.activities.indexOf(rule.to);
        const iFrom = c.events.findIndex((e) => e.a === from);
        const iTo = c.events.findIndex((e, i) => i > iFrom && e.a === to);
        first = iFrom + 1;
        last = iTo;
      }
      const waits: number[] = [];
      const excess: number[] = [];
      for (let i = first; i <= last; i++) {
        const w = c.events[i]!.t - c.events[i - 1]!.t;
        waits.push(w);
        excess.push(Math.max(0, w - targets.ms[c.events[i - 1]!.a * n + c.events[i]!.a]!));
      }
      const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
      const weights = sum(excess) > 0 ? excess : waits;
      const total = sum(weights);
      if (total <= 0) continue;
      let alloc = out.get(ci);
      if (!alloc) out.set(ci, (alloc = new Float64Array(c.events.length)));
      weights.forEach((w, j) => (alloc[first + j]! += (v.cost * w) / total));
    }
  }
  return out;
}

function costToServe(log: EventLog, cost: CostModel): CostToServe {
  const executions = new Float64Array(log.activities.length);
  for (const c of log.cases) for (const e of c.events) executions[e.a]! += 1;
  const activities = log.activities
    .map((activity, a) => {
      const minutes = cost.handlingMinutes[activity] ?? cost.defaultHandlingMinutes;
      return { id: `labour:${activity}`, activity, executions: executions[a]!, minutes, cost: (executions[a]! * minutes * cost.hourlyRate) / 60 };
    })
    .filter((x) => x.executions > 0)
    .sort((x, y) => y.cost - x.cost || x.activity.localeCompare(y.activity));
  const total = activities.reduce((s, x) => s + x.cost, 0);
  return { total, perCase: log.cases.length ? total / log.cases.length : 0, activities };
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

function edgeBottlenecks(
  log: EventLog,
  cost: CostModel,
  dfg: Dfg,
  targets: EdgeTargets,
  allocated: Map<number, Float64Array>,
  cal: WorkCalendar | undefined,
): EdgeBottleneck[] {
  const working = cal ? workingEdgeWaits(log, cal) : null;
  const n = log.activities.length;

  // Excess waits and their price per transition (key = from * n + to), case by case,
  // because the capital cost depends on each case's amount.
  const day = caseDayCosts(log, cost);
  const excessMs = new Float64Array(n * n);
  const flatCost = new Float64Array(n * n);
  const capitalCost = new Float64Array(n * n);
  const consequenceCost = new Float64Array(n * n);
  log.cases.forEach((c, ci) => {
    const alloc = allocated.get(ci);
    for (let i = 1; i < c.events.length; i++) {
      const k = c.events[i - 1]!.a * n + c.events[i]!.a;
      const ex = Math.max(0, c.events[i]!.t - c.events[i - 1]!.t - targets.ms[k]!);
      excessMs[k]! += ex;
      flatCost[k]! += (ex / DAY_MS) * day.flat;
      capitalCost[k]! += (ex / DAY_MS) * day.capital[ci]!;
      if (alloc) consequenceCost[k]! += alloc[i]!;
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
        targetHours: targets.ms[k]! / HOUR_MS,
        targetSource: targets.configured[k] ? ("configured" as const) : ("median" as const),
        excessWaitHours: excessMs[k]! / HOUR_MS,
        delayCost: flatCost[k]! + capitalCost[k]! + consequenceCost[k]!,
        capitalCost: capitalCost[k]!,
        consequenceCost: consequenceCost[k]!,
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
  /** Time-rule cost allocated to this wait. */
  consequence: number[];
}

function resourceBottlenecks(
  log: EventLog,
  cost: CostModel,
  opts: BottleneckOptions,
  allocated: Map<number, Float64Array>,
): ResourceBottleneck[] {
  const minExec = opts.minResourceExecutions ?? 20;
  const minSlowdown = opts.minSlowdown ?? 1.5;
  const cal = opts.calendar;

  // Wait before an event = time since the previous event in the same case.
  const byActivity = new Map<number, Waits>();
  const byPair = new Map<number, Waits>(); // key = activity * resourceCount + resource
  const day = caseDayCosts(log, cost);
  const push = (m: Map<number, Waits>, k: number, b: number, w: number, cap: number, con: number) => {
    let x = m.get(k);
    if (!x) m.set(k, (x = { basis: [], calendar: [], capitalPerDay: [], consequence: [] }));
    x.basis.push(b);
    x.calendar.push(w);
    x.capitalPerDay.push(cap);
    x.consequence.push(con);
  };
  const rc = log.resources.length;
  log.cases.forEach((c, ci) => {
    const alloc = allocated.get(ci);
    for (let i = 1; i < c.events.length; i++) {
      const e = c.events[i]!;
      const prevT = c.events[i - 1]!.t;
      const w = e.t - prevT;
      const b = cal ? workingMs(prevT, e.t, cal) : w;
      const con = alloc ? alloc[i]! : 0;
      push(byActivity, e.a, b, w, day.capital[ci]!, con);
      if (e.r !== NO_RESOURCE) push(byPair, e.a * rc + e.r, b, w, day.capital[ci]!, con);
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
    let consequenceCost = 0;
    ws.calendar.forEach((w, i) => {
      const days = Math.max(0, w - actMed.calendar) / DAY_MS;
      flatCost += days * day.flat;
      capitalCost += days * ws.capitalPerDay[i]!;
      consequenceCost += ws.consequence[i]!;
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
      delayCost: flatCost + capitalCost + consequenceCost,
      capitalCost,
      consequenceCost,
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
