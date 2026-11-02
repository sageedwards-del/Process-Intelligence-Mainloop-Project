/// <reference lib="webworker" />
import {
  DEFAULT_COST_MODEL,
  DEFAULT_NORMAL_WAIT_PERCENTILE,
  attributeOverview,
  buildLog,
  caseTimeline,
  detectWaitContext,
  filterLog,
  summarize,
  type AnalysisSettings,
  type CostModel,
  type EventLog,
  type Rule,
  type WaitContext,
} from "@throughline/engine";
import { activitiesByFrequency, analyse, rootCause, type AnalysisInputs } from "../analysis/analyse";
import { decodeSnapshot } from "../snapshot";
import { layoutMap } from "./layout";
import type { FromWorker, LogMeta, LogSource, ToWorker } from "./protocol";

/**
 * Runs the engine off the main thread: loading and decoding the log, the
 * analysis of the filtered cases, the process map for each slider position,
 * root causes and single-case timelines.
 */
let log: EventLog | null = null;
let filtered: EventLog | null = null;
let cost: CostModel = DEFAULT_COST_MODEL;
let rules: Rule[] = [];
let settings: AnalysisSettings = {};
/** Detected once on the whole log, so filtering never turns a batch into a queue. */
let context: WaitContext | null = null;

const post = (msg: FromWorker) => postMessage(msg);
const inputs = (): AnalysisInputs => ({ cost, rules, settings, context: context ?? undefined });

async function load(source: LogSource): Promise<{ log: EventLog; cost: CostModel | null; rules: Rule[] }> {
  if (source.kind === "snapshot") {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`Couldn't download the dataset (HTTP ${res.status}).`);
    return { log: await decodeSnapshot(await res.blob()), cost: null, rules: [] };
  }
  const { generateInvoiceLog, INVOICE_RULES, MERIDIAN_COST_MODEL } = await import("@throughline/datagen");
  return {
    log: buildLog(generateInvoiceLog({ cases: 5000, seed: 42 }).rows),
    cost: MERIDIAN_COST_MODEL,
    rules: INVOICE_RULES as unknown as Rule[],
  };
}

function meta(l: EventLog): LogMeta {
  const summary = summarize(l);
  return {
    totalCases: l.cases.length,
    firstEvent: summary.firstEvent,
    lastEvent: summary.lastEvent,
    activities: activitiesByFrequency(l),
    attributes: attributeOverview(l),
    rules: rules.map((r) => ({ id: r.id, name: r.name })),
    waits: {
      calendar: context!.calendar,
      calendarSource: context!.calendarSource,
      calendarCoverage: context!.calendarCoverage,
      scheduled: context!.scheduled,
      systemResources: context!.systemResources,
      normalWaitPercentile: settings.normalWaitPercentile ?? DEFAULT_NORMAL_WAIT_PERCENTILE,
      resources: [...l.resources].sort(),
    },
  };
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  try {
    if (msg.type === "load") {
      const loaded = await load(msg.source);
      log = filtered = loaded.log;
      cost = msg.cost ?? loaded.cost ?? DEFAULT_COST_MODEL;
      rules = msg.rules ?? loaded.rules;
      settings = msg.settings ?? {};
      context = detectWaitContext(log, settings);
      post({ type: "loaded", meta: meta(log) });
    } else if (!log || !filtered) {
      return;
    } else if (msg.type === "filter") {
      filtered = filterLog(log, msg.filters);
      post({ type: "analysis", analysis: analyse(filtered, inputs()), seq: msg.seq });
    } else if (msg.type === "view") {
      const l = filtered;
      post({ type: "view", view: l.cases.length ? await layoutMap(l, msg.options) : null, seq: msg.seq });
    } else if (msg.type === "rootCause") {
      post({ type: "rootCause", report: rootCause(filtered, msg.outcome, inputs()), seq: msg.seq });
    } else if (msg.type === "case") {
      post({ type: "case", timeline: caseTimeline(log, msg.id), id: msg.id });
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
