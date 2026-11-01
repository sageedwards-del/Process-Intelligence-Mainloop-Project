import { END, START, buildProcessMap, edgeKey, type EventLog } from "@throughline/engine";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { MapEdge, MapNode, MapView, ViewOptions } from "./protocol";

const elk = new ELK();
const NODE_H = 46;
const TERMINAL = 18;

/** Text width estimate for the activity label (13px sans), so ELK can size boxes without a DOM. */
const labelWidth = (s: string) => Math.max(150, Math.round(s.length * 7.4 + 56));

/** Simplify the log with the sliders, then lay the map out top to bottom with ELK. */
export async function layoutMap(log: EventLog, opts: ViewOptions): Promise<MapView> {
  const map = buildProcessMap(log, opts);
  const node = (a: number) => (a === START ? "start" : a === END ? "end" : `a${a}`);
  const freq = new Map(map.dfg.nodes.map((n) => [n.activity, n.frequency]));
  const ids = [START, END, ...map.activities];

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "56",
      "elk.layered.spacing.edgeNodeBetweenLayers": "24",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: ids.map((a) =>
      a === START || a === END
        ? { id: node(a), width: TERMINAL, height: TERMINAL }
        : { id: node(a), width: labelWidth(log.activities[a]!), height: NODE_H },
    ),
    edges: map.edges.map((e) => ({ id: edgeKey(e.from, e.to), sources: [node(e.from)], targets: [node(e.to)] })),
  };
  const laid = await elk.layout(graph);

  const nodes: MapNode[] = (laid.children ?? []).map((c) => {
    const kind = c.id === "start" ? "start" : c.id === "end" ? "end" : "activity";
    const a = kind === "activity" ? Number(c.id.slice(1)) : -1;
    return {
      id: c.id,
      label: kind === "start" ? "Start" : kind === "end" ? "End" : log.activities[a]!,
      kind,
      x: c.x ?? 0,
      y: c.y ?? 0,
      w: c.width ?? 0,
      h: c.height ?? 0,
      frequency: kind === "activity" ? (freq.get(a) ?? 0) : map.dfg.caseCount,
    };
  });

  const byKey = new Map(map.edges.map((e) => [edgeKey(e.from, e.to), e]));
  const edges: MapEdge[] = (laid.edges ?? []).flatMap((le) => {
    const e = byKey.get(le.id);
    const s = le.sections?.[0];
    if (!e || !s) return [];
    const points = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
    // Label on the longest segment, where there's most room.
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i + 1 < points.length; i++) {
      const len = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
      if (len > bestLen) [best, bestLen] = [i, len];
    }
    const p = points[best]!;
    const q = points[best + 1]!;
    return [
      {
        id: le.id,
        points,
        labelAt: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 },
        frequency: e.frequency,
        medianWaitMs: e.duration.median,
        happy: map.happyPath.has(le.id),
        boundary: e.from === START || e.to === END,
      },
    ];
  });

  return {
    width: laid.width ?? 0,
    height: laid.height ?? 0,
    nodes,
    edges,
    activitiesShown: map.activities.length,
    activitiesTotal: log.activities.length,
    edgesShown: map.edges.length,
    edgesTotal: map.dfg.edges.length,
  };
}
