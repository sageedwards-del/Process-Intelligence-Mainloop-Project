import type { RawEvent } from "@throughline/engine";

/** Serialize events to CSV: case_id, activity, timestamp (ISO 8601 UTC), resource, then attributes. */
export function toCsv(rows: readonly RawEvent[]): string {
  const attrKeys = [...new Set(rows.flatMap((r) => Object.keys(r.attrs ?? {})))];
  const header = ["case_id", "activity", "timestamp", "resource", ...attrKeys];
  const lines = [header.join(",")];
  for (const r of rows) {
    const cells = [r.caseId, r.activity, new Date(r.timestamp).toISOString(), r.resource ?? "", ...attrKeys.map((k) => r.attrs?.[k] ?? "")];
    lines.push(cells.map(escape).join(","));
  }
  return lines.join("\n") + "\n";
}

function escape(v: unknown): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
