import type { WaitContext } from "@throughline/engine";
import type { Figure, Metric, MetricBundle } from "./metrics";

/**
 * What Claude is told. The rules here mirror what the grounding check
 * enforces in code, plus the caveats the engine can't check: which repeats
 * are rework, that root causes are correlations, and which waits aren't delays.
 */

export const GROUNDING_RULES = `How to cite (a program checks this; text that fails is thrown away):
- Write a citation as [[metric id]], copying the ID exactly from the metrics list, e.g. [[edge:Register Invoice → Match to Engagement]].
- Every figure you write (money, counts, hours, days, percentages, ratios) must be one of the figures listed for a metric that you cite in the same sentence. Rounding is fine (€13.5k for €13,519.61, 4.8× for 4.82×, 23 hours for 22.9 h, 3.2 days for 77 h). Shares are listed as percentages; quote them as percentages.
- Never compute a figure yourself: no sums, differences, ratios, per-case or per-year conversions. If a figure you want isn't listed, describe it in words ("most", "a minority") instead of a number.
- Small counts up to 10, dates and clock times need no citation. Titles carry no figures.`;

export const ANALYST_RULES = `You are a process analyst writing for an operations or finance manager at a mid-sized professional-services firm, not a process-mining expert. Plain words, short sentences, business impact first. You work only from the metrics the engine computed for this event log.

What the numbers mean, and limits you must respect:
- An event log shows where cases wait, not why. Causes are hypotheses for the team to check on site, never facts.
- Waiting is priced only through its consequences: time rules that break (missed discounts, late fees) and, where set, working capital. An edge's or a person's cost is their share of those rule and capital totals, allocated by excess wait. Never add an edge or resource cost to a rule cost or to each other; that counts the same money twice.
- Only queue time beyond a step's usual wait counts as excess. Waits for a batch run (a payment run, a nightly job), automatic steps, nights and weekends, and waits until a planned date (an appointment, a due date) are not delays. Don't call them bottlenecks and don't pin them on people; for batch steps the lever is how often the batch runs.
- A repeated step is not always rework: partial deliveries and invoices in purchase-to-pay, instalments, several items in one case. When you discuss repeats, say what would make them rework and list it as something to check.
- Root-cause segments are correlations: write "more common among", "correlated with", never "caused by" or "because of". Note small samples and segments that aren't significant. Two attributes with identical figures (e.g. one partner per practice area) can't be told apart from the log.
- Every cost rests on the cost settings shown (hourly rate, handling minutes per step, the cost of a rule violation). Say so when a conclusion depends on one.
- A slow queue at a named person can be workload, absence, a harder case mix or a role nobody else covers. Be factual and fair; never blame.

${GROUNDING_RULES}`;

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

function figure(f: Figure, currency: string): string {
  switch (f.unit) {
    case "money":
      return money(f.value, currency);
    case "share":
      return `${+(f.value * 100).toFixed(1)}%`;
    case "ratio":
      return `${+f.value.toFixed(2)}×`;
    case "hours":
      return `${+f.value.toFixed(1)} h`;
    case "days":
      return `${+f.value.toFixed(1)} d`;
    case "minutes":
      return `${+f.value.toFixed(1)} min`;
    default:
      return Number.isInteger(f.value) ? f.value.toLocaleString("en") : `${+f.value.toFixed(2)}`;
  }
}

/** One metric per line: ID, what it is, its figures, how the money was computed, and caveats. */
export function renderMetric(m: Metric, currency: string): string {
  const figures = Object.entries(m.figures)
    .map(([k, f]) => `${k}=${figure(f, currency)}`)
    .join(", ");
  return [`[[${m.id}]] ${m.label}: ${figures}`, m.formula ? `  formula: ${m.formula}` : "", m.note ? `  note: ${m.note}` : "", m.sizing ? `  can size an opportunity (${m.sizing})` : ""]
    .filter(Boolean)
    .join("\n");
}

export function renderBundle(bundle: MetricBundle, currency: string): string {
  return Object.values(bundle)
    .map((m) => renderMetric(m, currency))
    .join("\n");
}

/** The dataset, its cost settings and how its waits were classified. */
export function renderContext(opts: { name: string; costNote: string; context?: WaitContext; currency: string }): string {
  const c = opts.context;
  const lines = [`Dataset: ${opts.name}`, `Currency: ${opts.currency}`, opts.costNote];
  if (c) {
    const days = c.calendar.workDays.map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d - 1]).join(", ");
    lines.push(`Working hours (${c.calendarSource}): ${days}, ${c.calendar.startHour}:00–${c.calendar.endHour}:00; queue waits are measured in these hours.`);
    if (c.scheduled.length) lines.push(`Planned-date steps (waits before them aren't delays): ${c.scheduled.map((s) => s.activity).join(", ")}.`);
    if (c.systemResources.length) lines.push(`Systems and batch resources (not people): ${c.systemResources.map((s) => s.resource).join(", ")}.`);
  }
  return lines.join("\n");
}
