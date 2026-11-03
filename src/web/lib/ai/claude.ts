import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { TargetError, type Target } from "./target";

/**
 * The one place the web app talks to Claude: server-side only, with the key
 * from the environment (ANTHROPIC_API_KEY), never sent to the browser.
 * Models per docs/build-plan.md: Sonnet for insights and Ask, Opus for the memo.
 */

export const MODELS = { insights: "claude-sonnet-5-5", ask: "claude-sonnet-5-5", memo: "claude-opus-5-5" } as const;
export type Feature = keyof typeof MODELS;

/** AI requests per user per hour, across features (read from ai_usage). */
const HOURLY_LIMIT = 30;

/** AI requests per 24 hours across all users: the demo's spend ceiling (env AI_DAILY_LIMIT). */
export function dailyLimit(): number {
  const n = Number(process.env.AI_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 300;
}

/**
 * If a safety classifier declines a request, the API re-runs it on the
 * recommended fallback model inside the same call (beta, Claude API only).
 */
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

let client: Anthropic | null = null;
export function claude(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new TargetError(503, "Claude isn't set up on this server (ANTHROPIC_API_KEY is missing), so insights, Ask and the memo are off.");
  }
  return (client ??= new Anthropic({ maxRetries: 2 }));
}

export interface UsageTally {
  model: string;
  input: number;
  output: number;
}

export function tally(model: string): UsageTally {
  return { model, input: 0, output: 0 };
}

export function addUsage(t: UsageTally, message: Anthropic.Beta.BetaMessage) {
  t.input += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0);
  t.output += message.usage.output_tokens;
}

/**
 * Reserves this request's ai_usage row before the first model call, or
 * refuses it. The database counts and inserts under one lock
 * (reserve_ai_request), so parallel requests at the limit can't all pass, and
 * a request killed mid-call still counts. Returns the row to finish.
 */
export async function reserve(target: Target, feature: Feature): Promise<number> {
  claude();
  const { data, error } = await target.supabase
    .rpc("reserve_ai_request", { p_workspace_id: target.workspaceId, p_feature: feature, p_model: MODELS[feature], p_hourly_limit: HOURLY_LIMIT, p_daily_limit: dailyLimit() })
    .single<{ id: number; status: "reserved" | "refused"; limit_hit: "hourly" | "daily" | null }>();
  // Fail closed: if usage can't be counted, Claude isn't called.
  if (error || !data) throw new TargetError(503, "Couldn't check the AI usage limit, so Claude wasn't called. Try again later.");
  if (data.limit_hit === "daily") throw new TargetError(429, "The demo's AI budget for today is used up; try again tomorrow.");
  if (data.status !== "reserved") throw new TargetError(429, `That's ${HOURLY_LIMIT} AI requests in the last hour, the limit for now. Try again later.`);
  return data.id;
}

/** Fills in the reserved row's token counts (RLS: users can't update ai_usage; the function only touches their own reserved row). */
export async function recordUsage(target: Target, usageId: number, t: UsageTally) {
  const { error } = await target.supabase.rpc("finish_ai_request", { p_id: usageId, p_input_tokens: t.input, p_output_tokens: t.output });
  // The row already counts toward the limits; a lost token count only affects reporting.
  if (error) console.error("finish_ai_request failed", error);
}

export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

/** Stop reasons that mean the reply can't be used. */
export function assertUsable(message: Anthropic.Beta.BetaMessage) {
  if (message.stop_reason === "refusal") throw new TargetError(502, "Claude declined to answer this request.");
  if (message.stop_reason === "max_tokens") throw new TargetError(502, "Claude's reply was cut off; try again.");
}

/**
 * A structured reply: Claude's JSON constrained to `schema` (structured
 * outputs), validated again here. Streams, so long memos don't time out.
 */
export async function structured<S extends z.ZodType>(opts: {
  feature: Feature;
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  schema: S;
  effort: "low" | "medium" | "high";
  usage: UsageTally;
}): Promise<{ value: z.infer<S>; message: Anthropic.Beta.BetaMessage }> {
  const stream = claude().beta.messages.stream({
    ...FALLBACK,
    model: MODELS[opts.feature],
    max_tokens: 32_000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: opts.messages,
    output_config: { effort: opts.effort, format: { type: "json_schema", schema: zodOutputFormat(opts.schema).schema } },
  });
  const message = await stream.finalMessage();
  addUsage(opts.usage, message);
  assertUsable(message);
  let json: unknown;
  try {
    json = JSON.parse(textOf(message));
  } catch {
    throw new TargetError(502, "Claude's reply wasn't valid JSON; try again.");
  }
  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) throw new TargetError(502, "Claude's reply didn't have the expected shape; try again.");
  return { value: parsed.data, message };
}
