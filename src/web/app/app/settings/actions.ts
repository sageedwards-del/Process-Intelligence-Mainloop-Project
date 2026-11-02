"use server";

import { parseCostSettings } from "@throughline/engine";
import { createClient } from "@/lib/supabase/server";

export type SaveState = { status: "idle" } | { status: "saved" } | { status: "error"; errors: string[] };

/** Saves the workspace's default cost settings. RLS allows owners and analysts only. */
export async function saveCostSettings(_prev: SaveState, form: FormData): Promise<SaveState> {
  const workspaceId = String(form.get("workspaceId") ?? "");
  const capitalOn = form.get("capitalOn") === "on";
  const parsed = parseCostSettings({
    currency: form.get("currency"),
    hourlyRate: form.get("hourlyRate"),
    delayCostPerCaseDay: form.get("delayCostPerCaseDay"),
    defaultHandlingMinutes: form.get("defaultHandlingMinutes"),
    // The form asks for a percentage; the engine stores a fraction.
    capitalCost: capitalOn
      ? { attribute: form.get("capitalAttribute"), annualRate: Number(form.get("capitalRatePct")) / 100 }
      : undefined,
  });
  if (!parsed.ok) return { status: "error", errors: parsed.errors };
  if (capitalOn && !parsed.settings.capitalCost) return { status: "error", errors: ["Name the attribute that holds the money at stake."] };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) return { status: "error", errors: ["Your session has expired. Sign in again."] };

  const { data: existing } = await supabase
    .from("cost_models")
    .select("id")
    .eq("workspace_id", workspaceId)
    .is("dataset_id", null)
    .maybeSingle();
  const { error } = existing
    ? await supabase.from("cost_models").update({ model: parsed.settings }).eq("id", existing.id).select("id").single()
    : await supabase.from("cost_models").insert({ workspace_id: workspaceId, model: parsed.settings }).select("id").single();
  // An update blocked by RLS matches no row, so .single() reports it as an error too.
  if (error) return { status: "error", errors: ["Couldn't save: you may not have permission to edit this workspace."] };
  return { status: "saved" };
}
