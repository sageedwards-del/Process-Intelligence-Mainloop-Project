import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { MODELS, checkRateLimit, recordUsage, structured, tally } from "./claude";
import type { GroundingIssue } from "./grounding";
import { describeIssues, indexMetrics, publicIssues } from "./grounding";
import type { MetricBundle } from "./metrics";
import { FindingsSchema, citedMetrics, groundFinding, type Finding } from "./outputs";
import { ANALYST_RULES, renderBundle, renderContext } from "./prompts";
import { writeOutput } from "./store";
import type { Target } from "./target";

export interface FindingsOutput {
  findings: Finding[];
  /** Findings the grounding check rejected: why, never their text. */
  dropped: { issues: GroundingIssue[] }[];
  /** What failed on the first attempt and was sent back to be rewritten. */
  rewritten: GroundingIssue[];
  /** The metrics the findings cite, so the page can show each citation's figures and formula. */
  metrics: MetricBundle;
  currency: string;
  attempts: number;
}

const MIN = 3;
const MAX = 5;

const TASK = `Write ${MIN} to ${MAX} findings for the manager, most money or risk first. Draw on what the data supports among: bottlenecks (with where the wait goes: queue, off-hours, batch, planned), batch steps, rework, cost to serve, rule violations and root-cause segments for slow cases. One finding per distinct issue; don't repeat a figure across findings. For each: a short title without figures; a body of two to four sentences with every figure cited; likely causes as hypotheses; your confidence (high when the figures are large and the sample big, low when it rests on a small segment or an assumption); and what to check next on site.`;

/** Asks Claude for findings, grounds each, retries once for the ones that fail, and stores the rest. */
export async function generateFindings(target: Target): Promise<FindingsOutput> {
  await checkRateLimit(target);
  const { inputs, analysed } = await target.load();
  const { bundle, analysis } = analysed;
  const index = indexMetrics(bundle);
  const usage = tally(MODELS.findings);
  const prompt = `${renderContext({ name: target.name, costNote: target.costNote, context: inputs.context, currency: analysis.currency })}

Metrics:
${renderBundle(bundle, analysis.currency)}

${TASK}`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];

  const kept: Finding[] = [];
  let failed: { finding: Finding; issues: GroundingIssue[] }[] = [];
  let attempts = 0;
  let rewritten: GroundingIssue[] = [];
  try {
    for (attempts = 1; attempts <= 2; attempts++) {
      const { value, message } = await structured({ feature: "findings", system: ANALYST_RULES, messages, schema: FindingsSchema, effort: "high", usage });
      failed = [];
      for (const f of value.findings) {
        const issues = groundFinding(f, index);
        if (issues.length) failed.push({ finding: f, issues });
        else if (kept.length < MAX && !kept.some((k) => k.title === f.title)) kept.push(f);
      }
      if (kept.length >= MIN || !failed.length) break;
      if (attempts === 1) rewritten = publicIssues(failed.flatMap((f) => f.issues));
      // Regenerate only what failed, telling Claude exactly why.
      messages.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `These findings failed the grounding check and won't be shown:\n${failed
            .map((f) => `Finding "${f.finding.title}":\n${describeIssues(f.issues)}`)
            .join("\n")}\nRewrite them so every figure is copied from a metric cited in its sentence, or replace them with other findings. Return only the rewritten or new findings, at most ${MAX - kept.length}.`,
        },
      );
    }
  } finally {
    await recordUsage(target, "findings", usage);
  }

  const output: FindingsOutput = {
    findings: kept,
    dropped: failed.map((f) => ({ issues: publicIssues(f.issues) })),
    rewritten,
    metrics: citedMetrics(kept.flatMap((f) => [f.title, f.body, f.likelyCauses, ...f.checkNext]), bundle),
    currency: analysis.currency,
    attempts: Math.min(attempts, 2),
  };
  await writeOutput(target, "findings", {
    model: MODELS.findings,
    inputMetrics: bundle,
    output,
    grounding: { passed: kept.length, dropped: failed.length, attempts: output.attempts, rewritten, droppedIssues: output.dropped },
  });
  return output;
}
