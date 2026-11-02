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

/** "€55 per staff hour, 10 min of handling per step, and waiting priced through …". */
export function describeCost(s: CostSettings): string {
  const money = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: s.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  const waiting = [
    "the time rules it breaks",
    s.capitalCost ? `${(s.capitalCost.annualRate * 100).toFixed(1)}% a year on ${s.capitalCost.attribute}` : "",
    s.delayCostPerCaseDay > 0 ? `${money(s.delayCostPerCaseDay)} per excess case-day` : "",
  ].filter(Boolean);
  return `${money(s.hourlyRate)} per staff hour, ${s.defaultHandlingMinutes} min of handling per step, and queue time beyond each step's usual wait (working hours) priced through ${waiting.join(" and ")}`;
}
