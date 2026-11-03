"use client";

import {
  buildLog,
  guessMapping,
  ingestTable,
  summarize,
  tableFromGrid,
  tableFromRecords,
  XES_COLUMNS,
  xesMapping,
  type RecordValue,
  type ColumnMapping,
  type DataQualityReport,
  type IssueSeverity,
  type Table,
  type TimestampFormat,
} from "@throughline/engine";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import type { XesImportResult } from "@/app/api/import/xes/route";
import { encodeSnapshot } from "@/lib/snapshot";
import { createClient } from "@/lib/supabase/client";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "@/lib/uploadLimit";

const FORMATS: { value: TimestampFormat; label: string }[] = [
  { value: "iso", label: "ISO 8601 (2026-03-02 09:00)" },
  { value: "dmy", label: "Day first (13/02/2026)" },
  { value: "mdy", label: "Month first (02/13/2026)" },
  { value: "epoch-s", label: "Unix seconds" },
  { value: "epoch-ms", label: "Unix milliseconds" },
];

type Format = "csv" | "xlsx" | "xes";

type Sheet = { name: string; table: Table };

type Loaded = {
  file: File;
  format: Format;
  table: Table;
  /** Excel only: every sheet with data, and the one in use. */
  sheets?: Sheet[];
  sheet?: string;
  /** Said once above the mapping, e.g. events the XES importer dropped. */
  note?: string;
  /** XES only: the dataset row and raw file were created before import (the miner reads the file from Storage). */
  datasetId?: string;
  sourcePath?: string;
};

const EXTENSION = /\.(csv|xlsx|xes|xes\.gz)$/i;

function formatOf(name: string): Format | null {
  const ext = EXTENSION.exec(name)?.[1]?.toLowerCase();
  if (ext === "csv") return "csv";
  if (ext === "xlsx") return "xlsx";
  if (ext === "xes" || ext === "xes.gz") return "xes";
  return null;
}

/** Where the raw file is kept, and its content type. */
function rawUpload(file: File, format: Format): { name: string; contentType: string } {
  if (format === "xlsx") return { name: "source.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  if (format === "xes") {
    return /\.gz$/i.test(file.name)
      ? { name: "source.xes.gz", contentType: "application/gzip" }
      : { name: "source.xes", contentType: "application/xml" };
  }
  return { name: "source.csv", contentType: "text/csv" };
}

export function Uploader({ workspaceId }: { workspaceId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const router = useRouter();

  function load(next: Loaded, m: ColumnMapping = guessMapping(next.table)) {
    setLoaded(next);
    setMapping(m);
    setName(next.file.name.replace(EXTENSION, ""));
  }

  function readFile(file: File) {
    setError(null);
    const format = formatOf(file.name);
    if (!format) return setError("Choose a .csv, .xlsx, .xes or .xes.gz file.");
    if (file.size > MAX_UPLOAD_BYTES) return setError(`That file is over ${MAX_UPLOAD_LABEL}, the current upload limit.`);
    if (format === "xlsx") return void readExcel(file);
    if (format === "xes") return void readXes(file);
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (result) => {
        const [headers, ...rows] = result.data;
        if (!headers || rows.length === 0) return setError("The file needs a header row and at least one event.");
        load({ file, format, table: { headers: headers.map((h) => h.trim()), rows } });
      },
      error: (e) => setError(`Couldn't read the file: ${e.message}`),
    });
  }

  async function readExcel(file: File) {
    setReading("Reading the workbook…");
    try {
      const { default: readXlsxFile } = await import("read-excel-file/browser");
      const sheets = (await readXlsxFile(file))
        .map(({ sheet, data }) => ({ name: sheet, table: tableFromGrid(data as Parameters<typeof tableFromGrid>[0]) }))
        .filter((s) => s.table.rows.length > 0);
      if (sheets.length === 0) return setError("No sheet in that workbook has a header row and at least one event.");
      // Start on the sheet that looks most like an event log: most roles found, then most rows.
      const scored = sheets.map((s) => {
        const m = guessMapping(s.table);
        return { s, m, roles: [m.caseId, m.activity, m.timestamp].filter(Boolean).length };
      });
      const best = scored.reduce((a, b) => (b.roles > a.roles || (b.roles === a.roles && b.s.table.rows.length > a.s.table.rows.length) ? b : a));
      load({ file, format: "xlsx", table: best.s.table, sheets, sheet: best.s.name }, best.m);
    } catch (e) {
      setError(`Couldn't read the workbook: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(null);
    }
  }

  async function readXes(file: File) {
    // XES is parsed by the miner, which reads the file from Storage: files never pass through
    // a server function (Vercel caps bodies at 4.5 MB). So the dataset row and raw file come first.
    const supabase = createClient();
    let datasetId: string | null = null;
    let sourcePath: string | null = null;
    setReading("Uploading the XES log…");
    try {
      const { data: row, error: insertError } = await supabase
        .from("datasets")
        .insert({ workspace_id: workspaceId, name: file.name.replace(EXTENSION, ""), source_format: "xes", status: "uploaded" })
        .select("id")
        .single();
      if (insertError) throw insertError;
      datasetId = row.id as string;
      const target = rawUpload(file, "xes");
      sourcePath = `${workspaceId}/${datasetId}/${target.name}`;
      const raw = await supabase.storage.from("raw-uploads").upload(sourcePath, new Blob([file], { type: target.contentType }), { contentType: target.contentType });
      if (raw.error) throw raw.error;
      const { error: pathError } = await supabase.from("datasets").update({ source_path: sourcePath }).eq("id", datasetId);
      if (pathError) throw pathError;

      setReading("Reading the XES log on the mining service…");
      const res = await fetch("/api/import/xes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId }),
      }).catch(() => null);
      if (!res) throw new Error("Couldn't reach the server. Check your connection and try again.");
      const json = (await res.json().catch(() => null)) as (XesImportResult & { error?: string }) | null;
      if (!res.ok || !json?.resultPath) throw new Error(json?.error ?? `The XES import failed (${res.status}).`);

      const { data: packed, error: downloadError } = await supabase.storage.from("raw-uploads").download(json.resultPath);
      if (downloadError || !packed) throw new Error("Couldn't read the imported events back from storage.");
      const text = await new Response(packed.stream().pipeThrough(new DecompressionStream("gzip"))).text();
      const { events } = JSON.parse(text) as { events: Record<string, RecordValue>[] };
      if (events.length === 0) throw new Error("That XES log has no events.");
      const table = tableFromRecords(events, [XES_COLUMNS.caseId, XES_COLUMNS.activity, XES_COLUMNS.timestamp, XES_COLUMNS.resource]);
      const dropped = json.droppedEvents;
      const note =
        dropped > 0
          ? `${dropped.toLocaleString("en")} events had no case, activity or timestamp and were left out on import.`
          : undefined;
      load({ file, format: "xes", table, note, datasetId, sourcePath }, xesMapping(table));
    } catch (e) {
      if (datasetId) void discardUpload(datasetId, sourcePath);
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setReading(null);
    }
  }

  /** Removes an XES upload that failed or was abandoned before saving (row and files). */
  async function discardUpload(datasetId: string, sourcePath: string | null) {
    const supabase = createClient();
    const dir = `${workspaceId}/${datasetId}`;
    await supabase.storage.from("raw-uploads").remove([...(sourcePath ? [sourcePath] : []), `${dir}/xes.json.gz`]);
    await supabase.from("datasets").delete().eq("id", datasetId);
  }

  if (!loaded || !mapping) {
    return (
      <div>
        <label
          aria-busy={reading !== null}
          className={`dot-grid flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line px-6 py-20 text-center transition ${reading ? "opacity-70" : "cursor-pointer hover:border-primary"}`}
        >
          <span className="text-lg font-medium">{reading ?? "Choose an event log"}</span>
          <span className="mt-2 text-sm text-ink-muted">
            CSV or Excel with one row per event and a header row, or an XES log (.xes, .xes.gz). Up to {MAX_UPLOAD_LABEL}.
          </span>
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xes,.gz"
            disabled={reading !== null}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) readFile(f);
            }}
          />
        </label>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    );
  }

  async function save({ table, file, format, sheet, ...uploaded }: Loaded, m: ColumnMapping) {
    const supabase = createClient();
    setError(null);
    let datasetId: string | null = uploaded.datasetId ?? null;
    try {
      setSaving("Creating the dataset…");
      const { events, report } = ingestTable(table, m);
      const fields = { name: name.trim() || file.name, source_format: format, column_mapping: sheet ? { ...m, sheet } : m, status: "parsing" as const };
      let sourcePath = uploaded.sourcePath ?? null;
      if (datasetId) {
        // XES: the row and raw file already exist.
        const { error: updateError } = await supabase.from("datasets").update(fields).eq("id", datasetId);
        if (updateError) throw updateError;
      } else {
        const { data: row, error: insertError } = await supabase
          .from("datasets")
          .insert({ workspace_id: workspaceId, ...fields })
          .select("id")
          .single();
        if (insertError) throw insertError;
        datasetId = row.id as string;
      }

      if (!sourcePath) {
        setSaving("Uploading the original file…");
        const target = rawUpload(file, format);
        sourcePath = `${workspaceId}/${datasetId}/${target.name}`;
        // supabase-js sends a Blob's own type, not `contentType`, and browsers leave it empty for .xes.
        const body = new Blob([file], { type: target.contentType });
        const raw = await supabase.storage.from("raw-uploads").upload(sourcePath, body, { contentType: target.contentType });
        if (raw.error) throw raw.error;
      }

      setSaving("Building the event log…");
      const log = buildLog(events);
      const snapshotPath = `${workspaceId}/${datasetId}/log.json.gz`;
      const snap = await supabase.storage
        .from("snapshots")
        .upload(snapshotPath, await encodeSnapshot(log), { contentType: "application/gzip" });
      if (snap.error) throw snap.error;

      const stats = {
        ...summarize(log),
        quality: report.issues.map(({ id, severity, count }) => ({ id, severity, count })),
      };
      const { error: updateError } = await supabase
        .from("datasets")
        .update({ source_path: sourcePath, snapshot_path: snapshotPath, stats, status: "ready" })
        .eq("id", datasetId);
      if (updateError) throw updateError;

      router.push("/app");
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      if (datasetId) await supabase.from("datasets").update({ status: "error", error: message }).eq("id", datasetId);
      setError(`Saving failed: ${message}`);
      setSaving(null);
    }
  }

  return (
    <MappingStep
      loaded={loaded}
      mapping={mapping}
      onMapping={setMapping}
      name={name}
      onName={setName}
      saving={saving}
      error={error}
      onReset={() => {
        if (loaded.datasetId) void discardUpload(loaded.datasetId, loaded.sourcePath ?? null);
        setLoaded(null);
        setMapping(null);
      }}
      onSheet={(name) => {
        const s = loaded.sheets?.find((x) => x.name === name);
        if (!s) return;
        setLoaded({ ...loaded, table: s.table, sheet: s.name });
        setMapping(guessMapping(s.table));
      }}
      onSave={() => save(loaded, mapping)}
    />
  );
}

function MappingStep(props: {
  loaded: Loaded;
  mapping: ColumnMapping;
  onMapping: (m: ColumnMapping) => void;
  name: string;
  onName: (n: string) => void;
  saving: string | null;
  error: string | null;
  onReset: () => void;
  onSheet: (name: string) => void;
  onSave: () => void;
}) {
  const { loaded, mapping, onMapping } = props;
  const { headers, rows } = loaded.table;
  const deferred = useDeferredValue(mapping);
  const ready = Boolean(deferred.caseId && deferred.activity && deferred.timestamp);
  const report = useMemo<DataQualityReport | null>(
    () => (ready ? ingestTable(loaded.table, deferred).report : null),
    [ready, loaded.table, deferred],
  );

  // Changing a role frees its old column for use as an attribute, and vice versa.
  const setRole = (role: "caseId" | "activity" | "timestamp" | "resource" | "eventId" | "lifecycle", column: string) => {
    const optional = role === "resource" || role === "eventId" || role === "lifecycle";
    const next = { ...mapping, [role]: optional && column === "" ? null : column };
    const roles = new Set([next.caseId, next.activity, next.timestamp, next.resource, next.eventId, next.lifecycle].filter(Boolean));
    next.attributes = headers.filter((h) => !roles.has(h) && (mapping.attributes.includes(h) || h === mapping[role]));
    onMapping(next);
  };

  const canSave = ready && report !== null && report.eventsKept > 0 && !props.saving;

  return (
    <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-medium">1. Map the columns</h2>
          <button type="button" onClick={props.onReset} className="text-sm text-primary underline-offset-4 hover:underline">
            Choose another file
          </button>
        </div>
        <p className="mt-2 text-sm text-ink-muted">
          <span className="font-mono">{loaded.file.name}</span> · {rows.length.toLocaleString("en")} rows ·{" "}
          {headers.length} columns. Guesses are filled in; check them.
        </p>
        {loaded.note && <p className="mt-2 text-sm text-ink-muted">{loaded.note}</p>}

        {loaded.sheets && loaded.sheets.length > 1 && (
          <label className="mt-6 block">
            <span className="eyebrow text-[0.65rem] text-ink-faint">Sheet</span>
            <select
              value={loaded.sheet}
              onChange={(e) => props.onSheet(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2.5"
            >
              {loaded.sheets.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.table.rows.length.toLocaleString("en")} rows)
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <RoleSelect label="Case ID" required value={mapping.caseId} headers={headers} onChange={(v) => setRole("caseId", v)} />
          <RoleSelect label="Activity" required value={mapping.activity} headers={headers} onChange={(v) => setRole("activity", v)} />
          <RoleSelect label="Timestamp" required value={mapping.timestamp} headers={headers} onChange={(v) => setRole("timestamp", v)} />
          <RoleSelect label="Resource (person or team)" value={mapping.resource ?? ""} headers={headers} onChange={(v) => setRole("resource", v)} />
          <RoleSelect
            label="Event or line ID"
            hint="Tells a double export from items recorded in the same second."
            value={mapping.eventId ?? ""}
            headers={headers}
            onChange={(v) => setRole("eventId", v)}
          />
          <RoleSelect
            label="Lifecycle (start / complete)"
            hint="With start events, working time is measured apart from waiting."
            value={mapping.lifecycle ?? ""}
            headers={headers}
            onChange={(v) => setRole("lifecycle", v)}
          />
          <label className="block sm:col-span-2">
            <span className="eyebrow text-[0.65rem] text-ink-faint">Timestamp format</span>
            <select
              value={mapping.timestampFormat}
              onChange={(e) => onMapping({ ...mapping, timestampFormat: e.target.value as TimestampFormat })}
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2.5"
            >
              {FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {headers.length > 3 && (
          <fieldset className="mt-6">
            <legend className="eyebrow text-[0.65rem] text-ink-faint">Other columns to keep as attributes</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {headers
                .filter((h) => ![mapping.caseId, mapping.activity, mapping.timestamp, mapping.resource, mapping.eventId, mapping.lifecycle].includes(h))
                .map((h) => {
                  const on = mapping.attributes.includes(h);
                  return (
                    <label
                      key={h}
                      className={`cursor-pointer rounded-md border px-3 py-1.5 font-mono text-sm ${on ? "border-primary text-primary" : "border-line text-ink-faint"}`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() =>
                          onMapping({ ...mapping, attributes: on ? mapping.attributes.filter((a) => a !== h) : [...mapping.attributes, h] })
                        }
                      />
                      {h}
                    </label>
                  );
                })}
            </div>
          </fieldset>
        )}

        <div className="mt-8 overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-bg text-ink-faint">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-normal">
                    {h}
                    {h === mapping.caseId && <Role>case</Role>}
                    {h === mapping.activity && <Role>activity</Role>}
                    {h === mapping.timestamp && <Role>time</Role>}
                    {h === mapping.resource && <Role>resource</Role>}
                    {h === mapping.eventId && <Role>event ID</Role>}
                    {h === mapping.lifecycle && <Role>lifecycle</Role>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {headers.map((h, j) => (
                    <td key={h} className="whitespace-nowrap px-3 py-2">
                      {r[j]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="min-w-0">
        <h2 className="text-xl font-medium">2. Check data quality</h2>
        {!report ? (
          <p className="mt-4 text-ink-muted">Choose the case, activity and timestamp columns to see the report.</p>
        ) : (
          <QualityReport report={report} />
        )}

        <div className="mt-10 border-t border-line pt-8">
          <h2 className="text-xl font-medium">3. Save</h2>
          <label className="mt-4 block">
            <span className="eyebrow text-[0.65rem] text-ink-faint">Dataset name</span>
            <input
              value={props.name}
              onChange={(e) => props.onName(e.target.value)}
              maxLength={200}
              className="mt-1.5 w-full rounded-md border border-line bg-surface px-3 py-2.5"
            />
          </label>
          <button
            type="button"
            disabled={!canSave}
            onClick={props.onSave}
            className="eyebrow mt-4 w-full rounded-md bg-primary px-6 py-4 text-primary-ink transition hover:bg-primary-hover disabled:opacity-50"
          >
            {props.saving ?? (report ? `Create dataset (${report.eventsKept.toLocaleString("en")} events)` : "Create dataset")}
          </button>
          {props.error && <ErrorText>{props.error}</ErrorText>}
        </div>
      </div>
    </div>
  );
}

function RoleSelect(props: { label: string; required?: boolean; hint?: string; value: string; headers: string[]; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="eyebrow text-[0.65rem] text-ink-faint">
        {props.label}
        {props.required && " *"}
      </span>
      {props.hint && <span className="mt-0.5 block text-xs text-ink-faint">{props.hint}</span>}
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className={`mt-1.5 w-full rounded-md border bg-surface px-3 py-2.5 ${props.required && !props.value ? "border-[#b42318]" : "border-line"}`}
      >
        <option value="">{props.required ? "Choose a column…" : "None"}</option>
        {props.headers.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}

const SEVERITY: Record<IssueSeverity, string> = {
  error: "border-[#b42318] text-[#b42318]",
  warning: "border-[#b54708] text-[#b54708]",
  info: "border-line text-ink-faint",
};

function QualityReport({ report }: { report: DataQualityReport }) {
  const days =
    report.firstEvent !== null && report.lastEvent !== null
      ? Math.round((report.lastEvent - report.firstEvent) / 86_400_000)
      : 0;
  const stats: [string, string][] = [
    ["Events kept", `${report.eventsKept.toLocaleString("en")} of ${report.rows.toLocaleString("en")}`],
    ["Cases", report.cases.toLocaleString("en")],
    ["Activities", report.activities.toLocaleString("en")],
    ["Time span", `${days.toLocaleString("en")} days`],
  ];
  return (
    <div className="mt-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="eyebrow text-[0.6rem] text-ink-faint">{k}</dt>
            <dd className="mt-1 font-mono text-lg">{v}</dd>
          </div>
        ))}
      </dl>
      {report.issues.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">No problems found.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {report.issues.map((i) => (
            <li key={i.id} className="rounded-lg border border-line p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">{i.title}</p>
                <span className={`eyebrow shrink-0 rounded border px-2 py-0.5 text-[0.6rem] ${SEVERITY[i.severity]}`}>
                  {i.severity}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                {i.count > 1 && <span className="font-mono text-ink">{i.count.toLocaleString("en")} · </span>}
                {i.detail}
              </p>
              {i.examples.length > 0 && (
                <p className="mt-2 font-mono text-xs text-ink-faint">
                  {typeof i.examples[0] === "number" ? "Lines " : "e.g. "}
                  {i.examples.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Role({ children }: { children: string }) {
  return <span className="ml-1.5 rounded bg-primary px-1 py-0.5 text-[0.6rem] text-primary-ink">{children}</span>;
}

function ErrorText({ children }: { children: string }) {
  return (
    <p role="alert" className="mt-4 text-sm text-[#b42318]">
      {children}
    </p>
  );
}
