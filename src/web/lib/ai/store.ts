import "server-only";
import type { Target } from "./target";

/**
 * Claude's outputs live in ai_outputs (RLS: members read, editors write),
 * keyed by (dataset, kind, filter_hash). For findings and the memo the hash
 * is the hash of everything they were computed from, so a change to the
 * snapshot, cost settings, rules or wait settings shows as "no findings yet".
 * The sample has no dataset row; its outputs are kept in memory instead.
 */

export type OutputKind = "findings" | "memo" | "answer";

const sampleOutputs = new Map<string, { output: unknown; createdAt: string }>();

export interface Stored<T> {
  output: T;
  createdAt: string;
  model: string;
}

export async function readOutput<T>(target: Target, kind: Exclude<OutputKind, "answer">): Promise<Stored<T> | null> {
  if (!target.datasetId) {
    const hit = sampleOutputs.get(kind);
    return hit ? { output: hit.output as T, createdAt: hit.createdAt, model: "" } : null;
  }
  const { data } = await target.supabase
    .from("ai_outputs")
    .select("output, created_at, model")
    .eq("dataset_id", target.datasetId)
    .eq("kind", kind)
    .eq("filter_hash", target.inputsHash)
    .maybeSingle();
  return data ? { output: data.output as T, createdAt: data.created_at, model: data.model } : null;
}

/** Saves (or replaces) an output; viewers can't write, so their outputs aren't kept. */
export async function writeOutput(
  target: Target,
  kind: OutputKind,
  row: { key?: string; model: string; inputMetrics: unknown; output: unknown; grounding: unknown },
): Promise<string> {
  const createdAt = new Date().toISOString();
  if (!target.datasetId) {
    if (kind !== "answer") sampleOutputs.set(kind, { output: row.output, createdAt });
    return createdAt;
  }
  if (!target.canEdit) return createdAt;
  const { error } = await target.supabase.from("ai_outputs").upsert(
    {
      dataset_id: target.datasetId,
      workspace_id: target.workspaceId,
      kind,
      filter_hash: row.key ?? target.inputsHash,
      model: row.model,
      input_metrics: row.inputMetrics,
      output: row.output,
      grounding: row.grounding,
      created_at: createdAt,
    },
    { onConflict: "dataset_id,kind,filter_hash" },
  );
  if (error) throw new Error(`Couldn't save the ${kind}: ${error.message}`);
  return createdAt;
}

/** The dataset's latest answers, newest first. */
export async function readAnswers<T>(target: Target, limit = 20): Promise<Stored<T>[]> {
  if (!target.datasetId) return [];
  const { data } = await target.supabase
    .from("ai_outputs")
    .select("output, created_at, model")
    .eq("dataset_id", target.datasetId)
    .eq("kind", "answer")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((d) => ({ output: d.output as T, createdAt: d.created_at, model: d.model }));
}
