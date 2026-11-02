"use server";

import { INVOICE_RULES, MERIDIAN_COST_MODEL } from "@throughline/datagen";
import { parseAnalysisSettings } from "@throughline/engine";
import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Copies the Meridian sample's four rules (with the cost of one violation)
 * onto a dataset, so an uploaded copy of the sample export can be checked.
 * Activities are matched by name; rules naming activities the log lacks find nothing.
 */
export async function addSampleRules(datasetId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: dataset } = await supabase.from("datasets").select("id, workspace_id").eq("id", datasetId).maybeSingle();
  if (!dataset) return { error: "Dataset not found." };
  const impacts: Record<string, unknown> = MERIDIAN_COST_MODEL.ruleImpacts;
  const { error } = await supabase.from("rules").insert(
    INVOICE_RULES.map((rule) => ({
      dataset_id: dataset.id,
      workspace_id: dataset.workspace_id,
      definition: { ...rule, impact: impacts[rule.id] },
    })),
  );
  if (error) return { error: "Couldn't add the rules: you may not have permission to edit this workspace." };
  refresh();
  return {};
}

/**
 * Saves how a dataset's waits are classified (planned-date steps, systems,
 * usual-wait percentile). Parsed before saving; RLS lets editors only.
 */
export async function saveAnalysisSettings(datasetId: string, input: unknown): Promise<{ error?: string }> {
  const settings = parseAnalysisSettings(input);
  const supabase = await createClient();
  const { error } = await supabase.from("datasets").update({ analysis_settings: settings }).eq("id", datasetId).select("id").single();
  // An update blocked by RLS matches no row, so .single() reports it as an error too.
  if (error) return { error: "Couldn't save: you may not have permission to edit this workspace." };
  refresh();
  return {};
}
