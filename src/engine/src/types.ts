/**
 * Core types for the process-mining engine.
 *
 * The engine works on a dictionary-encoded event log: activity and resource
 * names are interned to integer ids, timestamps are epoch milliseconds. This
 * keeps logs with hundreds of thousands of events small enough to filter
 * interactively in a Web Worker.
 */

export type AttrValue = string | number | boolean | null;
export type Attrs = Record<string, AttrValue>;

/**
 * Where an event sits in its activity's life (XES lifecycle). Rows without one
 * are completions. Starts, suspends and resumes are paired with the completion
 * that follows them, so processing time can be told apart from waiting.
 */
export type Lifecycle = "start" | "suspend" | "resume" | "complete" | "abort" | "other";

/** One row of an uploaded event log, after column mapping. */
export interface RawEvent {
  caseId: string;
  activity: string;
  /** Epoch milliseconds. */
  timestamp: number;
  resource?: string | null;
  attrs?: Attrs;
  lifecycle?: Lifecycle;
  /** The source system's id for the event or line, used to tell real duplicates from items recorded together. */
  eventId?: string;
}

/** Sentinel resource id for events without a resource. */
export const NO_RESOURCE = -1;

export interface LogEvent {
  /** Activity id (index into `EventLog.activities`). */
  a: number;
  /** Epoch milliseconds. */
  t: number;
  /** Resource id (index into `EventLog.resources`), or NO_RESOURCE. */
  r: number;
  /** Event-level attributes that vary within the case. */
  attrs?: Attrs;
  /** When work on this activity instance started (epoch ms); only for logs with lifecycle starts. */
  s?: number;
  /** Processing time in ms: start to completion, minus suspended spells. Present with `s`. */
  p?: number;
}

export interface Case {
  id: string;
  /** Events sorted by timestamp (stable on ties). */
  events: LogEvent[];
  /** Attributes whose value is constant across every event of the case. */
  attrs: Attrs;
  /**
   * Work started but aborted (lifecycle abort), with its worked time in `p`.
   * Not steps of the process, so not in `events` or the map, but still paid labour.
   */
  aborted?: LogEvent[];
}

export interface EventLog {
  activities: string[];
  resources: string[];
  cases: Case[];
}

/** Synthetic DFG node ids for the process start and end. */
export const START = -1;
export const END = -2;

export interface DurationStats {
  count: number;
  /** All values in milliseconds. */
  min: number;
  max: number;
  mean: number;
  median: number;
  p90: number;
  total: number;
}

export interface DfgNode {
  activity: number;
  /** Number of times the activity was executed. */
  frequency: number;
  /** Number of distinct cases containing the activity. */
  caseCount: number;
}

export interface DfgEdge {
  from: number;
  to: number;
  /** Number of times `to` directly followed `from`. */
  frequency: number;
  /** Number of distinct cases containing the transition. */
  caseCount: number;
  /** Elapsed time between the two events. Zero-length for START/END edges. */
  duration: DurationStats;
}

export interface Dfg {
  nodes: DfgNode[];
  edges: DfgEdge[];
  caseCount: number;
  eventCount: number;
}
