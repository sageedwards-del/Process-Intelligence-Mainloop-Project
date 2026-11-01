import {
  analyzeBottlenecks,
  buildLog,
  buildProcessMap,
  edgeKey,
  END,
  START,
} from "@throughline/engine";
import { MERIDIAN_COST_MODEL, generateInvoiceLog } from "@throughline/datagen";
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";

export interface HeroNode {
  id: string;
  label: string;
  x: number;
  y: number;
  /** 0..1, relative to the most frequent activity. */
  weight: number;
}

export interface HeroEdge {
  id: string;
  path: string;
  /** 0..1, relative to the most frequent path. */
  weight: number;
  happy: boolean;
}

export interface HeroMap {
  width: number;
  height: number;
  nodes: HeroNode[];
  edges: HeroEdge[];
  /** The worst resource bottleneck, cited by its metric ID and pinned to its activity. */
  callout: { id: string; slowdown: number; x: number; y: number };
  cases: number;
}

/**
 * Lays out the Meridian sample's real process map for the landing hero.
 * Positions come from ELK's layered layout, top to bottom so it fills a tall
 * column; edges are drawn as soft curves between node centres so the map reads
 * as a network rather than a flowchart.
 */
export async function buildHeroMap(): Promise<HeroMap> {
  "use cache";
  const { rows } = generateInvoiceLog({ cases: 5000, seed: 42 });
  const log = buildLog(rows);
  const map = buildProcessMap(log, { pathShare: 0.7 });
  const name = (a: number) => log.activities[a]!;
  const node = (a: number) => (a === START ? "start" : a === END ? "end" : `a${a}`);

  const maxNode = Math.max(...map.dfg.nodes.map((n) => n.frequency));
  const edges = map.edges;
  const maxEdge = Math.max(...edges.map((e) => e.frequency));

  const input: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "150",
      "elk.layered.spacing.nodeNodeBetweenLayers": "48",
      "elk.layered.cycleBreaking.strategy": "GREEDY",
    },
    children: [
      { id: "start", width: 8, height: 8 },
      { id: "end", width: 8, height: 8 },
      ...map.activities.map((a) => ({ id: node(a), width: 8, height: 8 })),
    ],
    edges: edges.map((e) => ({ id: edgeKey(e.from, e.to), sources: [node(e.from)], targets: [node(e.to)] })),
  };
  const graph = await new ELK().layout(input);

  const pos = new Map((graph.children ?? []).map((c) => [c.id, { x: (c.x ?? 0) + 4, y: (c.y ?? 0) + 4 }]));
  const nodeFreq = new Map(map.dfg.nodes.map((n) => [n.activity, n.frequency]));

  const nodes: HeroNode[] = [
    { id: "start", label: "Start", ...pos.get("start")!, weight: 1 },
    { id: "end", label: "End", ...pos.get("end")!, weight: 1 },
    ...map.activities.map((a) => ({
      id: node(a),
      label: name(a),
      ...pos.get(node(a))!,
      weight: (nodeFreq.get(a) ?? 0) / maxNode,
    })),
  ];

  const heroEdges: HeroEdge[] = edges.map((e) => {
    const p = pos.get(node(e.from))!;
    const q = pos.get(node(e.to))!;
    const back = q.y <= p.y;
    // Forward edges bow gently; back edges (rework loops) arc wide to the left.
    const dy = q.y - p.y;
    const path = back
      ? `M${p.x},${p.y} C${p.x - 130},${p.y - 10} ${q.x - 130},${q.y + 10} ${q.x},${q.y}`
      : `M${p.x},${p.y} C${p.x},${p.y + dy * 0.5} ${q.x},${q.y - dy * 0.5} ${q.x},${q.y}`;
    return {
      id: edgeKey(e.from, e.to),
      path,
      weight: e.frequency / maxEdge,
      happy: map.happyPath.has(edgeKey(e.from, e.to)),
    };
  });

  const top = analyzeBottlenecks(log, MERIDIAN_COST_MODEL).resources[0]!;
  const at = pos.get(node(log.activities.indexOf(top.activity))) ?? { x: 0, y: 0 };

  return {
    width: graph.width ?? 0,
    height: graph.height ?? 0,
    nodes,
    edges: heroEdges,
    callout: { id: top.id, slowdown: top.slowdown, x: at.x, y: at.y },
    cases: log.cases.length,
  };
}
