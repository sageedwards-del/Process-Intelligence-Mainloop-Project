import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { formatMoney } from "@/components/explorer/format";
import { MODELS, recordUsage, reserve, structured, tally } from "./claude";
import { describeIssues, indexMetrics, publicIssues, type GroundingIssue } from "./grounding";
import { logSpanDays, type MetricBundle } from "./metrics";
import { MemoSchema, citedMetrics, groundMemoText, groundOpportunity, sizeOpportunity, type Memo, type SizedOpportunity } from "./outputs";
import { ANALYST_RULES, renderBundle, renderContext } from "./prompts";
import { writeOutput } from "./store";
import { TargetError, type Target } from "./target";

export interface MemoOutput extends Omit<Memo, "opportunities"> {
  opportunities: SizedOpportunity[];
  /** Σ annual savings of the opportunities that passed, computed here, never by the model. */
  total: number;
  totalFormula: string;
  /** Opportunities the grounding check rejected: why, never their text. */
  dropped: { issues: GroundingIssue[] }[];
  /** What failed on the first attempt and was sent back to be rewritten. */
  rewritten: GroundingIssue[];
  metrics: MetricBundle;
  currency: string;
  logSpanDays: number;
  attempts: number;
}

const TASK = `Write the opportunity memo: the forward-deployed engineer's go / no-go for automating or fixing this process.
- currentState: how the process runs today and what it costs to serve, in three to five sentences.
- opportunities: the top one to three, ranked by annual money. Size each only from metrics marked "can size an opportunity" (rule:, rework:, labour:, capital:total), listing their IDs in sizing, and never one metric in two opportunities or a rework metric alongside the labour metric of the same step (repeats are part of cost to serve). Use edges, resources and segments as evidence only. Give the share of that annual cost a fix could plausibly remove (addressableShare, 0 to 1) and why, the fix or automation, and its risks. Don't write the saving itself; the app computes annualCost × share and shows the formula.
- recommendation: "go" if at least one opportunity is clearly worth a prototype, "no-go" if the money at stake is small next to the effort or the evidence is thin. "No-go" is a valid, useful answer.
- headline: the decision and its main reason, in one sentence.
- rationale: why, weighing money, effort, risk and how solid the evidence is.
- assumptions: what to validate on site before relying on the figures (handling minutes, violation costs, which repeats are rework, why a queue is slow).`;

/** Asks Claude for the memo, grounds it, retries once with the failures, sizes it in code and stores it. */
export async function generateMemo(target: Target): Promise<MemoOutput> {
  const { inputs, analysed } = await target.load();
  const { bundle, analysis } = analysed;
  const index = indexMetrics(bundle);
  const money = (n: number) => formatMoney(n, analysis.currency);
  const usage = tally(MODELS.memo);
  const usageId = await reserve(target, "memo");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `${renderContext({ name: target.name, costNote: target.costNote, context: inputs.context, currency: analysis.currency })}

Metrics:
${renderBundle(bundle, analysis.currency)}

${TASK}`,
    },
  ];

  let memo: Memo | null = null;
  let kept: SizedOpportunity[] = [];
  let dropped: { issues: GroundingIssue[] }[] = [];
  let attempts = 0;
  let rewritten: GroundingIssue[] = [];
  try {
    for (attempts = 1; attempts <= 2; attempts++) {
      const { value, message } = await structured({ feature: "memo", system: ANALYST_RULES, messages, schema: MemoSchema, effort: "high", usage });
      const textIssues = groundMemoText(value, index);
      const used = new Set<string>();
      const checked = value.opportunities.map((o) => ({ o, issues: groundOpportunity(o, index, used) }));
      const passing = checked.filter((c) => !c.issues.length);
      if (!textIssues.length) {
        memo = value;
        kept = passing.map((c) => sizeOpportunity(c.o, bundle, money));
        dropped = checked.filter((c) => c.issues.length).map((c) => ({ issues: publicIssues(c.issues) }));
      }
      const failures = [...textIssues, ...checked.flatMap((c) => c.issues.map((i) => ({ ...i, field: `opportunity "${c.o.title}" ${i.field}` })))];
      if (!failures.length || (memo && passing.length) || attempts === 2) break;
      rewritten = publicIssues(failures);
      messages.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `The memo failed the grounding check:\n${describeIssues(failures)}\nReturn the whole memo again with these fixed: every figure copied from a metric cited in its sentence, and opportunities sized only as described.`,
        },
      );
    }
  } finally {
    await recordUsage(target, usageId, usage);
  }
  if (!memo) throw new TargetError(502, "Claude's memo didn't pass the grounding check twice, so it isn't shown. Try again.");

  const total = kept.reduce((s, o) => s + o.annualSaving, 0);
  const output: MemoOutput = {
    ...memo,
    opportunities: kept,
    total,
    totalFormula: kept.length ? kept.map((o) => money(o.annualSaving)).join(" + ") : "no sized opportunities",
    dropped,
    rewritten,
    metrics: citedMetrics([memo.headline, memo.currentState, memo.rationale, ...memo.assumptions, ...kept.flatMap((o) => [o.title, o.evidence, o.shareRationale, o.approach, o.risks, ...o.sizing.map((id) => `[[${id}]]`)])], bundle),
    currency: analysis.currency,
    logSpanDays: logSpanDays(analysis),
    attempts: Math.min(attempts, 2),
  };
  await writeOutput(target, "memo", {
    model: MODELS.memo,
    inputMetrics: bundle,
    output,
    grounding: { passed: kept.length, dropped: dropped.length, attempts: output.attempts, rewritten, droppedIssues: dropped },
  });
  return output;
}
