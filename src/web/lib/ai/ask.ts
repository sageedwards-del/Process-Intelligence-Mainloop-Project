import "server-only";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { caseTimeline, computeVariants, filterLog, type CaseFilter, type EventLog } from "@throughline/engine";
import { z } from "zod";
import { analyse, rootCause } from "../analysis/analyse";
import type { Outcome } from "../explorer/protocol";
import { FALLBACK, MODELS, addUsage, assertUsable, claude, recordUsage, reserve, tally, textOf } from "./claude";
import { checkText, describeIssues, indexMetrics, publicIssues, type GroundingIssue, type MetricIndex } from "./grounding";
import { buildMetrics, type Metric, type MetricBundle } from "./metrics";
import { citedMetrics } from "./outputs";
import { ANALYST_RULES, renderContext, renderMetric } from "./prompts";
import { writeOutput } from "./store";
import type { Loaded, Target } from "./target";

/**
 * "Ask your process": a tool-use loop where Claude answers a question by
 * calling the engine on this dataset (already loaded under the user's RLS).
 * Every metric a tool returns joins the answer's index, and the final answer
 * passes the same grounding check as insights before anyone sees it.
 */

export interface AskAnswer {
  question: string;
  /** Null when the answer failed the grounding check twice. */
  answer: string | null;
  issues: GroundingIssue[];
  tools: { name: string; input: unknown; summary: string }[];
  metrics: MetricBundle;
  currency: string;
  createdAt: string;
}

export type AskEvent = { type: "tool"; name: string; input: unknown; summary: string } | { type: "answer"; answer: AskAnswer } | { type: "error"; message: string };

const MAX_TURNS = 8;

const FilterSchema = z.union([
  z.object({ kind: z.literal("attribute"), key: z.string(), values: z.array(z.union([z.string(), z.number(), z.boolean()])), exclude: z.boolean().optional() }),
  z.object({ kind: z.literal("activity"), activity: z.string(), mode: z.enum(["includes", "excludes"]) }),
  z.object({ kind: z.literal("throughput"), minDays: z.number().optional(), maxDays: z.number().optional() }),
  z.object({ kind: z.literal("range"), key: z.string(), min: z.number().optional(), max: z.number().optional() }),
]);
const FiltersInput = z.object({ filters: z.array(FilterSchema).optional() });

const filtersProperty = {
  filters: {
    type: "array",
    description:
      'Optional. Cases to keep, all conditions combined: {"kind":"attribute","key":"vendor","values":["Acme"]}, {"kind":"activity","activity":"Request Credit Note","mode":"includes"}, {"kind":"throughput","minDays":10}, {"kind":"range","key":"amount","min":10000} for a numeric case attribute (min inclusive, max exclusive). Attribute keys and activity names as get_overview lists them.',
    items: { type: "object" },
  },
} as const;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_overview",
    description: "Case and event counts, throughput, cost to serve, the most common variants, and the case attributes and activities you can filter on.",
    input_schema: { type: "object", properties: { ...filtersProperty } },
  },
  {
    name: "get_bottlenecks",
    description: "Priced waits between steps (with queue / off-hours / batch / planned breakdown), slower people, batch steps, planned-date waits, rework and labour per step.",
    input_schema: { type: "object", properties: { ...filtersProperty } },
  },
  {
    name: "check_rules",
    description: "Business-rule violations: counts, rates, cost with formula, and example case IDs.",
    input_schema: { type: "object", properties: { ...filtersProperty } },
  },
  {
    name: "find_root_causes",
    description: "Case segments (attributes, who did a step, passing through a step) correlated with an outcome: slow cases, passing through an activity, or violating a rule. Correlation only.",
    input_schema: {
      type: "object",
      properties: {
        outcome: { type: "string", enum: ["slow", "activity", "rule"] },
        slowPercentile: { type: "number", description: "For slow: 0.75, 0.9 or 0.95. Default 0.9." },
        activity: { type: "string", description: "For activity: the activity name." },
        ruleId: { type: "string", description: "For rule: the rule ID (from check_rules)." },
        ...filtersProperty,
      },
      required: ["outcome"],
    },
  },
  {
    name: "get_case",
    description: "One case's attributes and events in order, with the wait before each.",
    input_schema: { type: "object", properties: { caseId: { type: "string" } }, required: ["caseId"] },
  },
];

const DAY = 86_400_000;

interface Scope {
  filters: CaseFilter[];
  /** "amount ≥ 10000; passes Director Approval": appended to metric IDs so each figure is tied to its filter. */
  label: string;
  /** Numbers in the filter (10000), as figures, so "invoices of 10,000 or more" can cite them. */
  figures: Metric["figures"];
}

function toScope(log: EventLog, input: unknown): Scope {
  const parsed = FiltersInput.safeParse(input);
  if (!parsed.success) throw new Error("filters weren't in the documented shape");
  const labels: string[] = [];
  const figures: Metric["figures"] = {};
  const filters = (parsed.data.filters ?? []).map((f, i): CaseFilter => {
    if (f.kind === "attribute") {
      labels.push(`${f.key} ${f.exclude ? "≠" : "="} ${f.values.join(" or ")}`);
      return f;
    }
    if (f.kind === "activity") {
      labels.push(`${f.mode === "includes" ? "passes" : "skips"} ${f.activity}`);
      return f;
    }
    const bound = (name: string, value: number | undefined, op: string, unit: string) => {
      if (value === undefined) return;
      labels.push(`${f.kind === "range" ? f.key : "duration"} ${op} ${value}${unit}`);
      figures[`filter${i + 1}${name}`] = { value, unit: f.kind === "range" ? "number" : "days" };
    };
    if (f.kind === "throughput") {
      bound("MinDays", f.minDays, "≥", " d");
      bound("MaxDays", f.maxDays, "≤", " d");
      return { kind: "throughput", minMs: f.minDays !== undefined ? f.minDays * DAY : undefined, maxMs: f.maxDays !== undefined ? f.maxDays * DAY : undefined };
    }
    bound("Min", f.min, "≥", "");
    bound("Max", f.max, "<", "");
    // The engine filters attributes by value; a numeric range becomes the list of cases inside it.
    const inRange = (v: unknown) => typeof v === "number" && (f.min === undefined || v >= f.min) && (f.max === undefined || v < f.max);
    return { kind: "cases", ids: log.cases.filter((c) => inRange(c.attrs[f.key])).map((c) => c.id) };
  });
  return { filters, label: labels.join("; "), figures };
}

/** Under a filter, a metric's ID carries the filter: `edge:A → B | amount ≥ 10000`. */
function scoped(metrics: Metric[], scope: Scope): Metric[] {
  if (!scope.label) return metrics;
  return metrics.map((m) => ({ ...m, id: `${m.id} | ${scope.label}`, label: `${m.label} (cases with ${scope.label})`, figures: { ...m.figures, ...scope.figures } }));
}

const pick = (bundle: MetricBundle, test: (id: string) => boolean): Metric[] => Object.values(bundle).filter((m) => test(m.id));

/** Runs one tool; returns the text Claude reads and the metrics it may cite. */
function runTool(target: Loaded, name: string, input: Record<string, unknown>): { text: string; metrics: MetricBundle; summary: string } {
  const currency = target.analysed.analysis.currency;
  const scope = name === "get_case" ? { filters: [], label: "", figures: {} } : toScope(target.log, input);
  const filters = scope.filters;
  const log = filters.length ? filterLog(target.log, filters) : target.log;
  const extent = filters.length ? `${log.cases.length.toLocaleString("en")} of ${target.log.cases.length.toLocaleString("en")} cases (${scope.label})` : "all cases";
  if (!log.cases.length) return { text: "No cases match these filters.", metrics: {}, summary: "no cases match" };
  const render = (ms: Metric[]) => ms.map((m) => renderMetric(m, currency)).join("\n");

  if (name === "get_case") {
    const id = String(input.caseId ?? "");
    const t = caseTimeline(target.log, id);
    if (!t) return { text: `No case with ID ${id}.`, metrics: {}, summary: `case ${id} not found` };
    const figures: Metric["figures"] = { throughputDays: { value: t.throughputMs / DAY, unit: "days" }, steps: { value: t.events.length, unit: "count" } };
    t.events.forEach((e, i) => (figures[`waitBeforeStep${i + 1}Hours`] = { value: e.waitMs / 3_600_000, unit: "hours" }));
    for (const [k, v] of Object.entries(t.attrs)) if (typeof v === "number") figures[k] = { value: v, unit: "number" };
    const metric: Metric = { id: `case:${id}`, label: `Case ${id}`, figures, names: [id, ...t.events.map((e) => e.activity), ...t.events.flatMap((e) => (e.resource ? [e.resource] : []))] };
    const events = t.events.map((e, i) => `${i + 1}. ${e.activity} at ${new Date(e.timestamp).toISOString()}${e.resource ? ` by ${e.resource}` : ""}`).join("\n");
    const attrs = Object.entries(t.attrs).map(([k, v]) => `${k}=${String(v)}`).join(", ");
    return { text: `${render([metric])}\nattributes: ${attrs}\nevents:\n${events}`, metrics: { [metric.id]: metric }, summary: `case ${id}: ${t.events.length} events` };
  }

  const analysis = analyse(log, target.inputs);
  if (name === "find_root_causes") {
    const outcome: Outcome =
      input.outcome === "activity"
        ? { kind: "activity", activity: String(input.activity ?? "") }
        : input.outcome === "rule"
          ? { kind: "rule", ruleId: String(input.ruleId ?? "") }
          : { kind: "slow", percentile: [0.75, 0.9, 0.95].includes(Number(input.slowPercentile)) ? Number(input.slowPercentile) : 0.9 };
    const view = rootCause(log, outcome, target.inputs);
    const metrics = scoped(pick(buildMetrics(analysis, view), (id) => id.startsWith("segment:")), scope);
    const head = `Outcome: ${view.outcomeLabel}; ${view.outcomeCases.toLocaleString("en")} of ${view.totalCases.toLocaleString("en")} cases (${extent}).`;
    return { text: `${head}\n${render(metrics) || "No segment stands out."}`, metrics: Object.fromEntries(metrics.map((m) => [m.id, m])), summary: `${metrics.length} segments for ${view.outcomeLabel}` };
  }

  const bundle = buildMetrics(analysis, null);
  let metrics: Metric[];
  let extra = "";
  if (name === "get_overview") {
    const variants: Metric[] = computeVariants(log)
      .slice(0, 6)
      .map((v, i) => ({
        id: `variant:${i + 1}`,
        label: `Variant ${i + 1}: ${v.activities.join(" → ")}`,
        figures: { cases: { value: v.count, unit: "count" }, share: { value: v.share, unit: "share" }, medianDays: { value: v.throughput.median / DAY, unit: "days" } },
        names: v.activities,
      }));
    metrics = [bundle.overview!, ...variants];
    const meta = target.log;
    extra = `\nActivities: ${meta.activities.join(", ")}\nCase attributes: ${[...new Set(meta.cases.slice(0, 200).flatMap((c) => Object.keys(c.attrs)))].join(", ")}\nRules: ${target.inputs.rules.map((r) => `${r.id} ("${r.name}")`).join(", ") || "none"}`;
  } else if (name === "get_bottlenecks") {
    metrics = pick(bundle, (id) => /^(edge|resource|batch|rework|labour|capital):/.test(id));
  } else if (name === "check_rules") {
    metrics = pick(bundle, (id) => id.startsWith("rule:"));
    extra = analysis.rules.map((r) => `\nrule:${r.id} example cases: ${r.examples.map((e) => `${e.caseId} (${e.detail})`).join("; ") || "none"}`).join("");
  } else {
    throw new Error(`unknown tool ${name}`);
  }
  metrics = scoped(metrics, scope);
  return {
    text: `Scope: ${extent}.\n${render(metrics)}${extra}`,
    metrics: Object.fromEntries(metrics.map((m) => [m.id, m])),
    summary: `${metrics.length} metrics, ${extent}`,
  };
}

/** Answers one question, yielding each tool call as it happens and then the grounded answer. */
export async function* ask(target: Target, question: string): AsyncGenerator<AskEvent> {
  const loaded = await target.load();
  const currency = loaded.analysed.analysis.currency;
  const usage = tally(MODELS.ask);
  const usageId = await reserve(target, "ask");
  const seen: MetricBundle[] = [];
  const tools: AskAnswer["tools"] = [];
  const system = `${ANALYST_RULES}

You answer one question about this dataset by calling the tools, then reply in a few short paragraphs (no headings). Cite only metrics a tool returned in this conversation, copying the whole ID: under a filter it ends in " | " and the filter (e.g. [[edge:A → B | amount ≥ 10000]]), and its figures hold only for those cases. If the data can't answer the question, say so plainly and suggest what would.

${renderContext({ name: target.name, costNote: target.costNote, context: loaded.inputs.context, currency })}`;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: question }];

  let answer: string | null = null;
  let issues: GroundingIssue[] = [];
  let retried = false;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const message = await claude().beta.messages.create({
        ...FALLBACK,
        model: MODELS.ask,
        max_tokens: 16_000,
        output_config: { effort: "medium" },
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        tools: TOOLS,
        messages,
      });
      addUsage(usage, message);
      assertUsable(message);
      messages.push({ role: "assistant", content: message.content });

      const calls = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (calls.length) {
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const call of calls) {
          try {
            const r = runTool(loaded, call.name, call.input as Record<string, unknown>);
            seen.push(r.metrics);
            tools.push({ name: call.name, input: call.input, summary: r.summary });
            yield { type: "tool", name: call.name, input: call.input, summary: r.summary };
            results.push({ type: "tool_result", tool_use_id: call.id, content: r.text });
          } catch (e) {
            results.push({ type: "tool_result", tool_use_id: call.id, content: `Error: ${e instanceof Error ? e.message : String(e)}`, is_error: true });
          }
        }
        messages.push({ role: "user", content: results });
        continue;
      }

      const text = textOf(message).trim();
      const index: MetricIndex = indexMetrics(...seen);
      issues = checkText(text, index, "answer");
      if (!issues.length) {
        answer = text;
        break;
      }
      if (retried) break;
      retried = true;
      messages.push({
        role: "user",
        content: `Your answer failed the grounding check and won't be shown:\n${describeIssues(issues)}\nRewrite it so every figure is copied from a metric a tool returned and cited in the same sentence. Call a tool if you need a figure you don't have.`,
      });
    }
  } finally {
    await recordUsage(target, usageId, usage);
  }

  const index = indexMetrics(...seen);
  const result: AskAnswer = {
    question,
    answer,
    issues: answer ? [] : issues.length ? publicIssues(issues) : [{ field: "answer", message: "no answer within the tool-call limit" }],
    tools,
    metrics: answer ? citedMetrics([answer], index) : {},
    currency,
    createdAt: new Date().toISOString(),
  };
  if (answer) {
    result.createdAt = await writeOutput(target, "answer", {
      key: randomUUID(),
      model: MODELS.ask,
      inputMetrics: Object.fromEntries([...index].map(([id, ms]) => [id, ms])),
      output: result,
      grounding: { passed: true, retried },
    });
  }
  yield { type: "answer", answer: result };
}
