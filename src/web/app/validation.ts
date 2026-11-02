/**
 * The landing page's validation scorecard. Edit wording here; layout is in page.tsx.
 * Every figure comes from docs/validation.md (BPI Challenge runs, 2026-11-02) or
 * the engine-vs-pm4py parity test (src/miner/tests/test_engine_parity.py);
 * keep them in step when either changes.
 */

export interface ValidationFigure {
  figure: string;
  label: string;
  detail: string;
  source: string;
}

export const VALIDATION: ValidationFigure[] = [
  {
    figure: "10,500 / 10,500",
    label: "cases matched exactly",
    detail: "Also all 56,437 events, and the 1,166 resubmissions in 1,019 declarations.",
    source: "BPIC 2020 travel expenses · Pfeiffer et al., ICPM 2020",
  },
  {
    figure: "2 of 2",
    label: "payments without final approval found",
    detail: "The same two declarations, 90815 and 95149, that the published analysis names.",
    source: "BPIC 2020 travel expenses · Pfeiffer et al., ICPM 2020",
  },
  {
    figure: "2.5×",
    label: "as likely to run slow after a rejection",
    detail: "The same two bottlenecks and the same slow-case drivers as the published analyses. Correlated, not proven causes.",
    source: "BPIC 2020 travel expenses · Pfeiffer et al.; Bano et al., ICPM 2020",
  },
  {
    figure: "63.4 d",
    label: "median purchase-to-pay, against 63.2 published",
    detail: "319,233 SAP events from a multinational, with the same two bottleneck stages.",
    source: "BPIC 2019 purchase-to-pay · Augusto et al.",
  },
  {
    figure: "0",
    label: "differences from pm4py",
    detail: "Every transition count, start and end step, and wait, in calendar time and business hours, on both test logs.",
    source: "pm4py 2.7.23.11 · engine parity test",
  },
  {
    figure: "€896,250.45",
    label: "penalties reconciled to the cent",
    detail: "Over 2,252 penalised applications, equal to an independent calculation.",
    source: "BPIC 2018 EU agricultural payments",
  },
];
