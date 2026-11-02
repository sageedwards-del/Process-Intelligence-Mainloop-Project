import { DEFAULT_WORK_CALENDAR, validateWorkCalendar, workingMs, type WorkCalendar } from "./calendar.ts";
import { DAY_MS, HOUR_MS } from "./stats.ts";
import { NO_RESOURCE, type EventLog } from "./types.ts";

/**
 * Why a case waited, adapted from Lashkevich et al., "Why am I Waiting?"
 * (CAiSE 2023) for logs with one timestamp per event. Each wait before an
 * event gets one kind, in order of precedence:
 *
 * - scheduled: the step happens on a planned date (a trip, an appointment);
 *   its timestamps are calendar dates, recorded at local midnight. Not a delay.
 * - batch: the step runs for many cases at once (a payment run, a nightly
 *   job) or is done by a system. The lever is how often it runs.
 * - instant: the step followed within a minute, i.e. it was automatic.
 * - human: everything else, split into queue time (working hours) and
 *   off-hours time (nights, weekends), using a calendar learned from the log.
 *
 * See docs/adr/0003-waiting-time-classification.md.
 */

/** Per-dataset choices that override what is detected. Stored as JSON, so parsed, never trusted. */
export interface AnalysisSettings {
  /** Steps that happen on planned dates, in addition to those detected. */
  scheduledActivities?: string[];
  /** Detected scheduled steps that aren't. */
  notScheduled?: string[];
  /** Resources that are systems or batch jobs, in addition to those detected. */
  systemResources?: string[];
  /** Share of human waits on a transition counted as normal (default 0.75). */
  normalWaitPercentile?: number;
  /** Working hours to use instead of the discovered ones. */
  calendar?: WorkCalendar;
}

export const WAIT_HUMAN = 0;
export const WAIT_INSTANT = 1;
export const WAIT_BATCH = 2;
export const WAIT_SCHEDULED = 3;
export type WaitKindCode = typeof WAIT_HUMAN | typeof WAIT_INSTANT | typeof WAIT_BATCH | typeof WAIT_SCHEDULED;

/** A step done for many cases at once. `id` is stable and safe to cite. */
export interface BatchStep {
  id: string;
  activity: string;
  resource: string | null;
  /** Distinct instants the batch ran. */
  runs: number;
  /** Events that were part of a run. */
  events: number;
  casesPerRun: number;
  runsPerWeek: number;
  /** Median calendar wait before a batched event, in hours. */
  medianWaitHours: number;
}

/**
 * What was detected on a whole log: its calendar, date steps, systems and
 * batch runs. The explorer detects it once and reuses it on every filtered
 * subset, so a batch of 50 invoices filtered to one vendor is still a batch.
 */
export interface WaitContext {
  calendar: WorkCalendar;
  calendarSource: "configured" | "discovered" | "default";
  /** Share of human events that fall inside the calendar's working hours. */
  calendarCoverage: number;
  scheduled: { activity: string; source: "detected" | "set"; evidence: string }[];
  systemResources: { resource: string; source: "name" | "batches" | "set"; evidence: string }[];
  /** Batch-run instants, keyed by `runKey`. */
  runs: Set<string>;
}

export interface WaitClassification extends WaitContext {
  batches: BatchStep[];
  /** Per case, the kind of wait before each event (index 0 is the case start and unused). */
  kinds: Uint8Array[];
}

/** One instant of one step by one resource, by name, so keys survive filtering. */
export const runKey = (activity: string, resource: string | null, t: number) => `${activity}\u0000${resource ?? ""}\u0000${t}`;

/** Resource names that are systems by convention. */
const SYSTEM_NAME = /^(system|sys|batch([_\s-]?\d+)?|auto(mat(ed|ic|ion))?|robot|bot|rpa|scheduler|job|cron|workflow|interface)$/i;
const INSTANT_MS = 60_000;
const MIN_BATCH_CASES = 3;

export const DEFAULT_NORMAL_WAIT_PERCENTILE = 0.75;

/** Detect the calendar, date steps, systems and batch runs of a log (see the file comment). */
export function detectWaitContext(log: EventLog, settings: AnalysisSettings = {}): WaitContext {
  const n = log.activities.length;

  // 1. Batch runs: the same step by the same resource for several cases at the same instant.
  const runCases = new Map<string, Set<number>>();
  log.cases.forEach((c, ci) => {
    for (const e of c.events) {
      const key = `${e.a}|${e.r}|${e.t}`;
      let s = runCases.get(key);
      if (!s) runCases.set(key, (s = new Set()));
      s.add(ci);
    }
  });
  const inRun = (a: number, r: number, t: number) => (runCases.get(`${a}|${r}|${t}`)?.size ?? 0) >= MIN_BATCH_CASES;

  // 2. System resources: by name, by being set, or by working mostly in runs.
  const system = new Map<number, { source: "name" | "batches" | "set"; evidence: string }>();
  const resourceEvents = new Float64Array(log.resources.length);
  const resourceBatched = new Float64Array(log.resources.length);
  for (const c of log.cases) {
    for (const e of c.events) {
      if (e.r === NO_RESOURCE) continue;
      resourceEvents[e.r]! += 1;
      if (inRun(e.a, e.r, e.t)) resourceBatched[e.r]! += 1;
    }
  }
  const setSystem = new Set(settings.systemResources ?? []);
  log.resources.forEach((name, r) => {
    const share = resourceEvents[r]! ? resourceBatched[r]! / resourceEvents[r]! : 0;
    if (setSystem.has(name)) system.set(r, { source: "set", evidence: "marked as a system" });
    else if (SYSTEM_NAME.test(name.trim())) system.set(r, { source: "name", evidence: `named "${name}"` });
    else if (resourceEvents[r]! >= 20 && share >= 0.8) {
      system.set(r, { source: "batches", evidence: `${Math.round(share * 100)}% of its ${resourceEvents[r]!.toLocaleString("en")} steps are in batch runs` });
    }
  });

  // 3. Candidate date steps: nearly every timestamp at one or two times of day, on whole seconds.
  const perActivity = Array.from({ length: n }, () => ({ count: 0, wholeSecond: 0, times: new Map<number, number>() }));
  let allEvents = 0;
  const logTimes = new Map<number, number>();
  for (const c of log.cases) {
    for (const e of c.events) {
      const s = perActivity[e.a]!;
      const tod = ((e.t % DAY_MS) + DAY_MS) % DAY_MS;
      s.count++;
      if (tod % 1000 === 0) s.wholeSecond++;
      s.times.set(tod, (s.times.get(tod) ?? 0) + 1);
      logTimes.set(tod, (logTimes.get(tod) ?? 0) + 1);
      allEvents++;
    }
  }
  const topTwoShare = (m: Map<number, number>, total: number) => {
    const top = [...m.values()].sort((x, y) => y - x);
    return total ? ((top[0] ?? 0) + (top[1] ?? 0)) / total : 0;
  };
  // In a date-only log every step looks like a date; nothing then tells them apart.
  const dateOnlyLog = topTwoShare(logTimes, allEvents) >= 0.8;
  const candidates = new Set<number>();
  if (!dateOnlyLog) {
    perActivity.forEach((s, a) => {
      if (s.count >= 20 && s.wholeSecond / s.count >= 0.95 && topTwoShare(s.times, s.count) >= 0.95) candidates.add(a);
    });
  }

  // 4. Working calendar from human steps (not batched, not by a system, not a date step).
  const humanTimes: number[] = [];
  for (const c of log.cases) {
    for (const e of c.events) {
      if (candidates.has(e.a) || system.has(e.r) || inRun(e.a, e.r, e.t)) continue;
      humanTimes.push(e.t);
    }
  }
  const discovered = settings.calendar ? null : discoverWorkCalendar(humanTimes);
  const calendar = settings.calendar ?? discovered!.calendar;
  validateWorkCalendar(calendar);

  // 5. Scheduled steps: candidates whose usual time is local midnight (a date typed in), plus overrides.
  const scheduled = new Map<number, { source: "detected" | "set"; evidence: string }>();
  const notScheduled = new Set(settings.notScheduled ?? []);
  for (const a of candidates) {
    const s = perActivity[a]!;
    const [tod, count] = [...s.times.entries()].sort((x, y) => y[1] - x[1])[0]!;
    const localHour = (((tod + calendar.utcOffsetMinutes * 60_000) % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS;
    // Within an hour of midnight allows for daylight saving, which the calendar doesn't model.
    if ((localHour <= 1 || localHour >= 23) && !notScheduled.has(log.activities[a]!)) {
      const top2 = Math.round(topTwoShare(s.times, s.count) * 100);
      scheduled.set(a, {
        source: "detected",
        evidence: `${top2}% of its ${s.count.toLocaleString("en")} timestamps fall at local midnight (most at ${hhmm(tod)} UTC, ${Math.round((count / s.count) * 100)}%): calendar dates, not times`,
      });
    }
  }
  for (const name of settings.scheduledActivities ?? []) {
    const a = log.activities.indexOf(name);
    if (a >= 0 && !notScheduled.has(name)) scheduled.set(a, { source: "set", evidence: "marked as happening on a planned date" });
  }

  const runs = new Set<string>();
  for (const [key, cases] of runCases) {
    if (cases.size < MIN_BATCH_CASES) continue;
    const [a, r, t] = key.split("|").map(Number) as [number, number, number];
    runs.add(runKey(log.activities[a]!, r === NO_RESOURCE ? null : log.resources[r]!, t));
  }
  const coverage = humanTimes.length ? humanTimes.filter((t) => workingMs(t - 1, t, calendar) > 0).length / humanTimes.length : 0;
  return {
    calendar,
    calendarSource: settings.calendar ? "configured" : discovered!.source,
    calendarCoverage: coverage,
    scheduled: [...scheduled.entries()].map(([a, v]) => ({ activity: log.activities[a]!, ...v })),
    systemResources: [...system.entries()].map(([r, v]) => ({ resource: log.resources[r]!, ...v })),
    runs,
  };
}

/**
 * The kind of every wait in the log, and its batch steps. Pass the context
 * detected on the full log when classifying a filtered subset of it.
 */
export function classifyWaits(log: EventLog, settings: AnalysisSettings = {}, context?: WaitContext): WaitClassification {
  const ctx = context ?? detectWaitContext(log, settings);
  const scheduledNames = new Set(ctx.scheduled.map((x) => x.activity));
  const systemNames = new Set(ctx.systemResources.map((x) => x.resource));
  const scheduled = new Set(log.activities.flatMap((name, a) => (scheduledNames.has(name) ? [a] : [])));
  const system = new Set(log.resources.flatMap((name, r) => (systemNames.has(name) ? [r] : [])));
  const inRun = (a: number, r: number, t: number) => ctx.runs.has(runKey(log.activities[a]!, r === NO_RESOURCE ? null : log.resources[r]!, t));

  const runStats = new Map<string, { a: number; r: number; times: Set<number>; events: number; waits: number[] }>();
  const kinds = log.cases.map((c) => {
    const k = new Uint8Array(c.events.length);
    for (let i = 1; i < c.events.length; i++) {
      const e = c.events[i]!;
      const prev = c.events[i - 1]!;
      const wait = (e.s ?? e.t) - prev.t;
      if (scheduled.has(e.a)) k[i] = WAIT_SCHEDULED;
      else if (inRun(e.a, e.r, e.t) || system.has(e.r)) k[i] = WAIT_BATCH;
      else if (wait < INSTANT_MS) k[i] = WAIT_INSTANT;
      else k[i] = WAIT_HUMAN;
    }
    for (let i = 0; i < c.events.length; i++) {
      const e = c.events[i]!;
      if (scheduled.has(e.a) || !inRun(e.a, e.r, e.t)) continue;
      const key = `${e.a}|${e.r}`;
      let s = runStats.get(key);
      if (!s) runStats.set(key, (s = { a: e.a, r: e.r, times: new Set(), events: 0, waits: [] }));
      s.times.add(e.t);
      s.events++;
      if (i > 0) s.waits.push(e.t - c.events[i - 1]!.t);
    }
    return k;
  });

  const batches: BatchStep[] = [...runStats.values()]
    .map((s) => {
      const times = [...s.times].sort((x, y) => x - y);
      const weeks = Math.max(1, (times[times.length - 1]! - times[0]!) / (7 * DAY_MS));
      const waits = s.waits.sort((x, y) => x - y);
      const activity = log.activities[s.a]!;
      const resource = s.r === NO_RESOURCE ? null : log.resources[s.r]!;
      return {
        id: `batch:${activity}@${resource ?? "(no resource)"}`,
        activity,
        resource,
        runs: times.length,
        events: s.events,
        casesPerRun: s.events / times.length,
        runsPerWeek: times.length / weeks,
        medianWaitHours: waits.length ? waits[Math.floor((waits.length - 1) / 2)]! / HOUR_MS : 0,
      };
    })
    .sort((x, y) => y.events - x.events || x.id.localeCompare(y.id));

  return { ...ctx, batches, kinds };
}

const hhmm = (tod: number) => new Date(tod).toISOString().slice(11, 16);

/**
 * Working hours learned from when people act, after Martin et al. (2020) and
 * López-Pintado & Dumas (2023), simplified to one calendar for the whole log:
 * the hours of day holding at least `minHourShare` of human events form the
 * working day, and weekdays holding at least `minDayShare` are working days.
 * The UTC offset is chosen so the working day centres on 13:00 local. Too few
 * events (under 200) fall back to Monday–Friday 9–17 UTC.
 */
export function discoverWorkCalendar(
  times: readonly number[],
  opts: { minHourShare?: number; minDayShare?: number } = {},
): { calendar: WorkCalendar; source: "discovered" | "default" } {
  if (times.length < 200) return { calendar: DEFAULT_WORK_CALENDAR, source: "default" };
  const minHour = opts.minHourShare ?? 0.02;
  const minDay = opts.minDayShare ?? 0.05;

  const hours = new Float64Array(24);
  for (const t of times) hours[Math.floor((((t % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS)]! += 1;
  const active = Array.from(hours, (c) => c / times.length >= minHour);
  if (!active.some(Boolean)) return { calendar: DEFAULT_WORK_CALENDAR, source: "default" };

  // The working day is the circle of hours minus its longest run of quiet hours.
  let bestGapStart = 0;
  let bestGapLen = 0;
  for (let h = 0; h < 24; h++) {
    if (active[h]) continue;
    let len = 0;
    while (len < 24 && !active[(h + len) % 24]) len++;
    if (len > bestGapLen) [bestGapStart, bestGapLen] = [h, len];
  }
  const dayLen = 24 - bestGapLen;
  const startUtc = (bestGapStart + bestGapLen) % 24;
  // Local time = UTC + offset; centre the working day on 13:00 local.
  let offsetHours = Math.round(13 - (startUtc + dayLen / 2));
  offsetHours = ((((offsetHours + 12) % 24) + 24) % 24) - 12;
  const startHour = dayLen >= 22 ? 0 : (((startUtc + offsetHours) % 24) + 24) % 24;
  const endHour = dayLen >= 22 ? 24 : Math.min(24, startHour + dayLen);

  const days = new Float64Array(8);
  for (const t of times) {
    const local = t + offsetHours * HOUR_MS;
    days[((((Math.floor(local / DAY_MS) + 3) % 7) + 7) % 7) + 1]! += 1;
  }
  const workDays = [1, 2, 3, 4, 5, 6, 7].filter((d) => days[d]! / times.length >= minDay);
  return {
    calendar: { workDays: workDays.length ? workDays : [1, 2, 3, 4, 5], startHour, endHour, utcOffsetMinutes: offsetHours * 60 },
    source: "discovered",
  };
}

/** Read stored analysis settings; anything invalid is dropped rather than trusted. */
export function parseAnalysisSettings(input: unknown): AnalysisSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const names = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  const out: AnalysisSettings = {};
  for (const key of ["scheduledActivities", "notScheduled", "systemResources"] as const) {
    const list = names(src[key]);
    if (list.length) out[key] = list;
  }
  const p = src.normalWaitPercentile;
  if (typeof p === "number" && p >= 0.5 && p < 1) out.normalWaitPercentile = p;
  const cal = src.calendar as Record<string, unknown> | undefined;
  if (cal && typeof cal === "object") {
    const candidate = {
      workDays: Array.isArray(cal.workDays) ? (cal.workDays as unknown[]).filter((d): d is number => typeof d === "number") : [],
      startHour: Number(cal.startHour),
      endHour: Number(cal.endHour),
      utcOffsetMinutes: Number(cal.utcOffsetMinutes ?? 0),
    };
    try {
      validateWorkCalendar(candidate);
      if (Number.isFinite(candidate.utcOffsetMinutes)) out.calendar = candidate;
    } catch {
      // An unusable calendar falls back to discovery.
    }
  }
  return out;
}
