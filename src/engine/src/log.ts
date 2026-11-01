import { NO_RESOURCE, type Attrs, type AttrValue, type Case, type EventLog, type LogEvent, type RawEvent } from "./types.ts";

/**
 * Build a dictionary-encoded event log from flat rows.
 *
 * - Events are grouped by case and sorted by timestamp; ties keep input order.
 * - Attributes that are constant across a case become case attributes; the
 *   rest stay on the individual events.
 * - Cases keep the order in which their first event appeared.
 */
export function buildLog(rows: readonly RawEvent[]): EventLog {
  const activities: string[] = [];
  const activityIds = new Map<string, number>();
  const resources: string[] = [];
  const resourceIds = new Map<string, number>();

  const intern = (name: string, list: string[], ids: Map<string, number>): number => {
    let id = ids.get(name);
    if (id === undefined) {
      id = list.length;
      list.push(name);
      ids.set(name, id);
    }
    return id;
  };

  const grouped = new Map<string, { seq: number; ev: LogEvent }[]>();
  rows.forEach((row, seq) => {
    if (!Number.isFinite(row.timestamp)) {
      throw new Error(`Event ${seq} (case "${row.caseId}") has an invalid timestamp`);
    }
    const ev: LogEvent = {
      a: intern(row.activity, activities, activityIds),
      t: row.timestamp,
      r: row.resource ? intern(row.resource, resources, resourceIds) : NO_RESOURCE,
    };
    // Read-only reference; splitAttributes builds fresh objects, so caller rows stay untouched.
    if (row.attrs) ev.attrs = row.attrs;
    let list = grouped.get(row.caseId);
    if (!list) {
      list = [];
      grouped.set(row.caseId, list);
    }
    list.push({ seq, ev });
  });

  const cases: Case[] = [];
  for (const [id, list] of grouped) {
    list.sort((x, y) => x.ev.t - y.ev.t || x.seq - y.seq);
    const events = list.map((x) => x.ev);
    cases.push(splitAttributes(id, events));
  }
  return { activities, resources, cases };
}

function splitAttributes(id: string, events: LogEvent[]): Case {
  const caseAttrs: Attrs = {};
  const first = events[0]?.attrs;
  const keys = new Set<string>();
  for (const ev of events) if (ev.attrs) for (const k in ev.attrs) keys.add(k);

  const varying: string[] = [];
  for (const key of keys) {
    const value: AttrValue | undefined = first?.[key];
    let constant = value !== undefined;
    for (let i = 1; constant && i < events.length; i++) constant = events[i]!.attrs?.[key] === value;
    if (constant) caseAttrs[key] = value!;
    else varying.push(key);
  }

  // Build new per-event objects holding only the varying keys (no `delete`, which
  // would both mutate caller data and push V8 objects into slow dictionary mode).
  for (const ev of events) {
    const src = ev.attrs;
    if (!src) continue;
    let own: Attrs | undefined;
    for (const k of varying) {
      const v = src[k];
      if (v !== undefined) (own ??= {})[k] = v;
    }
    if (own) ev.attrs = own;
    else delete ev.attrs;
  }
  return { id, events, attrs: caseAttrs };
}

/** Return a log containing only the given cases, sharing dictionaries with the source. */
export function withCases(log: EventLog, cases: Case[]): EventLog {
  return { activities: log.activities, resources: log.resources, cases };
}

/**
 * Project the log onto a subset of activities: events of other activities are
 * dropped, so their neighbours become directly connected. This is how
 * Disco/Celonis-style activity sliders behave. Cases left empty are removed.
 */
export function projectActivities(log: EventLog, keep: ReadonlySet<number>): EventLog {
  const cases: Case[] = [];
  for (const c of log.cases) {
    const events = c.events.filter((e) => keep.has(e.a));
    if (events.length > 0) cases.push({ ...c, events });
  }
  return withCases(log, cases);
}

export function activityId(log: EventLog, name: string): number {
  return log.activities.indexOf(name);
}

export function throughputTime(c: Case): number {
  if (c.events.length === 0) return 0;
  return c.events[c.events.length - 1]!.t - c.events[0]!.t;
}

export function eventCount(log: EventLog): number {
  let n = 0;
  for (const c of log.cases) n += c.events.length;
  return n;
}
