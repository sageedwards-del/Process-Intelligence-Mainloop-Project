import { detectWaitContext, type EventLog } from "@throughline/engine";
import { analyse, rootCause, type AnalysisInputs } from "../analysis/analyse";
import type { Analysis } from "../explorer/protocol";
import { buildMetrics, type MetricBundle } from "./metrics";

/** The slowest 10% of cases: what insights and the memo explain by root cause. */
export const SLOW_OUTCOME = { kind: "slow", percentile: 0.9 } as const;

export interface AnalysedLog {
  analysis: Analysis;
  bundle: MetricBundle;
}

/** The explorer's analysis of the whole log and its metrics bundle, for Claude. */
export function analyseForAi(log: EventLog, inputs: AnalysisInputs): AnalysedLog {
  const full: AnalysisInputs = { ...inputs, context: inputs.context ?? detectWaitContext(log, inputs.settings) };
  const analysis = analyse(log, full);
  return { analysis, bundle: buildMetrics(analysis, log.cases.length ? rootCause(log, SLOW_OUTCOME, full) : null) };
}
