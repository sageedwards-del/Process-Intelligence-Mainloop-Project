import { costModelFromSettings, parseAnalysisSettings, parseRule, type CostSettings, type RuleWithImpact } from "@throughline/engine";
import type { AnalysisInputs } from "./analysis/analyse";
import { describeCost, loadWorkspaceCost } from "./costSettings";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface DatasetRow {
  id: string;
  workspace_id: string;
  name: string;
  status: string;
  error: string | null;
  snapshot_path: string | null;
  analysis_settings: unknown;
}

/** Reads a dataset as the signed-in user; RLS returns nothing outside their workspaces. */
export async function loadDataset(supabase: Supabase, id: string): Promise<DatasetRow | null> {
  const { data } = await supabase
    .from("datasets")
    .select("id, workspace_id, name, status, error, snapshot_path, analysis_settings")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/**
 * What a dataset is analysed with: the workspace's cost settings, the
 * dataset's enabled rules and its wait classification settings. Shared by
 * the explorer page and the server's AI features, so both price alike.
 */
export async function loadDatasetInputs(
  supabase: Supabase,
  dataset: DatasetRow,
  userId: string,
): Promise<{ inputs: AnalysisInputs; rules: RuleWithImpact[]; costSettings: CostSettings; costNote: string; canEdit: boolean }> {
  const [{ settings }, { data: ruleRows }, { data: membership }] = await Promise.all([
    loadWorkspaceCost(supabase, dataset.workspace_id),
    supabase.from("rules").select("id, definition").eq("dataset_id", dataset.id).eq("enabled", true).order("created_at"),
    supabase.from("workspace_members").select("role").eq("workspace_id", dataset.workspace_id).eq("user_id", userId).maybeSingle(),
  ]);
  const rules = (ruleRows ?? []).map((r) => parseRule(r.definition, r.id)).filter((r): r is RuleWithImpact => r !== null);
  return {
    inputs: { cost: costModelFromSettings(settings, rules), rules, settings: parseAnalysisSettings(dataset.analysis_settings) },
    rules,
    costSettings: settings,
    costNote: `Priced with this workspace's cost settings: ${describeCost(settings)}.`,
    canEdit: membership !== null && membership.role !== "viewer",
  };
}
