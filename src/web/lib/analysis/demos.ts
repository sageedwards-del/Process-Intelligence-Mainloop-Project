import { generateInvoiceLog, INVOICE_RULES, MERIDIAN_COST_MODEL } from "@throughline/datagen";
import { buildLog, DEFAULT_COST_MODEL, type EventLog, type Rule } from "@throughline/engine";
import type { AnalysisInputs } from "./analyse";

/**
 * The public demos on /sample: a real log (BPI Challenge 2020, shipped as a snapshot in
 * public/demo/, built by scripts/build-demo.ts) and the synthetic Meridian log with known answers.
 */

export type DemoId = "bpic2020" | "meridian";

const FINAL = "Declaration FINAL_APPROVED by SUPERVISOR";
const PAID = "Payment Handled";

export const BPIC2020_RULES: Rule[] = [
  { id: "approved-before-payment", name: "Final approval before payment", type: "precedence", before: FINAL, after: PAID },
  { id: "no-duplicate-declarations", name: "No declaration number used twice", type: "duplicate", keys: ["DeclarationNumber"] },
];

export interface Demo {
  id: DemoId;
  /** Picker label. */
  label: string;
  eyebrow: string;
  title: string;
  intro: string;
  costNote: string;
  /** Where the snapshot is served from; absent for Meridian, which the worker generates. */
  snapshotPath?: string;
  source?: { text: string; href: string; licence: string; licenceHref: string };
  inputs: AnalysisInputs;
}

export const DEMOS: Record<DemoId, Demo> = {
  bpic2020: {
    id: "bpic2020",
    label: "Real data: university travel expenses",
    eyebrow: "Real data · BPI Challenge 2020",
    title: "Travel expense claims at a Dutch university",
    intro:
      "10,500 domestic travel declarations filed at Eindhoven University of Technology in 2017–18: submitted by an employee, approved by administration, sometimes a budget owner, then a supervisor, then paid. People are anonymised to their roles. On this log the engine reproduces published analyses: the same 1,166 resubmissions, the two declarations paid without final approval, and the same two slowest stages.",
    costNote:
      `The public log has no cost data, so money here rests on the default assumptions: €${DEFAULT_COST_MODEL.hourlyRate} per staff hour and ${DEFAULT_COST_MODEL.defaultHandlingMinutes} minutes per step. The rules are counted, not priced.`,
    snapshotPath: "/demo/bpic2020-domestic.json.gz",
    source: {
      text: "B.F. van Dongen (2020), BPI Challenge 2020: Domestic Declarations, 4TU.ResearchData",
      href: "https://doi.org/10.4121/uuid:3f422315-ed9d-4882-891f-e180b5b4feb5",
      licence: "CC BY-NC 4.0",
      licenceHref: "https://creativecommons.org/licenses/by-nc/4.0/",
    },
    inputs: { cost: DEFAULT_COST_MODEL, rules: BPIC2020_RULES, settings: {} },
  },
  meridian: {
    id: "meridian",
    label: "Synthetic: known answers",
    eyebrow: "Sample · synthetic data",
    title: "Meridian Advisory: invoice approval",
    intro:
      "Six months of invoices at a fictional professional-services firm, generated with known problems built in: a slow approving partner, a rework loop on matching, missed approvals and duplicate payments. Because the answers are known, it shows whether the engine finds them.",
    costNote:
      "Priced with the sample's cost model: €55 per staff hour with set minutes per step, and waiting priced only through the early-payment discounts it loses, shared out over the waits that ran long.",
    inputs: { cost: MERIDIAN_COST_MODEL, rules: INVOICE_RULES as unknown as Rule[], settings: {} },
  },
};

export const DEFAULT_DEMO: DemoId = "bpic2020";

export const isDemoId = (v: unknown): v is DemoId => v === "bpic2020" || v === "meridian";

/** The Meridian sample: 5,000 invoices, seed 42. */
export function meridianLog(): EventLog {
  return buildLog(generateInvoiceLog({ cases: 5000, seed: 42 }).rows);
}

