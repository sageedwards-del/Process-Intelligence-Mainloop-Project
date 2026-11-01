import type { CostModel, LogSummary } from "@throughline/engine";

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

export interface Overview {
  summary: LogSummary;
  currency: string;
  variants: VariantRow[];
  edges: { id: string; from: string; to: string; frequency: number; medianHours: number; excessHours: number; cost: number }[];
  resources: { id: string; activity: string; resource: string; executions: number; slowdown: number; medianHours: number; peerHours: number; cost: number }[];
  rework: { id: string; activity: string; repeats: number; share: number; cost: number }[];
}

export type ToWorker =
  | { type: "load"; source: LogSource; cost?: CostModel }
  | { type: "view"; options: ViewOptions; seq: number };

export type FromWorker =
  | { type: "loaded"; overview: Overview }
  | { type: "view"; view: MapView; seq: number }
  | { type: "error"; message: string };
