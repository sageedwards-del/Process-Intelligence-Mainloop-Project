import type { AttrValue, Attrs, RawEvent } from "./types.ts";

/**
 * Turning an uploaded table into events: guess which columns hold the case,
 * activity, timestamp and resource, parse timestamps, and report data-quality
 * problems before any analysis runs. Pure functions over strings, so the same
 * code runs in the browser (live preview) and on the server.
 */

/** A parsed file: header names and rows of raw cell strings. */
export interface Table {
  headers: string[];
  rows: string[][];
}

/**
 * How timestamps are written. `dmy` / `mdy` cover slash, dot and dash dates
 * like 13/02/2026 or 02/13/2026, with an optional time.
 */
export type TimestampFormat = "iso" | "dmy" | "mdy" | "epoch-s" | "epoch-ms";

/** Which column plays which role, by header name. Stored with the dataset. */
export interface ColumnMapping {
  caseId: string;
  activity: string;
  timestamp: string;
  resource: string | null;
  attributes: string[];
  timestampFormat: TimestampFormat;
}

export interface ParsedTimestamp {
  /** Epoch milliseconds (UTC). */
  t: number;
  /** No time of day was given. */
  dateOnly: boolean;
  /** The value carried a UTC offset or "Z"; otherwise it was read as UTC. */
  hasZone: boolean;
}

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const SLASH = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i;

function utc(y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  // Reject dates that roll over, such as 31 February.
  return new Date(t).getUTCDate() === d ? t : null;
}

/** Parse one timestamp in a known format. Returns null when it doesn't fit. */
export function parseTimestamp(value: string, format: TimestampFormat): ParsedTimestamp | null {
  const v = value.trim();
  if (v === "") return null;

  if (format === "epoch-s" || format === "epoch-ms") {
    if (!/^\d{9,13}(\.\d+)?$/.test(v)) return null;
    const n = Number(v);
    return { t: format === "epoch-s" ? n * 1000 : n, dateOnly: false, hasZone: true };
  }

  if (format === "iso") {
    const m = ISO.exec(v);
    if (!m) return null;
    const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
    const base = utc(+m[1]!, +m[2]!, +m[3]!, m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, ms);
    if (base === null) return null;
    const zone = m[8];
    let offsetMin = 0;
    if (zone && zone.toUpperCase() !== "Z") {
      const sign = zone[0] === "-" ? -1 : 1;
      const digits = zone.slice(1).replace(":", "");
      offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0));
    }
    return { t: base - offsetMin * 60_000, dateOnly: m[4] === undefined, hasZone: zone !== undefined };
  }

  const m = SLASH.exec(v);
  if (!m) return null;
  const a = +m[1]!;
  const b = +m[2]!;
  let y = +m[3]!;
  if (m[3]!.length === 2) y += y < 70 ? 2000 : 1900;
  let h = m[4] ? +m[4] : 0;
  const ampm = m[7]?.toUpperCase();
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === "PM" ? 12 : 0);
  }
  const [day, month] = format === "dmy" ? [a, b] : [b, a];
  const t = utc(y, month, day, h, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0);
  return t === null ? null : { t, dateOnly: m[4] === undefined, hasZone: false };
}

export interface FormatGuess {
  format: TimestampFormat;
  /** Share of non-empty sample values that parse in this format (0..1). */
  parsedShare: number;
  /** Day/month order couldn't be told apart from the data (no value has a part above 12). */
  ambiguous: boolean;
}

/** Pick the timestamp format that parses the most sample values. */
export function detectTimestampFormat(values: readonly string[]): FormatGuess {
  const sample = values.map((v) => v.trim()).filter((v) => v !== "").slice(0, 500);
  if (sample.length === 0) return { format: "iso", parsedShare: 0, ambiguous: false };

  const share = (f: TimestampFormat) => sample.filter((v) => parseTimestamp(v, f) !== null).length / sample.length;
  const candidates: TimestampFormat[] = ["iso", "dmy", "mdy", /^\d{13}/.test(sample[0]!) ? "epoch-ms" : "epoch-s"];
  let best: FormatGuess = { format: "iso", parsedShare: -1, ambiguous: false };
  for (const f of candidates) {
    const s = share(f);
    // Ties go to the earlier candidate: ISO, then day-first (the European default).
    if (s > best.parsedShare) best = { format: f, parsedShare: s, ambiguous: false };
  }
  if (best.format === "dmy" || best.format === "mdy") {
    best.ambiguous = share("dmy") === share("mdy");
  }
  return best;
}

const HINTS: Record<"caseId" | "activity" | "timestamp" | "resource", RegExp[]> = {
  caseId: [/^case:concept:name$/i, /^case[\s_-]?(id|key|number|no)?$/i, /(ticket|order|invoice|claim|request|incident|application)[\s_-]?(id|key|number|no)?$/i, /^id$/i],
  activity: [/^concept:name$/i, /^(activity|event|step|action|task|status)([\s_-]?name)?$/i, /activity|event[\s_-]?name/i],
  timestamp: [/^time:timestamp$/i, /^(timestamp|ts|datetime|date[\s_-]?time|event[\s_-]?time|time)$/i, /time|date/i],
  resource: [/^org:resource$/i, /^(resource|user|agent|owner|performer|employee|assignee|actor|handled[\s_-]?by)$/i, /resource|user|agent|owner/i],
};

/**
 * Guess the column roles from header names, checked against the data: the
 * timestamp column must mostly parse, the activity column must repeat. Empty
 * strings mean "not found"; the person uploading confirms or fixes the guess.
 */
export function guessMapping(table: Table): ColumnMapping {
  const { headers, rows } = table;
  const sampleRows = rows.slice(0, 500);
  const column = (i: number) => sampleRows.map((r) => r[i] ?? "");
  // Activity columns repeat a short list of step names.
  const repeats = (i: number) => {
    const vals = column(i).filter((v) => v.trim() !== "");
    const distinct = new Set(vals).size;
    return distinct <= 20 || distinct / Math.max(vals.length, 1) < 0.5;
  };
  const used = new Set<number>();

  const pick = (role: keyof typeof HINTS, accept: (i: number) => boolean): number => {
    for (const re of HINTS[role]) {
      const i = headers.findIndex((h, idx) => !used.has(idx) && re.test(h.trim()) && accept(idx));
      if (i >= 0) {
        used.add(i);
        return i;
      }
    }
    return -1;
  };

  let ts = pick("timestamp", (i) => detectTimestampFormat(column(i)).parsedShare >= 0.8);
  if (ts < 0) {
    // No telling header: take the first column whose values parse as dates.
    ts = headers.findIndex((_, i) => !used.has(i) && detectTimestampFormat(column(i)).parsedShare >= 0.9);
    if (ts >= 0) used.add(ts);
  }
  const caseId = pick("caseId", () => true);
  const activity = pick("activity", repeats);
  const resource = pick("resource", () => true);

  return {
    caseId: headers[caseId] ?? "",
    activity: headers[activity] ?? "",
    timestamp: headers[ts] ?? "",
    resource: resource >= 0 ? headers[resource]! : null,
    attributes: headers.filter((_, i) => !used.has(i)),
    timestampFormat: ts >= 0 ? detectTimestampFormat(column(ts)).format : "iso",
  };
}

export type IssueSeverity = "error" | "warning" | "info";

export interface QualityIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** Rows, events, cases or names affected (see detail). */
  count: number;
  /** Up to five example file line numbers (header is line 1), or example names. */
  examples: (number | string)[];
}

export interface DataQualityReport {
  rows: number;
  eventsKept: number;
  cases: number;
  activities: number;
  resources: number;
  /** Epoch ms of the earliest and latest kept event, or null when nothing was kept. */
  firstEvent: number | null;
  lastEvent: number | null;
  issues: QualityIssue[];
}

export interface IngestResult {
  events: RawEvent[];
  report: DataQualityReport;
}

const NUMBER = /^-?\d+(\.\d+)?$/;

function cellValue(raw: string | undefined): AttrValue {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  return NUMBER.test(v) && v.length < 16 ? Number(v) : v;
}

/**
 * Apply a column mapping: build events (dropping rows that can't be used) and
 * a data-quality report explaining what was dropped and what to double-check.
 */
export function ingestTable(table: Table, mapping: ColumnMapping): IngestResult {
  const idx = (name: string | null) => (name ? table.headers.indexOf(name) : -1);
  const ci = idx(mapping.caseId);
  const ai = idx(mapping.activity);
  const ti = idx(mapping.timestamp);
  const ri = idx(mapping.resource);
  const attrCols = mapping.attributes.map((a) => [a, idx(a)] as const).filter(([, i]) => i >= 0);
  if (ci < 0 || ai < 0 || ti < 0) throw new Error("Choose the case, activity and timestamp columns first.");

  const missing: number[] = [];
  const badTime: number[] = [];
  const events: RawEvent[] = [];
  let dateOnly = 0;
  let noZone = 0;

  table.rows.forEach((row, r) => {
    const line = r + 2;
    const caseId = (row[ci] ?? "").trim();
    const activity = (row[ai] ?? "").trim();
    const rawTs = row[ti] ?? "";
    if (!caseId || !activity || !rawTs.trim()) {
      missing.push(line);
      return;
    }
    const ts = parseTimestamp(rawTs, mapping.timestampFormat);
    if (!ts) {
      badTime.push(line);
      return;
    }
    if (ts.dateOnly) dateOnly++;
    if (!ts.hasZone) noZone++;
    const ev: RawEvent = { caseId, activity, timestamp: ts.t };
    const resource = ri >= 0 ? (row[ri] ?? "").trim() : "";
    if (resource) ev.resource = resource;
    if (attrCols.length) {
      const attrs: Attrs = {};
      for (const [name, i] of attrCols) attrs[name] = cellValue(row[i]);
      ev.attrs = attrs;
    }
    events.push(ev);
  });

  const issues: QualityIssue[] = [];
  const add = (issue: QualityIssue) => issue.count > 0 && issues.push(issue);
  add({
    id: "missing-values",
    severity: "error",
    title: "Rows missing a case, activity or timestamp",
    detail: "These rows were left out: an event needs all three.",
    count: missing.length,
    examples: missing.slice(0, 5),
  });
  add({
    id: "unparseable-timestamps",
    severity: "error",
    title: "Timestamps that couldn't be read",
    detail: `These rows were left out. They don't match the chosen format (${mapping.timestampFormat}); check the format setting.`,
    count: badTime.length,
    examples: badTime.slice(0, 5),
  });

  const n = events.length;
  if (n > 0 && dateOnly / n >= 0.95) {
    add({
      id: "date-only",
      severity: "warning",
      title: "Timestamps have no time of day",
      detail:
        "Waits can only be measured in whole days, and events on the same day keep the order they have in the file.",
      count: dateOnly,
      examples: [],
    });
  }
  if (noZone > 0) {
    add({
      id: "no-timezone",
      severity: "info",
      title: "Timestamps have no time zone",
      detail: "They were read as UTC. Durations are unaffected unless the data crosses a daylight-saving change.",
      count: noZone,
      examples: [],
    });
  }
  if (mapping.timestampFormat === "dmy" || mapping.timestampFormat === "mdy") {
    const values = table.rows.map((row) => row[ti] ?? "");
    if (detectTimestampFormat(values).ambiguous) {
      add({
        id: "ambiguous-dates",
        severity: "warning",
        title: "Day and month order can't be confirmed",
        detail: `No date in the file has a day above 12, so 03/04 could be 3 April or 4 March. Read as ${
          mapping.timestampFormat === "dmy" ? "day/month" : "month/day"
        }; switch the format if that's wrong.`,
        count: 1,
        examples: [],
      });
    }
  }

  // Per-case checks.
  const byCase = new Map<string, RawEvent[]>();
  for (const ev of events) {
    let list = byCase.get(ev.caseId);
    if (!list) byCase.set(ev.caseId, (list = []));
    list.push(ev);
  }
  let sameTime = 0;
  let duplicates = 0;
  const singleCases: string[] = [];
  for (const [id, list] of byCase) {
    if (list.length === 1) singleCases.push(id);
    const seen = new Set<string>();
    const times = new Map<number, number>();
    for (const ev of list) {
      const key = `${ev.activity}\u0000${ev.timestamp}`;
      if (seen.has(key)) duplicates++;
      seen.add(key);
      times.set(ev.timestamp, (times.get(ev.timestamp) ?? 0) + 1);
    }
    for (const c of times.values()) if (c > 1) sameTime += c;
  }
  add({
    id: "duplicate-events",
    severity: "warning",
    title: "Duplicate events",
    detail: "The same activity at the same time in the same case appears more than once. They may be double-exported rows.",
    count: duplicates,
    examples: [],
  });
  if (dateOnly / Math.max(n, 1) < 0.95) {
    add({
      id: "same-timestamp",
      severity: "warning",
      title: "Events sharing a timestamp within a case",
      detail: "Their order can't be told from the data, so the file order is used. This often means batch or system-generated timestamps.",
      count: sameTime,
      examples: [],
    });
  }
  add({
    id: "single-event-cases",
    severity: "warning",
    title: "Cases with only one event",
    detail: "They contribute no paths or waits. A wrong case column, or cases cut off by the export window, are common causes.",
    count: singleCases.length,
    examples: singleCases.slice(0, 5),
  });

  // Activity names that differ only in case or spacing are probably the same step.
  const groups = new Map<string, Set<string>>();
  for (const ev of events) {
    const key = ev.activity.toLowerCase().replace(/\s+/g, " ");
    let g = groups.get(key);
    if (!g) groups.set(key, (g = new Set()));
    g.add(ev.activity);
  }
  const variants = [...groups.values()].filter((g) => g.size > 1).map((g) => [...g].join(" / "));
  add({
    id: "activity-variants",
    severity: "warning",
    title: "Activity names that look like the same step",
    detail: "They differ only in capitalisation or spacing, so the map shows them as separate steps.",
    count: variants.length,
    examples: variants.slice(0, 5),
  });
  const activityCount = new Set(events.map((e) => e.activity)).size;
  add({
    id: "many-activities",
    severity: "warning",
    title: "Unusually many distinct activities",
    detail: "Over 150 different activity names. Check that the activity column holds step names, not free text or IDs.",
    count: activityCount > 150 ? activityCount : 0,
    examples: [],
  });

  let first = Infinity;
  let last = -Infinity;
  for (const ev of events) {
    if (ev.timestamp < first) first = ev.timestamp;
    if (ev.timestamp > last) last = ev.timestamp;
  }
  const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((x, y) => order[x.severity] - order[y.severity]);

  return {
    events,
    report: {
      rows: table.rows.length,
      eventsKept: n,
      cases: byCase.size,
      activities: activityCount,
      resources: new Set(events.map((e) => e.resource).filter(Boolean)).size,
      firstEvent: n ? first : null,
      lastEvent: n ? last : null,
      issues,
    },
  };
}
