import { computeDfg, edgeKey } from "./dfg.js";
import { projectActivities } from "./log.js";
import { END, START, type Dfg, type DfgEdge, type EventLog } from "./types.js";

export interface ProcessMapOptions {
  /** Share of activities to show, most frequent first (0..1). Default 1. */
  activityShare?: number;
  /** Share of paths to show, most frequent first (0..1). Default 1. */
  pathShare?: number;
}

export interface ProcessMap {
  dfg: Dfg;
  /** Edges shown after path simplification. */
  edges: DfgEdge[];
  /** Activity ids shown. */
  activities: number[];
  /** Edge keys (`from>to`) on the most frequent variant — the "happy path". */
  happyPath: Set<string>;
}

/**
 * Celonis/Disco-style simplified process map.
 *
 * 1. Keep the top `activityShare` of activities by frequency and project the
 *    log onto them, so hidden activities are bridged rather than leaving gaps.
 * 2. Keep the top `pathShare` of edges by frequency, then add back each
 *    activity's strongest incoming and outgoing edge so nothing is orphaned.
 * 3. Mark the edges of the most frequent variant as the happy path.
 */
export function buildProcessMap(log: EventLog, opts: ProcessMapOptions = {}): ProcessMap {
  const activityShare = clamp01(opts.activityShare ?? 1);
  const pathShare = clamp01(opts.pathShare ?? 1);

  const full = computeDfg(log);
  const keepN = Math.max(1, Math.ceil(full.nodes.length * activityShare));
  const keep = new Set(full.nodes.slice(0, keepN).map((n) => n.activity));
  const projected = keep.size === full.nodes.length ? log : projectActivities(log, keep);
  const dfg = projected === log ? full : computeDfg(projected);

  const ranked = dfg.edges; // already sorted by frequency desc
  const kept = new Set<string>();
  const pathN = Math.max(1, Math.ceil(ranked.length * pathShare));
  for (const e of ranked.slice(0, pathN)) kept.add(edgeKey(e.from, e.to));

  // Connectivity guarantee: strongest in/out edge for every visible node.
  const bestIn = new Map<number, DfgEdge>();
  const bestOut = new Map<number, DfgEdge>();
  for (const e of ranked) {
    if (!bestOut.has(e.from)) bestOut.set(e.from, e);
    if (!bestIn.has(e.to)) bestIn.set(e.to, e);
  }
  for (const n of dfg.nodes) {
    const i = bestIn.get(n.activity);
    const o = bestOut.get(n.activity);
    if (i) kept.add(edgeKey(i.from, i.to));
    if (o) kept.add(edgeKey(o.from, o.to));
  }

  const edges = ranked.filter((e) => kept.has(edgeKey(e.from, e.to)));
  return { dfg, edges, activities: dfg.nodes.map((n) => n.activity), happyPath: happyPathEdges(projected) };
}

function happyPathEdges(log: EventLog): Set<string> {
  const counts = new Map<string, { n: number; seq: number[] }>();
  for (const c of log.cases) {
    const seq = c.events.map((e) => e.a);
    const k = seq.join(",");
    const entry = counts.get(k);
    if (entry) entry.n++;
    else counts.set(k, { n: 1, seq });
  }
  let best: number[] | undefined;
  let bestN = 0;
  for (const { n, seq } of counts.values()) if (n > bestN) [best, bestN] = [seq, n];

  const out = new Set<string>();
  if (!best || best.length === 0) return out;
  out.add(edgeKey(START, best[0]!));
  for (let i = 0; i + 1 < best.length; i++) out.add(edgeKey(best[i]!, best[i + 1]!));
  out.add(edgeKey(best[best.length - 1]!, END));
  return out;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
