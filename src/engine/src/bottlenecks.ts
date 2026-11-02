import { validateWorkCalendar, workingMs, type WorkCalendar } from "./calendar.ts";
import { computeDfg, edgeName } from "./dfg.ts";
import { throughputTime } from "./log.ts";
import { evaluateRule, type Rule } from "./rules.ts";
import { DAY_MS, HOUR_MS, durationStats, median, quantileSorted } from "./stats.ts";
import { END, NO_RESOURCE, START, type DurationStats, type EventLog } from "./types.ts";
import {
  DEFAULT_NORMAL_WAIT_PERCENTILE,
  WAIT_BATCH,
  WAIT_HUMAN,
  WAIT_INSTANT,
  WAIT_SCHEDULED,
  classifyWaits,
  type AnalysisSettings,
  type BatchStep,
  type WaitClassification,
  type WaitContext,
} from "./waits.ts";


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


/** Where a transition's waiting time went, in hours (see waits.ts). */
export interface WaitBreakdown {
  /** Waiting in working hours, by people or queues: the part that can be excess. */
  queueHours: number;
  /** Nights, weekends and holidays inside human waits. */
  offHoursHours: number;
  /** Waiting for a batch run or a system job. */
  batchHours: number;
  /** Waiting for a planned date. Never a delay. */
  scheduledHours: number;
  /** Working time on the step itself, from lifecycle starts; null without them. */
  processingHours: number | null;
}

/** A transition where cases wait. `id` is stable and safe to cite. */
export interface EdgeBottleneck {
  id: string;
  from: string;
  to: string;
  frequency: number;
  wait: DurationStats;
  totalWaitHours: number;
  /** Working-time waits under an explicitly given calendar (for the pm4py cross-check). */
  workingWait?: DurationStats;
  breakdown: WaitBreakdown;
  /** What most of the waiting is: a queue, a batch run, or a planned date. */
  kind: "queue" | "batch" | "scheduled";
  /** Share of executions that followed within a minute (automatic), 0..1. */
  automaticShare: number;
  /** The queue time counted as normal: the configured target, else the percentile of human waits. */
  targetHours: number;
  targetSource: "configured" | "percentile";
  /**
   * Queue hours above `targetHours`, summed over cases, with each wait counted
   * up to the transition's 95th percentile so a few stuck cases can't outrank
   * a step that is slow every day. The rest is `stuckHours`.
   */
  excessWaitHours: number;
  /** Queue hours beyond the 95th percentile: cases stuck far longer than almost all others. */
  stuckHours: number;
  /** Waits beyond the 95th percentile. */
  stuckCount: number;
  /**
   * Σ excess calendar days × (delayCostPerCaseDay + the case's daily capital
   * cost), plus `consequenceCost`. Planned waits are never priced.
   */
  delayCost: number;
  /** The capital-cost part of delayCost (0 without `capitalCost`). */
  capitalCost: number;
  /**
   * The part of delayCost allocated from time-rule violations (e.g. missed
   * discounts): each violation's cost is split over its case's waits in
   * proportion to their queue excess. The same money the rule reports, not extra.
   */
  consequenceCost: number;
}

/** A resource whose cases wait noticeably longer before an activity than average. */
export interface ResourceBottleneck {
  id: string;
  activity: string;
  resource: string;
  executions: number;
  /** Median queue time (working hours, human waits) before this resource's executions. */
  medianWaitHours: number;
  /** The same median across all resources doing the activity. */
  activityMedianWaitHours: number;
  /** medianWaitHours / activityMedianWaitHours. */
  slowdown: number;
  /** Σ queue time beyond peers' normal, each wait counted up to this person's 95th percentile, in hours. */
  excessWaitHours: number;
  /** Calendar-time excess over peers' normal calendar wait, priced like EdgeBottleneck.delayCost. */
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
  /** Queue waits are measured in working hours from this calendar. */
  waitBasis: "working";
  /** How waits were classified: the calendar, scheduled steps and systems (see waits.ts). */
  classification: Omit<WaitClassification, "kinds" | "batches" | "runs">;
  /** The percentile of human waits counted as normal. */
  normalWaitPercentile: number;
  edges: EdgeBottleneck[];
  resources: ResourceBottleneck[];
  /** Steps done in batch runs, as their own lever: how often they run. */
  batches: BatchStep[];
  rework: ReworkHotspot[];
  costToServe: CostToServe;
}

export interface BottleneckOptions {
  /** Ignore resource/activity pairs with fewer executions than this. Default 20. */
  minResourceExecutions?: number;
  /** Report resources at least this much slower than the activity median. Default 1.5. */
  minSlowdown?: number;
  /**
   * Working hours to measure queue time in, instead of the ones learned from
   * the log. Also adds working-time wait statistics per edge.
   */
  calendar?: WorkCalendar;
  /** Scheduled steps, systems and the normal-wait percentile, as set for the dataset. */
  settings?: AnalysisSettings;
  /** What `detectWaitContext` found on the full log, when this log is a filtered subset of it. */
  context?: WaitContext;
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
  const settings: AnalysisSettings = { ...opts.settings, ...(opts.calendar && { calendar: opts.calendar }) };
  const percentile = settings.normalWaitPercentile ?? DEFAULT_NORMAL_WAIT_PERCENTILE;
  const cls = classifyWaits(log, settings, opts.context);
  const waits = measureWaits(log, cost, cls, percentile);
  const allocated = allocateTimeCosts(log, cost, opts.rules ?? [], waits);
  const { kinds: _kinds, batches, runs: _runs, ...classification } = cls;
  return {
    currency: cost.currency,
    waitBasis: "working",
    classification,
    normalWaitPercentile: percentile,
    edges: edgeBottlenecks(log, cost, waits, allocated, opts.calendar),
    resources: resourceBottlenecks(log, cost, opts, waits, allocated),
    batches,
    rework: reworkHotspots(log, cost),
    costToServe: costToServe(log, cost),
  };
}

/** Waits beyond this percentile of their transition count as stuck cases, apart from the excess ranking. */
const STUCK_PERCENTILE = 0.95;
/** Fewer waits than this make a 95th percentile meaningless, so nothing is set apart as stuck. */
const MIN_FOR_STUCK = 20;

/** Every wait in the log, measured once (per case, indexed by the event the wait precedes). */
interface Waits {
  cls: WaitClassification;
  /** Calendar ms from the previous event to this one's start (or completion). */
  calendar: Float64Array[];
  /** Working ms within that wait, for human and instant waits; 0 otherwise. */
  queue: Float64Array[];
  /** Queue ms beyond the transition's normal queue time (human waits only), uncapped. */
  queueExcess: Float64Array[];
  /** The part of queueExcess beyond the transition's 95th percentile (stuck cases). */
  queueStuck: Float64Array[];
  /** Calendar ms beyond the transition's normal calendar wait (not for planned waits). */
  calendarExcess: Float64Array[];
  /** Normal queue ms per transition (key = from * n + to), and whether it was configured. */
  normalQueue: Float64Array;
  configured: Uint8Array;
}

function measureWaits(log: EventLog, cost: CostModel, cls: WaitClassification, percentile: number): Waits {
  const n = log.activities.length;
  const cal = cls.calendar;
  const calendar: Float64Array[] = [];
  const queue: Float64Array[] = [];
  const humanQueues = new Map<number, number[]>();
  const calendarWaits = new Map<number, number[]>();
  const push = (m: Map<number, number[]>, k: number, v: number) => {
    let xs = m.get(k);
    if (!xs) m.set(k, (xs = []));
    xs.push(v);
  };
  log.cases.forEach((c, ci) => {
    const kinds = cls.kinds[ci]!;
    const cw = new Float64Array(c.events.length);
    const qw = new Float64Array(c.events.length);
    for (let i = 1; i < c.events.length; i++) {
      const prev = c.events[i - 1]!;
      const e = c.events[i]!;
      const end = Math.max(prev.t, e.s ?? e.t);
      const k = prev.a * n + e.a;
      cw[i] = end - prev.t;
      if (kinds[i] === WAIT_HUMAN || kinds[i] === WAIT_INSTANT) qw[i] = workingMs(prev.t, end, cal);
      if (kinds[i] === WAIT_HUMAN) push(humanQueues, k, qw[i]!);
      if (kinds[i] !== WAIT_SCHEDULED) push(calendarWaits, k, cw[i]!);
    }
    calendar.push(cw);
    queue.push(qw);
  });

  const normalQueue = new Float64Array(n * n);
  const stuckQueue = new Float64Array(n * n);
  const normalCalendar = new Float64Array(n * n);
  const configured = new Uint8Array(n * n);
  const pct = (xs: number[] | undefined, p = percentile) => (xs?.length ? quantileSorted([...xs].sort((x, y) => x - y), p) : 0);
  for (let from = 0; from < n; from++) {
    for (let to = 0; to < n; to++) {
      const k = from * n + to;
      const target = cost.waitTargetsHours?.[`${log.activities[from]} → ${log.activities[to]}`];
      if (target !== undefined) {
        configured[k] = 1;
        normalQueue[k] = normalCalendar[k] = target * HOUR_MS;
      } else if (humanQueues.has(k) || calendarWaits.has(k)) {
        normalQueue[k] = pct(humanQueues.get(k));
        normalCalendar[k] = pct(calendarWaits.get(k));
      }
      const human = humanQueues.get(k);
      stuckQueue[k] = human && human.length >= MIN_FOR_STUCK ? Math.max(normalQueue[k]!, pct(human, STUCK_PERCENTILE)) : Infinity;
    }
  }

  const queueExcess: Float64Array[] = [];
  const queueStuck: Float64Array[] = [];
  const calendarExcess: Float64Array[] = [];
  log.cases.forEach((c, ci) => {
    const kinds = cls.kinds[ci]!;
    const qx = new Float64Array(c.events.length);
    const qs = new Float64Array(c.events.length);
    const cx = new Float64Array(c.events.length);
    for (let i = 1; i < c.events.length; i++) {
      const k = c.events[i - 1]!.a * n + c.events[i]!.a;
      if (kinds[i] === WAIT_HUMAN) {
        qx[i] = Math.max(0, queue[ci]![i]! - normalQueue[k]!);
        qs[i] = Math.max(0, queue[ci]![i]! - stuckQueue[k]!);
      }
      if (kinds[i] !== WAIT_SCHEDULED) cx[i] = Math.max(0, calendar[ci]![i]! - normalCalendar[k]!);
    }
    queueExcess.push(qx);
    queueStuck.push(qs);
    calendarExcess.push(cx);
  });
  return { cls, calendar, queue, queueExcess, queueStuck, calendarExcess, normalQueue, configured };
}

/**
 * Splits each priced `time`-rule violation over the waits that caused it:
 * for an SLA rule the waits between its `from` and `to`, otherwise the whole
 * case. Weights are each wait's queue excess; if none is in excess, the
 * waits for batch runs; failing that, every unplanned wait. Planned waits
 * never carry money. Returns, per case, the money allocated to the wait
 * before each event.
 */
function allocateTimeCosts(log: EventLog, cost: CostModel, rules: readonly Rule[], waits: Waits): Map<number, Float64Array> {
  const out = new Map<number, Float64Array>();
  const timeRules = rules.filter((r) => cost.ruleImpacts?.[r.id]?.category === "time");
  if (timeRules.length === 0) return out;
  const caseIndex = new Map(log.cases.map((c, ci) => [c.id, ci]));

  for (const rule of timeRules) {
    for (const v of evaluateRule(log, rule, cost).violations) {
      if (v.cost <= 0) continue;
      const ci = caseIndex.get(v.caseId)!;
      const c = log.cases[ci]!;
      const kinds = waits.cls.kinds[ci]!;
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
      const span = (f: (i: number) => number) => Array.from({ length: Math.max(0, last - first + 1) }, (_, j) => f(first + j));
      const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
      let weights = span((i) => waits.queueExcess[ci]![i]!);
      if (sum(weights) <= 0) weights = span((i) => (kinds[i] === WAIT_BATCH ? waits.calendar[ci]![i]! : 0));
      if (sum(weights) <= 0) weights = span((i) => (kinds[i] === WAIT_SCHEDULED ? 0 : waits.calendar[ci]![i]!));
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

/** Daily capital cost of keeping each case waiting, by case index. */
function capitalPerDay(log: EventLog, cost: CostModel): Float64Array {
  const capital = new Float64Array(log.cases.length);
  const cc = cost.capitalCost;
  if (cc) {
    log.cases.forEach((c, ci) => {
      const v = c.attrs[cc.attribute];
      if (typeof v === "number" && Number.isFinite(v)) capital[ci] = (v * cc.annualRate) / 365;
    });
  }
  return capital;
}

function edgeBottlenecks(
  log: EventLog,
  cost: CostModel,
  waits: Waits,
  allocated: Map<number, Float64Array>,
  cal: WorkCalendar | undefined,
): EdgeBottleneck[] {
  const dfg = computeDfg(log);
  const working = cal ? workingEdgeWaits(log, cal) : null;
  const n = log.activities.length;
  const size = n * n;
  const capital = capitalPerDay(log, cost);
  const sums = {
    queue: new Float64Array(size),
    offHours: new Float64Array(size),
    batch: new Float64Array(size),
    scheduled: new Float64Array(size),
    processing: new Float64Array(size),
    processed: new Float64Array(size),
    instant: new Float64Array(size),
    human: new Float64Array(size),
    excess: new Float64Array(size),
    stuck: new Float64Array(size),
    stuckCount: new Float64Array(size),
    flat: new Float64Array(size),
    capital: new Float64Array(size),
    consequence: new Float64Array(size),
  };
  log.cases.forEach((c, ci) => {
    const kinds = waits.cls.kinds[ci]!;
    const alloc = allocated.get(ci);
    for (let i = 1; i < c.events.length; i++) {
      const e = c.events[i]!;
      const k = c.events[i - 1]!.a * n + e.a;
      const w = waits.calendar[ci]![i]!;
      const kind = kinds[i];
      if (kind === WAIT_SCHEDULED) sums.scheduled[k]! += w;
      else if (kind === WAIT_BATCH) sums.batch[k]! += w;
      else {
        sums.queue[k]! += waits.queue[ci]![i]!;
        sums.offHours[k]! += w - waits.queue[ci]![i]!;
        if (kind === WAIT_INSTANT) sums.instant[k]! += 1;
        else sums.human[k]! += 1;
      }
      if (e.p !== undefined) {
        sums.processing[k]! += e.p;
        sums.processed[k]! += 1;
      }
      const stuck = waits.queueStuck[ci]![i]!;
      sums.excess[k]! += waits.queueExcess[ci]![i]! - stuck;
      sums.stuck[k]! += stuck;
      if (stuck > 0) sums.stuckCount[k]! += 1;
      const days = waits.calendarExcess[ci]![i]! / DAY_MS;
      sums.flat[k]! += days * cost.delayCostPerCaseDay;
      sums.capital[k]! += days * capital[ci]!;
      if (alloc) sums.consequence[k]! += alloc[i]!;
    }
  });

  return dfg.edges
    .filter((e) => e.from !== START && e.to !== END)
    .map((e) => {
      const k = e.from * n + e.to;
      const total = sums.queue[k]! + sums.offHours[k]! + sums.batch[k]! + sums.scheduled[k]!;
      const kind: EdgeBottleneck["kind"] =
        total > 0 && sums.scheduled[k]! / total > 0.5 ? "scheduled" : total > 0 && sums.batch[k]! / total > 0.5 ? "batch" : "queue";
      const timed = sums.instant[k]! + sums.human[k]!;
      return {
        id: `edge:${edgeName(log, e.from, e.to)}`,
        from: log.activities[e.from]!,
        to: log.activities[e.to]!,
        frequency: e.frequency,
        wait: e.duration,
        totalWaitHours: e.duration.total / HOUR_MS,
        ...(working && { workingWait: durationStats(working.get(k) ?? []) }),
        breakdown: {
          queueHours: sums.queue[k]! / HOUR_MS,
          offHoursHours: sums.offHours[k]! / HOUR_MS,
          batchHours: sums.batch[k]! / HOUR_MS,
          scheduledHours: sums.scheduled[k]! / HOUR_MS,
          processingHours: sums.processed[k]! ? sums.processing[k]! / HOUR_MS : null,
        },
        kind,
        automaticShare: timed ? sums.instant[k]! / timed : 0,
        targetHours: waits.normalQueue[k]! / HOUR_MS,
        targetSource: waits.configured[k] ? ("configured" as const) : ("percentile" as const),
        excessWaitHours: sums.excess[k]! / HOUR_MS,
        stuckHours: sums.stuck[k]! / HOUR_MS,
        stuckCount: sums.stuckCount[k]!,
        delayCost: sums.flat[k]! + sums.capital[k]! + sums.consequence[k]!,
        capitalCost: sums.capital[k]!,
        consequenceCost: sums.consequence[k]!,
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

interface ResourceWaits {
  /** Queue ms of human waits, and who did each step (NO_RESOURCE if nobody is recorded). */
  queue: number[];
  queueBy: number[];
  /** Calendar ms of unplanned waits, with each wait's daily capital cost and allocated money. */
  calendar: number[];
  calendarBy: number[];
  capitalPerDay: number[];
  consequence: number[];
}

function resourceBottlenecks(
  log: EventLog,
  cost: CostModel,
  opts: BottleneckOptions,
  waits: Waits,
  allocated: Map<number, Float64Array>,
): ResourceBottleneck[] {
  const minExec = opts.minResourceExecutions ?? 20;
  const minSlowdown = opts.minSlowdown ?? 1.5;
  const percentile = opts.settings?.normalWaitPercentile ?? DEFAULT_NORMAL_WAIT_PERCENTILE;
  const capital = capitalPerDay(log, cost);

  // Wait before an event = time since the previous event in the same case.
  const byActivity = new Map<number, ResourceWaits>();
  const byPair = new Map<number, ResourceWaits & { executions: number }>(); // key = activity * resourceCount + resource
  const rc = log.resources.length;
  const fresh = (): ResourceWaits => ({ queue: [], queueBy: [], calendar: [], calendarBy: [], capitalPerDay: [], consequence: [] });
  log.cases.forEach((c, ci) => {
    const kinds = waits.cls.kinds[ci]!;
    const alloc = allocated.get(ci);
    for (let i = 1; i < c.events.length; i++) {
      const e = c.events[i]!;
      if (kinds[i] === WAIT_SCHEDULED) continue;
      let act = byActivity.get(e.a);
      if (!act) byActivity.set(e.a, (act = fresh()));
      let pair: (ResourceWaits & { executions: number }) | undefined;
      if (e.r !== NO_RESOURCE) {
        pair = byPair.get(e.a * rc + e.r);
        if (!pair) byPair.set(e.a * rc + e.r, (pair = { ...fresh(), executions: 0 }));
        pair.executions++;
      }
      for (const x of pair ? [act, pair] : [act]) {
        if (kinds[i] === WAIT_HUMAN) {
          x.queue.push(waits.queue[ci]![i]!);
          x.queueBy.push(e.r);
        }
        x.calendar.push(waits.calendar[ci]![i]!);
        x.calendarBy.push(e.r);
        x.capitalPerDay.push(capital[ci]!);
        x.consequence.push(alloc ? alloc[i]! : 0);
      }
    }
  });

  const pct = (xs: number[]) => (xs.length ? quantileSorted([...xs].sort((x, y) => x - y), percentile) : 0);
  // A person's excess is measured against their peers' normal wait, so someone who
  // handles many of the cases can't make their own slowness the norm.
  const peers = (values: number[], by: number[], r: number) => values.filter((_, i) => by[i] !== r);

  const out: ResourceBottleneck[] = [];
  for (const [k, ws] of byPair) {
    if (ws.executions < minExec || ws.queue.length === 0) continue;
    const a = Math.floor(k / rc);
    const r = k % rc;
    const act = byActivity.get(a)!;
    const activityMedian = median(act.queue);
    const med = median(ws.queue);
    const slowdown = activityMedian > 0 ? med / activityMedian : med > 0 ? Infinity : 1;
    if (slowdown < minSlowdown) continue;
    const norm = { queue: pct(peers(act.queue, act.queueBy, r)), calendar: pct(peers(act.calendar, act.calendarBy, r)) };
    // As for transitions, each wait counts up to this person's own 95th percentile, so a few stuck cases can't dominate.
    const cap = ws.queue.length >= MIN_FOR_STUCK ? quantileSorted([...ws.queue].sort((x, y) => x - y), STUCK_PERCENTILE) : Infinity;
    let excess = 0;
    for (const q of ws.queue) excess += Math.max(0, Math.min(q, cap) - norm.queue);
    let flatCost = 0;
    let capitalCost = 0;
    let consequenceCost = 0;
    ws.calendar.forEach((w, i) => {
      const days = Math.max(0, w - norm.calendar) / DAY_MS;
      flatCost += days * cost.delayCostPerCaseDay;
      capitalCost += days * ws.capitalPerDay[i]!;
      consequenceCost += ws.consequence[i]!;
    });
    const activity = log.activities[a]!;
    const resource = log.resources[r]!;
    out.push({
      id: `resource:${activity}@${resource}`,
      activity,
      resource,
      executions: ws.executions,
      medianWaitHours: med / HOUR_MS,
      activityMedianWaitHours: activityMedian / HOUR_MS,
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
