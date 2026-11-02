import { z } from "zod";
import { checkFields, citedIds, type GroundingIssue, type MetricIndex } from "./grounding";
import type { MetricBundle } from "./metrics";

/**
 * What Claude returns for findings and the memo, how each piece is grounded,
 * and how the memo's money is sized: by code, from rule, rework, labour and
 * capital totals only (ADR 0002), never from the model's arithmetic.
 */

export const FindingSchema = z.object({
  title: z.string().describe("A short headline without figures."),
  body: z.string().describe("Two to four sentences. Every figure followed by its [[metric id]] in the same sentence."),
  likelyCauses: z.string().describe("What might explain it, as hypotheses to check: the log shows where, not why."),
  confidence: z.enum(["high", "medium", "low"]),
  checkNext: z.array(z.string()).describe("Assumptions to validate on site with the people who do the work."),
});
export const FindingsSchema = z.object({ findings: z.array(FindingSchema) });
export type Finding = z.infer<typeof FindingSchema>;

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

export function groundFinding(f: Finding, index: MetricIndex): GroundingIssue[] {
  const issues = checkFields({ title: f.title, body: f.body, likelyCauses: f.likelyCauses, checkNext: f.checkNext }, index);
  if (!citedIds(f.body).length) issues.push({ field: "body", message: "cites no metric" });
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
