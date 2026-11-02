"use client";

import {
  buildLog,
  guessMapping,
  ingestTable,
  summarize,
  type ColumnMapping,
  type DataQualityReport,
  type IssueSeverity,
  type Table,
  type TimestampFormat,
} from "@throughline/engine";
import Papa from "papaparse";
import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { encodeSnapshot } from "@/lib/snapshot";
import { createClient } from "@/lib/supabase/client";

const MAX_BYTES = 100 * 1024 * 1024; // matches the storage bucket limit

const FORMATS: { value: TimestampFormat; label: string }[] = [
  { value: "iso", label: "ISO 8601 (2026-03-02 09:00)" },
  { value: "dmy", label: "Day first (13/02/2026)" },
  { value: "mdy", label: "Month first (02/13/2026)" },
  { value: "epoch-s", label: "Unix seconds" },
  { value: "epoch-ms", label: "Unix milliseconds" },
];

type Loaded = { file: File; table: Table };

export function Uploader({ workspaceId }: { workspaceId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const router = useRouter();

  function readFile(file: File) {
    setError(null);
    if (!/\.csv$/i.test(file.name)) return setError("Choose a .csv file. XES and Excel support is coming next.");
    if (file.size > MAX_BYTES) return setError("That file is over 100 MB, the current upload limit.");
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (result) => {
        const [headers, ...rows] = result.data;
        if (!headers || rows.length === 0) return setError("The file needs a header row and at least one event.");
        const table = { headers: headers.map((h) => h.trim()), rows };
        setLoaded({ file, table });
        setMapping(guessMapping(table));
        setName(file.name.replace(/\.csv$/i, ""));
      },
      error: (e) => setError(`Couldn't read the file: ${e.message}`),
    });
  }

  if (!loaded || !mapping) {
    return (
      <div>
        <label className="dot-grid flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line px-6 py-20 text-center transition hover:border-primary">
          <span className="text-lg font-medium">Choose a CSV file</span>
          <span className="mt-2 text-sm text-ink-muted">One row per event, with a header row. Up to 100 MB.</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
          />
        </label>
        {error && <ErrorText>{error}</ErrorText>}
      </div>
    );
  }

  async function save(table: Table, m: ColumnMapping, file: File) {
    const supabase = createClient();
    setError(null);
    let datasetId: string | null = null;
    try {
      setSaving("Creating the dataset…");
      const { events, report } = ingestTable(table, m);
      const { data: row, error: insertError } = await supabase
        .from("datasets")
        .insert({ workspace_id: workspaceId, name: name.trim() || file.name, source_format: "csv", column_mapping: m, status: "parsing" })
        .select("id")
        .single();
      if (insertError) throw insertError;
      datasetId = row.id as string;

      setSaving("Uploading the original file…");
      const sourcePath = `${workspaceId}/${datasetId}/source.csv`;
      const raw = await supabase.storage.from("raw-uploads").upload(sourcePath, file, { contentType: "text/csv" });
      if (raw.error) throw raw.error;

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
        setLoaded(null);
        setMapping(null);
      }}
      onSave={() => save(loaded.table, mapping, loaded.file)}
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
