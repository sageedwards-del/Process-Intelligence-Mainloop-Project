import { analyzeBottlenecks, buildLog, evaluateRules } from "@throughline/engine";
import { INVOICE_RULES, MERIDIAN_COST_MODEL, generateInvoiceLog } from "@throughline/datagen";

export interface CostFigure {
  category: "Labour" | "Time" | "Compliance";
  label: string;
  amount: number;
  /** The formula with its inputs, as shown under the figure. */
  formula: string;
  metricId: string;
}

/** Headline cost figures for the bundled Meridian sample (data/sample, seed 42), straight from the engine. */
export async function sampleCostFigures(): Promise<{ currency: string; cases: number; figures: CostFigure[] }> {
  "use cache";
  const cost = MERIDIAN_COST_MODEL;
  const log = buildLog(generateInvoiceLog({ cases: 5000, seed: 42 }).rows);
  const rework = analyzeBottlenecks(log, cost).rework[0]!;
  const rules = Object.fromEntries(evaluateRules(log, INVOICE_RULES, cost).map((r) => [r.id, r]));
  const discount = rules["early-payment-discount"]!;
  const controls = [rules["four-eyes"]!, rules["director-over-10k"]!];
  const minutes = rework.minutes;

  return {
    currency: cost.currency,
    cases: log.cases.length,
    figures: [
      {
        category: "Labour",
        label: `Rework on ${rework.activity}`,
        amount: rework.handlingCost,
        formula: `${rework.repeatExecutions} repeats × ${minutes} min × €${cost.hourlyRate}/h`,
        metricId: rework.id,
      },
      {
        category: "Time",
        label: "Missed early-payment discounts",
        amount: discount.cost,
        formula: `${discount.violations.length} late invoices × 2% of amount`,
        metricId: `rule:${discount.id}`,
      },
      {
        category: "Compliance",
        label: "Control failures to follow up",
        amount: controls.reduce((s, r) => s + r.cost, 0),
        formula: `${controls.reduce((s, r) => s + r.violations.length, 0)} violations × €150 audit follow-up`,
        metricId: controls.map((r) => `rule:${r.id}`).join(", "),
      },
    ],
  };
}
