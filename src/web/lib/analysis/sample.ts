import { generateInvoiceLog, INVOICE_RULES, MERIDIAN_COST_MODEL } from "@throughline/datagen";
import { buildLog, type EventLog, type Rule } from "@throughline/engine";
import type { AnalysisInputs } from "./analyse";

/** The Meridian sample as /sample shows it: 5,000 invoices, seed 42, its own cost model and rules. */
export function meridianSample(): { log: EventLog; inputs: AnalysisInputs } {
  return {
    log: buildLog(generateInvoiceLog({ cases: 5000, seed: 42 }).rows),
    inputs: { cost: MERIDIAN_COST_MODEL, rules: INVOICE_RULES as unknown as Rule[], settings: {} },
  };
}
