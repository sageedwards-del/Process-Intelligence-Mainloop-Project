import type { Analysis, RootCauseView } from "../explorer/protocol";

/**
 * The metrics bundle Claude writes from: every figure the analysis produced,
 * keyed by the metric IDs in CLAUDE.md (`edge:A → B`, `resource:Activity@Name`,
 * `rework:Activity`, `labour:Activity`, `segment:…`, `batch:Activity@Resource`)
 * plus `rule:id`, `capital:total` and `overview`. The grounding check
 * (grounding.ts) accepts a number in Claude's text only if it matches a figure
 * of a metric cited next to it.
 */

/** How a figure may be written: money with a currency, a share as a percentage, hours also as days or minutes. */
export type Unit = "money" | "count" | "hours" | "days" | "minutes" | "share" | "ratio" | "number";

export interface Figure {
  value: number;
  unit: Unit;
}

/** Which money totals an opportunity may be sized from (ADR 0002): never edges or resources. */
export type SizingKind = "rule" | "rework" | "labour" | "capital";

export interface Metric {
  id: string;
  label: string;
  figures: Record<string, Figure>;
  /** How the money figure was computed, in words, as the explorer shows it. */
  formula?: string;
  /** Facts the model must respect, e.g. "a planned wait, not a delay". */
  note?: string;
  /** Set on metrics whose `cost` may size an opportunity. */
  sizing?: SizingKind;
  /** Activity, resource and rule names in the metric, so digits inside them aren't read as figures. */
  names: string[];
}

export type MetricBundle = Record<string, Metric>;

const HOURS_PER_DAY = 24;

/** Days the log covers, for annualising its costs (at least one). */
export function logSpanDays(a: Analysis): number {
  const { firstEvent, lastEvent } = a.summary;
  if (firstEvent === null || lastEvent === null) return 1;
  return Math.max(1, (lastEvent - firstEvent) / 86_400_000);
}

export function buildMetrics(a: Analysis, slow: RootCauseView | null): MetricBundle {
  const bundle: MetricBundle = {};
  const add = (m: Omit<Metric, "names"> & { names?: string[] }) => {
    bundle[m.id] = { ...m, names: m.names ?? namesInId(m.id) };
  };
  const span = logSpanDays(a);
  const perYear = 365 / span;
  const annual = (cost: number): Record<string, Figure> => ({ annualCost: { value: cost * perYear, unit: "money" } });
  const annualNote = `annualCost = cost × 365 ÷ ${span.toFixed(0)} days of log`;

  add({
    id: "overview",
    label: "The whole (filtered) log",
    figures: {
      cases: { value: a.summary.caseCount, unit: "count" },
      events: { value: a.summary.eventCount, unit: "count" },
      activities: { value: a.summary.activityCount, unit: "count" },
      variants: { value: a.summary.variantCount, unit: "count" },
      topVariantShare: { value: a.summary.topVariantShare, unit: "share" },
      medianThroughputDays: { value: a.summary.throughput.median / 86_400_000, unit: "days" },
      p90ThroughputDays: { value: a.summary.throughput.p90 / 86_400_000, unit: "days" },
      logSpanDays: { value: span, unit: "days" },
      costToServe: { value: a.costToServe.cost, unit: "money" },
      costToServePerCase: { value: a.costToServe.perCase, unit: "money" },
    },
    formula: a.costToServe.formula,
  });

  for (const e of a.edges) {
    const { queueHours, offHoursHours, batchHours, scheduledHours } = e.breakdown;
    add({
      id: e.id,
      label: `Wait from ${e.from} to ${e.to}`,
      figures: {
        frequency: { value: e.frequency, unit: "count" },
        medianWaitHours: { value: e.medianHours, unit: "hours" },
        queueHours: { value: queueHours, unit: "hours" },
        offHoursHours: { value: offHoursHours, unit: "hours" },
        batchHours: { value: batchHours, unit: "hours" },
        scheduledHours: { value: scheduledHours, unit: "hours" },
        automaticShare: { value: e.automaticShare, unit: "share" },
        stuckCases: { value: e.stuckCount, unit: "count" },
        cost: { value: e.cost, unit: "money" },
      },
      formula: e.formula,
      note:
        e.kind === "batch"
          ? "Mostly waiting for a batch run: the lever is how often the batch runs, not anyone's speed."
          : "Its cost is part of the rule and capital totals already (allocated by excess wait); never add it to them.",
    });
  }
  for (const p of a.planned) {
    add({
      id: p.id,
      label: `Wait from ${p.from} to ${p.to} (planned date)`,
      figures: { frequency: { value: p.frequency, unit: "count" }, medianWaitHours: { value: p.medianHours, unit: "hours" } },
      note: "Waiting until a planned date (an appointment, a due date). Not a delay and never priced.",
    });
  }
  for (const r of a.resources) {
    add({
      id: r.id,
      label: `${r.resource} on ${r.activity}`,
      figures: {
        executions: { value: r.executions, unit: "count" },
        slowdown: { value: r.slowdown, unit: "ratio" },
        medianWaitHours: { value: r.medianHours, unit: "hours" },
        peerMedianWaitHours: { value: r.peerHours, unit: "hours" },
        cost: { value: r.cost, unit: "money" },
      },
      formula: r.formula,
      note: "A slower queue before this person; the log shows where cases wait, not why (workload, availability, case mix). Its cost is part of the rule and capital totals.",
    });
  }
  for (const r of a.rework) {
    add({
      id: r.id,
      label: `Repeats of ${r.activity}`,
      figures: {
        repeats: { value: r.repeats, unit: "count" },
        shareOfCases: { value: r.share, unit: "share" },
        cost: { value: r.cost, unit: "money" },
        ...annual(r.cost),
      },
      formula: `${r.formula}; ${annualNote}`,
      note: "A repeated step is not always rework (partial deliveries, instalments, several items per case). Part of cost to serve.",
      sizing: "rework",
    });
  }
  for (const c of a.costToServe.activities) {
    add({
      id: c.id,
      label: `Hands-on labour for ${c.activity}`,
      figures: {
        executions: { value: c.executions, unit: "count" },
        cost: { value: c.cost, unit: "money" },
        ...annual(c.cost),
      },
      formula: `${c.formula}; ${annualNote}`,
      note: "Baseline cost to serve; includes any repeats of the step (rework:… is a part of it, not extra).",
      sizing: "labour",
    });
  }
  for (const b of a.batches) {
    add({
      id: b.id,
      label: `${b.activity} run in batches${b.resource ? ` by ${b.resource}` : ""}`,
      figures: {
        runs: { value: b.runs, unit: "count" },
        events: { value: b.events, unit: "count" },
        casesPerRun: { value: b.casesPerRun, unit: "count" },
        runsPerWeek: { value: b.runsPerWeek, unit: "count" },
        medianWaitHours: { value: b.medianWaitHours, unit: "hours" },
      },
      note: "A batch step: waits before it are for the next run, not a person's delay.",
    });
  }
  for (const r of a.rules) {
    add({
      id: `rule:${r.id}`,
      names: [r.id, r.name],
      label: `Rule "${r.name}" (${r.type})`,
      figures: {
        casesChecked: { value: r.casesChecked, unit: "count" },
        violations: { value: r.violations, unit: "count" },
        violationRate: { value: r.rate, unit: "share" },
        cost: { value: r.cost, unit: "money" },
        ...annual(r.cost),
      },
      formula: `${r.formula}; ${annualNote}`,
      sizing: "rule",
    });
  }
  if (a.capital) {
    add({
      id: "capital:total",
      label: "Working capital tied up by excess queue time",
      figures: { cost: { value: a.capital.cost, unit: "money" }, ...annual(a.capital.cost) },
      formula: `${a.capital.formula}; ${annualNote}`,
      sizing: "capital",
    });
  }
  if (slow) {
    for (const f of slow.factors) {
      add({
        id: f.id,
        label: `Cases with ${f.attribute} = ${f.value}, among ${slow.outcomeLabel}`,
        figures: {
          cases: { value: f.cases, unit: "count" },
          outcomeCases: { value: f.outcomeCases, unit: "count" },
          rate: { value: f.rate, unit: "share" },
          restRate: { value: f.restRate, unit: "share" },
          lift: { value: f.lift, unit: "ratio" },
          excessCases: { value: f.excessCases, unit: "count" },
        },
        note: `Correlated with ${slow.outcomeLabel}, not proven to cause it${f.smallSample ? "; small sample" : ""}${f.significant ? "" : "; not statistically significant (|z| < 3)"}.`,
      });
    }
  }
  return bundle;
}

/** Hours figures may be quoted in days or minutes too. */
/** "edge:A → B" → [A, B]; "resource:Activity@Name" → [Activity, Name]; "segment:amount=[1000, 5000)" → [amount, [1000, 5000)]. */
export function namesInId(scopedId: string): string[] {
  const id = scopedId.split(" | ")[0]!;
  const colon = id.indexOf(":");
  if (colon < 0) return [];
  const kind = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  if (kind === "edge") return rest.split(" → ");
  if (kind === "resource" || kind === "batch") {
    const at = rest.lastIndexOf("@");
    return at < 0 ? [rest] : [rest.slice(0, at), rest.slice(at + 1)];
  }
  if (kind === "segment") {
    const eq = rest.indexOf("=");
    const attribute = rest.slice(0, eq).replace(/^(passes|resource@):?/, "");
    return [attribute, rest.slice(eq + 1)];
  }
  return [rest];
}

export const unitConversions: Record<Unit, number[]> = {
  money: [1],
  count: [1],
  hours: [1, 1 / HOURS_PER_DAY, 60],
  days: [1, HOURS_PER_DAY],
  minutes: [1, 1 / 60],
  share: [100],
  ratio: [1],
  /** A case attribute of unknown unit (an amount, a quantity): matches money or a plain number. */
  number: [1],
};
