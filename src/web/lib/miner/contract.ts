import { computeVariants, NO_RESOURCE, type EventLog } from "@throughline/engine";

/**
 * Glue between the engine's log and the miner's HTTP contract (src/miner/README.md):
 * events out, and the BPMN and conformance results trimmed to what the page shows.
 * Pure, so it is unit-tested without a miner.
 */

export interface ContractEvent {
  case_id: string;
  activity: string;
  /** ISO 8601 in UTC; the miner refuses timestamps without an offset. */
  timestamp: string;
  resource?: string;
}

/** Every event as the miner's contract event. Attributes are left out: discovery and replay don't use them. */
export function toContractEvents(log: EventLog): ContractEvent[] {
  const out: ContractEvent[] = [];
  for (const c of log.cases) {
    for (const e of c.events) {
      const ev: ContractEvent = { case_id: c.id, activity: log.activities[e.a]!, timestamp: new Date(e.t).toISOString() };
      if (e.r !== NO_RESOURCE) ev.resource = log.resources[e.r]!;
      out.push(ev);
    }
  }
  return out;
}

/** Inductive Miner infrequent: paths taken by fewer than this share are left out, so the model stays readable. */
export const NOISE_THRESHOLD = 0.2;

export interface Reference {
  variants: string[][];
  /** Share of cases that follow one of the reference variants exactly. */
  share: number;
}

/**
 * The reference for conformance: the most common variants, added until they cover half the
 * cases or three are taken. "The way most cases go" stands in for the intended process,
 * which the page says plainly.
 */
export function referenceVariants(log: EventLog, coverage = 0.5, max = 3): Reference {
  const variants: string[][] = [];
  let share = 0;
  for (const v of computeVariants(log)) {
    if (variants.length >= max || share >= coverage) break;
    variants.push(v.activities);
    share += v.share;
  }
  return { variants, share };
}

// --- miner responses (the fields we read) -------------------------------------------------

export interface MinerDiscover {
  bpmn_xml: string;
  stats: { num_cases: number; num_events: number; num_activities: number; num_variants: number; noise_threshold: number; duration_ms: number };
}

export interface MinerConformance {
  num_cases: number;
  num_fit_cases: number;
  conformance_rate: number;
  average_fitness: number;
  log_fitness: number;
  cases: { case_id: string; fitness: number; is_fit: boolean; deviating_activities: string[] }[];
  weekly: { iso_week: string; week_start: string; num_cases: number; num_fit_cases: number; conformance_rate: number }[];
  reference: { bpmn_xml: string | null; matched_cases: number | null; unmatched_variants: string[][] };
  duration_ms: number;
}

// --- what the page gets --------------------------------------------------------------------

export interface ModelResult {
  bpmnXml: string;
  noiseThreshold: number;
  stats: { cases: number; events: number; activities: number; variants: number; durationMs: number };
}

export interface ConformanceResult {
  cases: number;
  fitCases: number;
  conformanceRate: number;
  averageFitness: number;
  logFitness: number;
  reference: Reference & { bpmnXml: string | null };
  weekly: { week: string; weekStart: string; cases: number; rate: number }[];
  /** Activities that didn't fit the reference, by the number of cases they occur in. */
  deviations: { activity: string; cases: number }[];
  /** The lowest-fitness cases, for drill-down. */
  worstCases: { caseId: string; fitness: number; deviating: string[] }[];
  durationMs: number;
}

export function modelResult(r: MinerDiscover): ModelResult {
  const s = r.stats;
  return {
    bpmnXml: r.bpmn_xml,
    noiseThreshold: s.noise_threshold,
    stats: { cases: s.num_cases, events: s.num_events, activities: s.num_activities, variants: s.num_variants, durationMs: s.duration_ms },
  };
}

const TOP_DEVIATIONS = 10;
const WORST_CASES = 20;

export function conformanceResult(r: MinerConformance, reference: Reference): ConformanceResult {
  const counts = new Map<string, number>();
  for (const c of r.cases) for (const a of new Set(c.deviating_activities)) counts.set(a, (counts.get(a) ?? 0) + 1);
  const deviations = [...counts]
    .map(([activity, cases]) => ({ activity, cases }))
    .sort((a, b) => b.cases - a.cases || a.activity.localeCompare(b.activity))
    .slice(0, TOP_DEVIATIONS);
  const worstCases = r.cases
    .filter((c) => !c.is_fit)
    .sort((a, b) => a.fitness - b.fitness || a.case_id.localeCompare(b.case_id))
    .slice(0, WORST_CASES)
    .map((c) => ({ caseId: c.case_id, fitness: c.fitness, deviating: c.deviating_activities }));
  return {
    cases: r.num_cases,
    fitCases: r.num_fit_cases,
    conformanceRate: r.conformance_rate,
    averageFitness: r.average_fitness,
    logFitness: r.log_fitness,
    reference: { ...reference, bpmnXml: r.reference.bpmn_xml },
    weekly: r.weekly.map((w) => ({ week: w.iso_week, weekStart: w.week_start, cases: w.num_cases, rate: w.conformance_rate })),
    deviations,
    worstCases,
    durationMs: r.duration_ms,
  };
}
