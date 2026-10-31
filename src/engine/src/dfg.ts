import { durationStats } from "./stats.js";
import { END, START, type Dfg, type DfgEdge, type DfgNode, type EventLog } from "./types.js";

export function edgeKey(from: number, to: number): string {
  return `${from}>${to}`;
}

/** Raw per-edge durations (ms), keyed by `edgeKey`. Exposed for performance analyses. */
export type EdgeDurations = Map<string, number[]>;

/**
 * Directly-follows graph with frequency and performance annotations.
 *
 * For every case `<e1, e2, ..., en>` this counts START→e1, ei→ei+1 and en→END,
 * and records the elapsed time of each ei→ei+1 transition.
 */
export function computeDfg(log: EventLog): Dfg {
  return computeDfgWithDurations(log).dfg;
}

/**
 * Same as `computeDfg`, also returning the raw durations per edge. Uses dense
 * numeric indexes instead of string keys: this is the hot loop of the engine.
 */
export function computeDfgWithDurations(log: EventLog): { dfg: Dfg; durations: EdgeDurations } {
  // Node index = activity id + 2, so START (-1) -> 1 and END (-2) -> 0.
  const width = log.activities.length + 2;
  const nodeFreq = new Int32Array(width);
  const nodeCases = new Int32Array(width);
  const nodeLastCase = new Int32Array(width).fill(-1);
  const edgeFreq = new Int32Array(width * width);
  const edgeCases = new Int32Array(width * width);
  const edgeLastCase = new Int32Array(width * width).fill(-1);
  const edgeDur: (number[] | undefined)[] = new Array(width * width);
  let eventCount = 0;
  let caseCount = 0;

  const visitEdge = (ci: number, from: number, to: number, duration: number) => {
    const k = (from + 2) * width + (to + 2);
    edgeFreq[k]!++;
    (edgeDur[k] ??= []).push(duration);
    if (edgeLastCase[k] !== ci) {
      edgeLastCase[k] = ci;
      edgeCases[k]!++;
    }
  };

  log.cases.forEach((c, ci) => {
    const evs = c.events;
    if (evs.length === 0) return;
    caseCount++;
    eventCount += evs.length;
    visitEdge(ci, START, evs[0]!.a, 0);
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]!;
      const n = e.a + 2;
      nodeFreq[n]!++;
      if (nodeLastCase[n] !== ci) {
        nodeLastCase[n] = ci;
        nodeCases[n]!++;
      }
      const next = evs[i + 1];
      if (next) visitEdge(ci, e.a, next.a, next.t - e.t);
    }
    visitEdge(ci, evs[evs.length - 1]!.a, END, 0);
  });

  const nodes: DfgNode[] = [];
  for (let n = 2; n < width; n++) {
    if (nodeFreq[n]! > 0) nodes.push({ activity: n - 2, frequency: nodeFreq[n]!, caseCount: nodeCases[n]! });
  }
  nodes.sort((x, y) => y.frequency - x.frequency || x.activity - y.activity);

  const edges: DfgEdge[] = [];
  const durations: EdgeDurations = new Map();
  for (let k = 0; k < edgeFreq.length; k++) {
    if (edgeFreq[k] === 0) continue;
    const from = Math.floor(k / width) - 2;
    const to = (k % width) - 2;
    const ds = edgeDur[k]!;
    durations.set(edgeKey(from, to), ds);
    edges.push({ from, to, frequency: edgeFreq[k]!, caseCount: edgeCases[k]!, duration: durationStats(ds) });
  }
  edges.sort((x, y) => y.frequency - x.frequency || x.from - y.from || x.to - y.to);

  return { dfg: { nodes, edges, caseCount, eventCount }, durations };
}

export function nodeLabel(log: EventLog, id: number): string {
  if (id === START) return "▶ Start";
  if (id === END) return "■ End";
  return log.activities[id] ?? `#${id}`;
}

/** Human-readable edge name used in IDs, filters and AI prompts: "A → B". */
export function edgeName(log: EventLog, from: number, to: number): string {
  return `${nodeLabel(log, from)} → ${nodeLabel(log, to)}`;
}
