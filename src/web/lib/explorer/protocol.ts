import type { AnalysisSettings, AttributeOverview, BatchStep, CaseFilter, CaseTimeline, CostModel, LogSummary, Rule, WaitContext } from "@throughline/engine";

/** Where the explorer gets its log: a stored snapshot, or the bundled Meridian sample. */
export type LogSource = { kind: "snapshot"; url: string } | { kind: "sample" };

export type Kpi = "frequency" | "median";

export interface ViewOptions {
  /** Share of activities shown, most frequent first (0..1). */
  activityShare: number;
  /** Share of paths shown, most frequent first (0..1). */
  pathShare: number;
}

export interface MapNode {
  id: string;
  label: string;
  kind: "activity" | "start" | "end";
  x: number;
  y: number;
  w: number;
  h: number;
  frequency: number;
}

export interface MapEdge {
  id: string;
  /** Polyline through ELK's routed points. */
  points: { x: number; y: number }[];
  labelAt: { x: number; y: number };
  frequency: number;
  medianWaitMs: number;
  happy: boolean;
  /** Edges into "End" or out of "Start" carry no wait. */
  boundary: boolean;
}

export interface MapView {
  width: number;
  height: number;
  nodes: MapNode[];
  edges: MapEdge[];
  activitiesShown: number;
  activitiesTotal: number;
  edgesShown: number;
  edgesTotal: number;
}

export interface VariantRow {
  key: string;
  steps: number;
  count: number;
  share: number;
  medianDays: number;
}

/** Facts about the whole (unfiltered) log, for building filters. */
export interface LogMeta {
  totalCases: number;
  firstEvent: number | null;
  lastEvent: number | null;
  /** Activity names, most frequent first. */
  activities: string[];
  attributes: AttributeOverview[];
  rules: { id: string; name: string }[];
  /** How waits are classified for this log (detected once on the whole log); see engine waits.ts. */
  waits: Omit<WaitContext, "runs" | "batchSteps"> & { normalWaitPercentile: number; resources: string[] };
}

/** Where a transition's waiting time went, in hours. */
export interface WaitBreakdownRow {
  queueHours: number;
  offHoursHours: number;
  batchHours: number;
  scheduledHours: number;
}

/** A money figure and the formula that produced it, in words. */
export interface Priced {
  cost: number;
  formula: string;
}

export interface RuleRow extends Priced {
  id: string;
  name: string;
  type: Rule["type"];
  casesChecked: number;
  violations: number;
  rate: number;
  /** Every violating case id (for the "show violators" filter). */
  caseIds: string[];
  /** The first few violations, for drill-down. */
  examples: { caseId: string; detail: string }[];
}

/** Everything computed for the current filter. */
export interface Analysis {
  summary: LogSummary;
  currency: string;
  variants: VariantRow[];
  /** Waits ranked as bottlenecks: queues and batch waits, never planned dates. */
  edges: ({
    id: string;
    from: string;
    to: string;
    frequency: number;
    medianHours: number;
    kind: "queue" | "batch" | "scheduled";
    automaticShare: number;
    stuckCount: number;
    breakdown: WaitBreakdownRow;
  } & Priced)[];
  /** Steps done in runs, with how often they run. */
  batches: BatchStep[];
  /** Waits until a planned date (a trip, an appointment): shown, never priced. */
  planned: { id: string; from: string; to: string; frequency: number; medianHours: number }[];
  resources: ({ id: string; activity: string; resource: string; executions: number; slowdown: number; medianHours: number; peerHours: number } & Priced)[];
  rework: ({ id: string; activity: string; repeats: number; share: number } & Priced)[];
  /** Baseline hands-on labour for the filtered cases; `cost` is the total. */
  costToServe: Priced & {
    perCase: number;
    activities: ({ id: string; activity: string; executions: number } & Priced)[];
  };
  rules: RuleRow[];
  /** Working-capital cost of excess queue time, when the cost model sets one; part of `edges[].cost`, never extra. */
  capital: Priced | null;
  slowest: { id: string; start: number; throughputMs: number; steps: number }[];
}

/** What root-cause analysis explains. */
export type Outcome =
  | { kind: "slow"; percentile: number }
  | { kind: "activity"; activity: string }
  | { kind: "rule"; ruleId: string };

export interface RootCauseRow {
  id: string;
  attribute: string;
  value: string;
  cases: number;
  outcomeCases: number;
  rate: number;
  restRate: number;
  lift: number;
  excessCases: number;
  z: number;
  smallSample: boolean;
  significant: boolean;
  /** Present when the segment can be applied as a filter (categorical case attributes). */
  filter?: CaseFilter;
}

export interface RootCauseView {
  outcomeLabel: string;
  totalCases: number;
  outcomeCases: number;
  overallRate: number;
  factors: RootCauseRow[];
}

export type ToWorker =
  | { type: "load"; source: LogSource; cost?: CostModel; rules?: Rule[]; settings?: AnalysisSettings }
  | { type: "filter"; filters: CaseFilter[]; seq: number }
  | { type: "view"; options: ViewOptions; seq: number }
  | { type: "rootCause"; outcome: Outcome; seq: number }
  | { type: "case"; id: string };

export type FromWorker =
  | { type: "loaded"; meta: LogMeta }
  | { type: "analysis"; analysis: Analysis; seq: number }
  | { type: "view"; view: MapView | null; seq: number }
  | { type: "rootCause"; report: RootCauseView; seq: number }
  | { type: "case"; timeline: CaseTimeline | null; id: string }
  | { type: "error"; message: string };
