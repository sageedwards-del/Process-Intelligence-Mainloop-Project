/// <reference lib="webworker" />
import {
  DEFAULT_COST_MODEL,
  analyzeBottlenecks,
  analyzeRootCauses,
  attributeOverview,
  buildLog,
  caseTimeline,
  computeDfg,
  computeVariants,
  evaluateRules,
  filterLog,
  slowCasesFilter,
  slowestCases,
  summarize,
  type CaseFilter,
  type CostModel,
  type EventLog,
  type Rule,
  type RuleImpact,
} from "@throughline/engine";
import { formatInt, formatMoney } from "@/components/explorer/format";
import { decodeSnapshot } from "../snapshot";
import { layoutMap } from "./layout";
import type { Analysis, FromWorker, LogMeta, LogSource, Outcome, RootCauseRow, RootCauseView, ToWorker } from "./protocol";

/**
 * Runs the engine off the main thread: loading and decoding the log, the
 * analysis of the filtered cases, the process map for each slider position,
 * root causes and single-case timelines.
 */
let log: EventLog | null = null;
let filtered: EventLog | null = null;
let cost: CostModel = DEFAULT_COST_MODEL;
let rules: Rule[] = [];

const post = (msg: FromWorker) => postMessage(msg);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function load(source: LogSource): Promise<{ log: EventLog; cost: CostModel | null; rules: Rule[] }> {
  if (source.kind === "snapshot") {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`Couldn't download the dataset (HTTP ${res.status}).`);
    return { log: await decodeSnapshot(await res.blob()), cost: null, rules: [] };
  }
  const { generateInvoiceLog, INVOICE_RULES, MERIDIAN_COST_MODEL } = await import("@throughline/datagen");
  return {
    log: buildLog(generateInvoiceLog({ cases: 5000, seed: 42 }).rows),
    cost: MERIDIAN_COST_MODEL,
    rules: INVOICE_RULES as unknown as Rule[],
  };
}

function meta(l: EventLog): LogMeta {
  const summary = summarize(l);
  return {
    totalCases: l.cases.length,
    firstEvent: summary.firstEvent,
    lastEvent: summary.lastEvent,
    activities: activitiesByFrequency(l),
    attributes: attributeOverview(l),
    rules: rules.map((r) => ({ id: r.id, name: r.name })),
  };
}

/** DFG nodes come sorted by frequency; START/END have negative ids. */
const activitiesByFrequency = (l: EventLog) =>
  computeDfg(l)
    .nodes.filter((n) => n.activity >= 0)
    .map((n) => l.activities[n.activity]!);

function analyse(l: EventLog): Analysis {
  const report = analyzeBottlenecks(l, cost, { rules });
  const money = (n: number) => formatMoney(n, cost.currency);
  const days = (hours: number) => formatInt(hours / 24);
  const timeRules = rules.filter((r) => cost.ruleImpacts?.[r.id]?.category === "time").map((r) => `"${r.name}"`);
  /** The formula behind a wait's price; `excessHours` is beyond `normal`. */
  const waitFormula = (excessHours: number, normal: string, p: { delayCost: number; capitalCost: number; consequenceCost: number }) => {
    const excess = `${days(excessHours)} case-days beyond ${normal}`;
    const parts = [
      cost.delayCostPerCaseDay > 0 ? `${money(p.delayCost - p.capitalCost - p.consequenceCost)} at ${money(cost.delayCostPerCaseDay)} per case-day` : "",
      p.capitalCost > 0
        ? `${money(p.capitalCost)} capital cost (${cost.capitalCost!.attribute} × ${(cost.capitalCost!.annualRate * 100).toFixed(1)}% ÷ 365 per day)`
        : "",
      p.consequenceCost > 0 ? `${money(p.consequenceCost)} of ${timeRules.join(", ")} losses, shared out by excess wait` : "",
    ].filter(Boolean);
    return parts.length ? `${excess}: ${parts.join(" + ")}` : `${excess}; no time cost set (add a time rule or a capital cost)`;
  };
  const labourRate = (minutes: number) => `${+minutes.toFixed(2)} min × ${money(cost.hourlyRate)} per hour`;

  return {
    // The dictionary is shared with the full log; count only activities the filtered cases contain.
    summary: { ...summarize(l), activityCount: activitiesByFrequency(l).length },
    currency: report.currency,
    variants: computeVariants(l)
      .slice(0, 12)
      .map((v) => ({ key: v.key, steps: v.activities.length, count: v.count, share: v.share, medianDays: v.throughput.median / DAY })),
    edges: report.edges.slice(0, 8).map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      frequency: e.frequency,
      medianHours: e.wait.median / HOUR,
      cost: e.delayCost,
      formula: waitFormula(e.excessWaitHours, e.targetSource === "median" ? "the median wait" : `the ${formatInt(e.targetHours)} h target`, e),
    })),
    // Resource excess is calendar time here, so it matches what the money is based on.
    resources: report.resources.slice(0, 6).map((r) => ({
      id: r.id,
      activity: r.activity,
      resource: r.resource,
      executions: r.executions,
      slowdown: r.slowdown,
      medianHours: r.medianWaitHours,
      peerHours: r.activityMedianWaitHours,
      cost: r.delayCost,
      formula: waitFormula(r.excessWaitHours, "the step's median wait", r),
    })),
    rework: report.rework.slice(0, 6).map((r) => ({
      id: r.id,
      activity: r.activity,
      repeats: r.repeatExecutions,
      share: r.shareOfCases,
      cost: r.handlingCost,
      formula: `${formatInt(r.repeatExecutions)} repeats × ${labourRate(cost.handlingMinutes[r.activity] ?? cost.defaultHandlingMinutes)}`,
    })),
    costToServe: {
      cost: report.costToServe.total,
      perCase: report.costToServe.perCase,
      formula: `Σ executions × handling minutes × ${money(cost.hourlyRate)} per hour, ${money(report.costToServe.perCase)} per case`,
      activities: report.costToServe.activities.slice(0, 6).map((a) => ({
        id: a.id,
        activity: a.activity,
        executions: a.executions,
        cost: a.cost,
        formula: `${formatInt(a.executions)} executions × ${labourRate(a.minutes)}`,
      })),
    },
    rules: evaluateRules(l, rules, cost).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      casesChecked: r.casesChecked,
      violations: r.violations.length,
      rate: r.violationRate,
      cost: r.cost,
      formula: impactFormula(r.violations.length, r.impact, money),
      caseIds: [...new Set(r.violations.map((v) => v.caseId))],
      examples: r.violations.slice(0, 5).map((v) => ({ caseId: v.caseId, detail: v.detail })),
    })),
    slowest: slowestCases(l, 10),
  };
}

function impactFormula(n: number, impact: RuleImpact | null, money: (n: number) => string): string {
  if (!impact) return "No cost assumption set for this rule";
  const parts = [
    impact.perViolation ? money(impact.perViolation) : "",
    impact.share ? `${+(impact.share.fraction * 100).toFixed(2)}% of ${impact.share.attribute}` : "",
  ].filter(Boolean);
  const each = parts.length > 1 ? `(${parts.join(" + ")})` : parts[0];
  return `${formatInt(n)} violations × ${each}, ${impact.category} cost`;
}

function outcomeFilters(l: EventLog, o: Outcome): { filters: CaseFilter[]; label: string } {
  if (o.kind === "slow") {
    const f = slowCasesFilter(l, o.percentile);
    const minMs = f.kind === "throughput" ? (f.minMs ?? 0) : 0;
    return { filters: [f], label: `the slowest ${Math.round((1 - o.percentile) * 100)}% (${(minMs / DAY).toFixed(1)} days or more end to end)` };
  }
  if (o.kind === "activity") return { filters: [{ kind: "activity", activity: o.activity, mode: "includes" }], label: `passes through ${o.activity}` };
  const rule = rules.find((r) => r.id === o.ruleId);
  const result = rule ? evaluateRules(l, [rule], cost)[0]! : null;
  return {
    filters: [{ kind: "cases", ids: result ? result.violations.map((v) => v.caseId) : [] }],
    label: `violates "${rule?.name ?? o.ruleId}"`,
  };
}

function rootCause(l: EventLog, o: Outcome): RootCauseView {
  const { filters, label } = outcomeFilters(l, o);
  // Who did each step is often the strongest signal; cap it so wide logs stay fast.
  const activities = activitiesByFrequency(l).slice(0, 12);
  const report = analyzeRootCauses(l, filters, { resourceActivities: activities });
  const categorical = new Set(attributeOverview(l, 0).filter((a) => a.type === "category").map((a) => a.key));
  const factors: RootCauseRow[] = report.factors
    .filter((f) => f.excessCases > 0)
    .slice(0, 15)
    .map((f) => {
      if (!categorical.has(f.attribute)) return f;
      const sample = l.cases.find((c) => String(c.attrs[f.attribute] ?? "(missing)") === f.value);
      const value = sample ? (sample.attrs[f.attribute] ?? null) : f.value;
      return { ...f, filter: { kind: "attribute", key: f.attribute, values: [value] } };
    });
  return { outcomeLabel: label, totalCases: report.totalCases, outcomeCases: report.outcomeCases, overallRate: report.overallRate, factors };
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      const loaded = await load(msg.source);
      log = filtered = loaded.log;
      cost = msg.cost ?? loaded.cost ?? DEFAULT_COST_MODEL;
      rules = msg.rules ?? loaded.rules;
      post({ type: "loaded", meta: meta(log) });
    } else if (!log || !filtered) {
      return;
    } else if (msg.type === "filter") {
      filtered = filterLog(log, msg.filters);
      post({ type: "analysis", analysis: analyse(filtered), seq: msg.seq });
    } else if (msg.type === "view") {
      const l = filtered;
      post({ type: "view", view: l.cases.length ? await layoutMap(l, msg.options) : null, seq: msg.seq });
    } else if (msg.type === "rootCause") {
      post({ type: "rootCause", report: rootCause(filtered, msg.outcome), seq: msg.seq });
    } else if (msg.type === "case") {
      post({ type: "case", timeline: caseTimeline(log, msg.id), id: msg.id });
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
