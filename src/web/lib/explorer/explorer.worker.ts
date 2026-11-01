/// <reference lib="webworker" />
import {
  DEFAULT_COST_MODEL,
  analyzeBottlenecks,
  buildLog,
  computeVariants,
  summarize,
  type CostModel,
  type EventLog,
} from "@throughline/engine";
import { decodeSnapshot } from "../snapshot";
import { layoutMap } from "./layout";
import type { FromWorker, LogSource, Overview, ToWorker } from "./protocol";

/**
 * Runs the engine off the main thread: loading and decoding the log, the
 * one-off overview, and the process map for each slider position.
 */
let log: EventLog | null = null;

const post = (msg: FromWorker) => postMessage(msg);
const HOUR = 3_600_000;

async function load(source: LogSource): Promise<{ log: EventLog; cost: CostModel | null }> {
  if (source.kind === "snapshot") {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`Couldn't download the dataset (HTTP ${res.status}).`);
    return { log: await decodeSnapshot(await res.blob()), cost: null };
  }
  const { generateInvoiceLog, MERIDIAN_COST_MODEL } = await import("@throughline/datagen");
  return { log: buildLog(generateInvoiceLog({ cases: 5000, seed: 42 }).rows), cost: MERIDIAN_COST_MODEL };
}

function overview(l: EventLog, cost: CostModel): Overview {
  const report = analyzeBottlenecks(l, cost);
  return {
    summary: summarize(l),
    currency: report.currency,
    variants: computeVariants(l)
      .slice(0, 12)
      .map((v) => ({ key: v.key, steps: v.activities.length, count: v.count, share: v.share, medianDays: v.throughput.median / (24 * HOUR) })),
    edges: report.edges.slice(0, 8).map((e) => ({
      id: e.id,
      from: e.from,
      to: e.to,
      frequency: e.frequency,
      medianHours: e.wait.median / HOUR,
      excessHours: e.excessWaitHours,
      cost: e.delayCost,
    })),
    resources: report.resources.slice(0, 6).map((r) => ({
      id: r.id,
      activity: r.activity,
      resource: r.resource,
      executions: r.executions,
      slowdown: r.slowdown,
      medianHours: r.medianWaitHours,
      peerHours: r.activityMedianWaitHours,
      cost: r.delayCost,
    })),
    rework: report.rework.slice(0, 6).map((r) => ({ id: r.id, activity: r.activity, repeats: r.repeatExecutions, share: r.shareOfCases, cost: r.handlingCost })),
  };
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      const loaded = await load(msg.source);
      log = loaded.log;
      post({ type: "loaded", overview: overview(log, msg.cost ?? loaded.cost ?? DEFAULT_COST_MODEL) });
    } else if (msg.type === "view" && log) {
      post({ type: "view", view: await layoutMap(log, msg.options), seq: msg.seq });
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
