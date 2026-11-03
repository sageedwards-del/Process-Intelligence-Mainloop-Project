import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { MODELS, recordUsage, reserve, structured, tally } from "./claude";
import type { GroundingIssue } from "./grounding";
import { describeIssues, indexMetrics, publicIssues } from "./grounding";
import type { MetricBundle } from "./metrics";
import { InsightsSchema, citedMetrics, groundAction, groundSummary, type Action } from "./outputs";
import { ANALYST_RULES, renderBundle, renderContext } from "./prompts";
import { writeOutput } from "./store";
import type { Target } from "./target";

export interface InsightsOutput {
  /** How the process runs, or null when it failed the grounding check twice. */
  summary: string | null;
  actions: Action[];
  /** Pieces the grounding check rejected: why, never their text. */
  dropped: { issues: GroundingIssue[] }[];
  /** What failed on the first attempt and was sent back to be rewritten. */
  rewritten: GroundingIssue[];
  /** The metrics the output cites, so the page can show each citation's figures and formula. */
  metrics: MetricBundle;
  currency: string;
  attempts: number;
}

const MIN = 3;
const MAX = 5;

const TASK = `Write insights for the manager who owns this process. First a summary of two or three sentences: how many cases, the usual route, and where the time and cost go, every figure cited. Then ${MIN} to ${MAX} recommended actions, most money or risk first, drawn from what the data supports among: bottlenecks (with where the wait goes: queue, off-hours, batch, planned), batch steps, rework, cost to serve, rule violations and root-cause segments for slow cases. One action per distinct issue; don't repeat a figure across actions. For each: the action as an instruction without figures; the evidence, every figure cited; the expected impact, citing the metric whose time or cost it would reduce (never invent a saving); two or three first steps; what to verify on site; and your confidence (high when the figures are large and the sample big, low when it rests on a small segment or an assumption).`;

/** Asks Claude for a summary and actions, grounds each, retries once for what fails, and stores the rest. */
export async function generateInsights(target: Target): Promise<InsightsOutput> {
  const { inputs, analysed } = await target.load();
  const { bundle, analysis } = analysed;
  const index = indexMetrics(bundle);
  const usage = tally(MODELS.insights);
  const usageId = await reserve(target, "insights");
  const prompt = `${renderContext({ name: target.name, costNote: target.costNote, context: inputs.context, currency: analysis.currency })}

Metrics:
${renderBundle(bundle, analysis.currency)}

${TASK}`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];

  let summary: string | null = null;
  let summaryIssues: GroundingIssue[] = [];
  const kept: Action[] = [];
  let failed: { action: Action; issues: GroundingIssue[] }[] = [];
  let attempts = 0;
  let rewritten: GroundingIssue[] = [];
  try {
    for (attempts = 1; attempts <= 2; attempts++) {
      const { value, message } = await structured({ feature: "insights", system: ANALYST_RULES, messages, schema: InsightsSchema, effort: "high", usage });
      if (summary === null) {
        summaryIssues = groundSummary(value.summary, index);
        if (!summaryIssues.length) summary = value.summary;
      }
      failed = [];
      for (const a of value.actions) {
        const issues = groundAction(a, index);
        if (issues.length) failed.push({ action: a, issues });
        else if (kept.length < MAX && !kept.some((k) => k.action === a.action)) kept.push(a);
      }
      if ((kept.length >= MIN || !failed.length) && summary !== null) break;
      if (attempts === 1) rewritten = publicIssues([...summaryIssues, ...failed.flatMap((f) => f.issues)]);
      // Regenerate only what failed, telling Claude exactly why.
      const problems = [
        ...(summary === null ? [`The summary:\n${describeIssues(summaryIssues)}`] : []),
        ...failed.map((f) => `Action "${f.action.action}":\n${describeIssues(f.issues)}`),
      ];
      messages.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `These parts failed the grounding check and won't be shown:\n${problems.join("\n")}\nRewrite them so every figure is copied from a metric cited in its sentence${summary === null ? " (include the rewritten summary)" : " (repeat the summary unchanged)"}, or replace failed actions with other actions. Return at most ${MAX - kept.length} actions: only rewritten or new ones.`,
        },
      );
    }
  } finally {
    await recordUsage(target, usageId, usage);
  }

  const output: InsightsOutput = {
    summary,
    actions: kept,
    dropped: [...(summary === null ? [{ issues: publicIssues(summaryIssues) }] : []), ...failed.map((f) => ({ issues: publicIssues(f.issues) }))],
    rewritten,
    metrics: citedMetrics([summary ?? "", ...kept.flatMap((a) => [a.action, a.evidence, a.impact, ...a.firstSteps, ...a.verify])], bundle),
    currency: analysis.currency,
    attempts: Math.min(attempts, 2),
  };
  await writeOutput(target, "insights", {
    model: MODELS.insights,
    inputMetrics: bundle,
    output,
    grounding: { passed: kept.length, summary: summary !== null, dropped: output.dropped.length, attempts: output.attempts, rewritten, droppedIssues: output.dropped },
  });
  return output;
}
