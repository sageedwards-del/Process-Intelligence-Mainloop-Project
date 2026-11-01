import { DEFAULT_COST_SETTINGS, parseCostSettings, type CostSettings } from "@throughline/engine";
import type { createClient } from "./supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The workspace's cost settings (its default `cost_models` row), or the
 * engine defaults when none are saved. A stored row that no longer parses
 * falls back to the defaults too, rather than breaking the page.
 */
export async function loadWorkspaceCost(supabase: Supabase, workspaceId: string): Promise<{ settings: CostSettings; saved: boolean }> {
  const { data } = await supabase
    .from("cost_models")
    .select("model")
    .eq("workspace_id", workspaceId)
    .is("dataset_id", null)
    .maybeSingle();
  const parsed = parseCostSettings(data?.model ?? {});
  return { settings: parsed.ok ? parsed.settings : DEFAULT_COST_SETTINGS, saved: Boolean(data) && parsed.ok };
}

/** "€55 per staff hour, 10 min handling per step, €4 per case-day of waiting (+ capital)". */
export function describeCost(s: CostSettings): string {
  const money = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: s.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  const capital = s.capitalCost ? `, plus ${(s.capitalCost.annualRate * 100).toFixed(1)}% a year on ${s.capitalCost.attribute} while a case waits` : "";
  return `${money(s.hourlyRate)} per staff hour, ${s.defaultHandlingMinutes} min of handling per repeated step, and ${money(s.delayCostPerCaseDay)} per case per day of waiting${capital}`;
}
