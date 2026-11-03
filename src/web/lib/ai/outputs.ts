import { z } from "zod";
import { checkFields, citedIds, type GroundingIssue, type MetricIndex } from "./grounding";
import type { MetricBundle } from "./metrics";

/**
 * What Claude returns for insights and the memo, how each piece is grounded,
 * and how the memo's money is sized: by code, from rule, rework, labour and
 * capital totals only (ADR 0002), never from the model's arithmetic.
 */

export const ActionSchema = z.object({
  action: z.string().describe("What to change, as an instruction (\"Run payments twice a week\"). No figures."),
  evidence: z.string().describe("Why, in two or three sentences. Every figure followed by its [[metric id]] in the same sentence."),
  impact: z
    .string()
    .describe("What it would improve. Figures only when cited; money only from a cited metric that carries a cost. Never estimate a saving the metrics don't give."),
  firstSteps: z.array(z.string()).describe("Two or three concrete first steps."),
  verify: z.array(z.string()).describe("Assumptions to check on site with the people who do the work."),
  confidence: z.enum(["high", "medium", "low"]),
});
export const InsightsSchema = z.object({
  summary: z.string().describe("Two or three sentences on how the process runs: volume, the usual route, where time and cost go. Every figure cited."),
  actions: z.array(ActionSchema),
});
export type Action = z.infer<typeof ActionSchema>;
export type Insights = z.infer<typeof InsightsSchema>;

export const OpportunitySchema = z.object({
  title: z.string(),
  sizing: z.array(z.string()).describe("Metric IDs whose cost this opportunity reduces: rule:, rework:, labour: or capital:total only."),
  addressableShare: z.number().describe("The share of that cost a fix could plausibly remove, 0 to 1."),
  shareRationale: z.string().describe("Why that share; an assumption to validate."),
  evidence: z.string().describe("Where it shows in the data, with [[metric id]] citations (edges, resources, segments allowed here)."),
  approach: z.string().describe("The fix or automation, and roughly what it takes."),
  risks: z.string(),
});
export const MemoSchema = z.object({
  recommendation: z.enum(["go", "no-go"]),
  headline: z.string().describe("One sentence: the decision and why."),
  currentState: z.string(),
  opportunities: z.array(OpportunitySchema),
  rationale: z.string().describe("Why go or no-go, weighing the sized opportunities against effort and risk."),
  assumptions: z.array(z.string()).describe("Assumptions behind the figures to validate on site."),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;
export type Memo = z.infer<typeof MemoSchema>;

export function groundAction(a: Action, index: MetricIndex): GroundingIssue[] {
  const issues = checkFields({ action: a.action, evidence: a.evidence, impact: a.impact, firstSteps: a.firstSteps, verify: a.verify }, index);
  if (!citedIds(a.evidence).length) issues.push({ field: "evidence", message: "cites no metric" });
  return issues;
}

export function groundSummary(summary: string, index: MetricIndex): GroundingIssue[] {
  const issues = checkFields({ summary }, index);
  if (!citedIds(summary).length) issues.push({ field: "summary", message: "cites no metric" });
  return issues;
}

/** An opportunity's own checks; `used` collects sizing IDs across the memo to catch double counting. */
export function groundOpportunity(o: Opportunity, index: MetricIndex, used: Set<string>): GroundingIssue[] {
  const issues = checkFields({ title: o.title, shareRationale: o.shareRationale, evidence: o.evidence, approach: o.approach, risks: o.risks }, index);
  if (!o.sizing.length) issues.push({ field: "sizing", message: "names no metric to size it from" });
  if (!(o.addressableShare > 0 && o.addressableShare <= 1)) issues.push({ field: "addressableShare", message: `${o.addressableShare} isn't between 0 and 1` });
  for (const raw of o.sizing) {
    const id = raw.trim();
    const metric = index.get(id)?.[0];
    if (!metric) issues.push({ field: "sizing", message: `${id} isn't in the analysis` });
    else if (!metric.sizing) issues.push({ field: "sizing", message: `${id} can't size an opportunity: only rule, rework, labour and capital totals can (edge and resource costs are already inside them)` });
    const activity = id.replace(/^(labour|rework):/, "");
    const overlap = id.startsWith("labour:") ? `rework:${activity}` : id.startsWith("rework:") ? `labour:${activity}` : null;
    if (used.has(id)) issues.push({ field: "sizing", message: `${id} already sizes another opportunity` });
    else if (overlap && used.has(overlap)) issues.push({ field: "sizing", message: `${id} overlaps ${overlap} (repeats are part of cost to serve)` });
    used.add(id);
  }
  return issues;
}

export interface SizedOpportunity extends Opportunity {
  /** Σ annualCost of the sizing metrics. */
  annualBase: number;
  annualSaving: number;
  formula: string;
}

export function sizeOpportunity(o: Opportunity, bundle: MetricBundle, money: (n: number) => string): SizedOpportunity {
  const parts = o.sizing.map((id) => ({ id: id.trim(), annual: bundle[id.trim()]?.figures.annualCost?.value ?? 0 }));
  const annualBase = parts.reduce((s, p) => s + p.annual, 0);
  const annualSaving = annualBase * o.addressableShare;
  const base = parts.map((p) => `${money(p.annual)} a year (${p.id})`).join(" + ");
  return { ...o, annualBase, annualSaving, formula: `${parts.length > 1 ? `(${base})` : base} × ${Math.round(o.addressableShare * 100)}% addressable` };
}

/** The memo's own texts, apart from its opportunities. */
export function groundMemoText(m: Memo, index: MetricIndex): GroundingIssue[] {
  return checkFields({ headline: m.headline, currentState: m.currentState, rationale: m.rationale, assumptions: m.assumptions }, index);
}

/** The metrics a set of texts cites, for showing values next to the citations. */
export function citedMetrics(texts: string[], bundle: MetricBundle | MetricIndex): MetricBundle {
  const out: MetricBundle = {};
  for (const id of new Set(texts.flatMap(citedIds))) {
    const m = bundle instanceof Map ? bundle.get(id)?.[0] : bundle[id];
    if (m) out[id] = m;
  }
  return out;
}
