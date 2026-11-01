import {
  END,
  START,
  analyzeBottlenecks,
  computeDfg,
  type DurationStats,
  type EventLog,
  type WorkCalendar,
} from "@throughline/engine";

/**
 * The engine's DFG for a log, keyed by activity name, in a form the pm4py
 * worker can check against its own discovery (src/miner/tests/test_engine_parity.py).
 * Durations are in seconds, matching pm4py's performance DFG.
 */
export interface DfgContract {
  caseCount: number;
  eventCount: number;
  /** Working hours used for `workingSeconds`; matches pm4py's default business-hour slots. */
  workCalendar: WorkCalendar;
  start: Record<string, number>;
  end: Record<string, number>;
  edges: {
    from: string;
    to: string;
    frequency: number;
    seconds: SecondsStats;
    workingSeconds: SecondsStats;
  }[];
}

export interface SecondsStats {
  min: number;
  max: number;
  mean: number;
  median: number;
  total: number;
}

/** pm4py's default business hours: Monday–Friday, 07:00–17:00 UTC. */
export const PM4PY_WORK_CALENDAR: WorkCalendar = { workDays: [1, 2, 3, 4, 5], startHour: 7, endHour: 17, utcOffsetMinutes: 0 };

export function dfgContract(log: EventLog): DfgContract {
  const dfg = computeDfg(log);
  const name = (a: number) => log.activities[a]!;
  const start: Record<string, number> = {};
  const end: Record<string, number> = {};
  for (const e of dfg.edges) {
    if (e.from === START) start[name(e.to)] = e.frequency;
    if (e.to === END) end[name(e.from)] = e.frequency;
  }
  const report = analyzeBottlenecks(log, undefined, { calendar: PM4PY_WORK_CALENDAR });
  const edges = report.edges
    .map((e) => ({
      from: e.from,
      to: e.to,
      frequency: e.frequency,
      seconds: seconds(e.wait),
      workingSeconds: seconds(e.workingWait!),
    }))
    .sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  return {
    caseCount: dfg.caseCount,
    eventCount: dfg.eventCount,
    workCalendar: PM4PY_WORK_CALENDAR,
    start: sortKeys(start),
    end: sortKeys(end),
    edges,
  };
}

function seconds(d: DurationStats): SecondsStats {
  return { min: d.min / 1000, max: d.max / 1000, mean: d.mean / 1000, median: d.median / 1000, total: d.total / 1000 };
}

function sortKeys(o: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)));
}
