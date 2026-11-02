import { guessEventIdColumn, type ColumnMapping, type Table } from "./ingest.ts";

/**
 * Turning other upload formats into the `Table` the CSV path uses, so the
 * column mapping and data-quality report work the same for every format:
 * spreadsheet grids (Excel, read in the browser) and event records (XES,
 * imported by the miner service). Pure functions; no I/O.
 */

/** One spreadsheet cell as a reader returns it. Dates arrive as `Date`s whose UTC fields hold the cell's wall-clock time. */
export type GridCell = string | number | boolean | Date | null | undefined;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * A spreadsheet date as text. Excel stores no time zone, so the result has no
 * offset and is read as written. Readers that floor the serial to whole
 * milliseconds turn 10:00:00 into 09:59:59.999; values within a millisecond of
 * a whole second are rounded back.
 */
export function spreadsheetDateToString(d: Date, dateOnly = false): string {
  let t = d.getTime();
  if (Number.isNaN(t)) return "";
  const whole = Math.round(t / 1000) * 1000;
  if (Math.abs(t - whole) <= 1) t = whole;
  const u = new Date(t);
  const date = `${pad(u.getUTCFullYear(), 4)}-${pad(u.getUTCMonth() + 1)}-${pad(u.getUTCDate())}`;
  if (dateOnly) return date;
  const ms = u.getUTCMilliseconds();
  return `${date}T${pad(u.getUTCHours())}:${pad(u.getUTCMinutes())}:${pad(u.getUTCSeconds())}${ms ? `.${pad(ms, 3)}` : ""}`;
}

const isMidnight = (d: Date) => d.getTime() % 86_400_000 === 0;
const isBlank = (c: GridCell) => c === null || c === undefined || (typeof c === "string" && c.trim() === "");

/**
 * A sheet's rows as a `Table`. The first non-empty row is the header; blank
 * headers become "Column N" and repeated ones get a suffix. Empty rows and
 * empty trailing columns are dropped. A date column whose every value is
 * midnight is written as plain dates, so the report can say times are missing.
 */
export function tableFromGrid(grid: readonly (readonly GridCell[])[]): Table {
  const rows = grid.filter((r) => r.some((c) => !isBlank(c)));
  const [head, ...body] = rows;
  if (!head) return { headers: [], rows: [] };

  let width = 0;
  for (const r of rows) for (let i = r.length - 1; i >= width; i--) if (!isBlank(r[i])) width = i + 1;

  const dateOnly: boolean[] = [];
  for (let i = 0; i < width; i++) {
    let dates = 0;
    let midnight = 0;
    for (const r of body) {
      const c = r[i];
      if (c instanceof Date) {
        dates++;
        if (isMidnight(c)) midnight++;
      }
    }
    dateOnly.push(dates > 0 && dates === midnight);
  }

  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const h = cellToString(head[i], false).trim() || `Column ${i + 1}`;
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
  return {
    headers,
    rows: body.map((r) => Array.from({ length: width }, (_, i) => cellToString(r[i], dateOnly[i]!))),
  };
}

function cellToString(c: GridCell, dateOnly: boolean): string {
  if (c === null || c === undefined) return "";
  if (c instanceof Date) return spreadsheetDateToString(c, dateOnly);
  if (typeof c === "boolean") return c ? "true" : "false";
  return String(c);
}

/** A JSON scalar, as event attributes arrive from the miner. */
export type RecordValue = string | number | boolean | null | undefined;

/**
 * Event records (one object per event) as a `Table`. Columns follow `leading`,
 * then every other key in order of first appearance; missing values are empty.
 */
export function tableFromRecords(records: readonly Record<string, RecordValue>[], leading: readonly string[] = []): Table {
  const index = new Map<string, number>();
  for (const k of leading) if (!index.has(k)) index.set(k, index.size);
  for (const r of records) for (const k in r) if (!index.has(k)) index.set(k, index.size);
  const headers = [...index.keys()];
  const rows = records.map((r) => headers.map((h) => {
    const v = r[h];
    return v === null || v === undefined ? "" : typeof v === "boolean" ? (v ? "true" : "false") : String(v);
  }));
  return { headers, rows };
}

/** Columns of an XES log imported through the miner, which renames the standard XES keys. */
export const XES_COLUMNS = {
  caseId: "case_id",
  activity: "activity",
  timestamp: "timestamp",
  resource: "resource",
  lifecycle: "lifecycle:transition",
} as const;

/**
 * The mapping for an imported XES log. The standard keys are known, so only
 * the event id is guessed (`identity:id`, `EventID`…); the rest are attributes.
 */
export function xesMapping(table: Table): ColumnMapping {
  const has = (h: string) => table.headers.includes(h);
  const resourceIndex = table.headers.indexOf(XES_COLUMNS.resource);
  const resource = resourceIndex >= 0 && table.rows.some((r) => (r[resourceIndex] ?? "") !== "") ? XES_COLUMNS.resource : null;
  const lifecycle = has(XES_COLUMNS.lifecycle) ? XES_COLUMNS.lifecycle : null;
  const known = new Set<string>([XES_COLUMNS.caseId, XES_COLUMNS.activity, XES_COLUMNS.timestamp, XES_COLUMNS.resource, XES_COLUMNS.lifecycle]);
  const eventId = guessEventIdColumn(table, known);
  const roles = new Set([...known, eventId].filter(Boolean));
  return {
    caseId: XES_COLUMNS.caseId,
    activity: XES_COLUMNS.activity,
    timestamp: XES_COLUMNS.timestamp,
    resource,
    attributes: table.headers.filter((h) => !roles.has(h)),
    timestampFormat: "iso",
    eventId,
    lifecycle,
  };
}
