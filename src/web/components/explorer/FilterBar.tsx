"use client";

import { useState } from "react";
import type { AttrValue, CaseFilter } from "@throughline/engine";
import type { LogMeta } from "@/lib/explorer/protocol";
import { formatInt } from "./format";

/** A filter as the explorer holds it: the engine filter plus how to say it. */
export interface ActiveFilter {
  id: string;
  label: string;
  filter: CaseFilter;
}

type Tab = "time" | "attribute" | "activity";

const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);
const DAY = 86_400_000;

/** Active filters as removable chips, the filtered case count, and a small builder. */
export function FilterBar(props: {
  meta: LogMeta;
  filters: ActiveFilter[];
  caseCount: number | null;
  onAdd: (f: Omit<ActiveFilter, "id">) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const { meta, filters } = props;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("time");

  const add = (f: Omit<ActiveFilter, "id">) => {
    props.onAdd(f);
    setOpen(false);
  };

  return (
    <section aria-label="Filters" className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <span className="font-mono text-sm">
          {props.caseCount === null ? "…" : formatInt(props.caseCount)}
          <span className="text-ink-faint"> of {formatInt(meta.totalCases)} cases</span>
        </span>
        {filters.map((f) => (
          <span key={f.id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/40 bg-primary/5 py-1 pl-3 pr-1 text-sm">
            <span className="truncate">{f.label}</span>
            <button
              type="button"
              onClick={() => props.onRemove(f.id)}
              aria-label={`Remove filter: ${f.label}`}
              className="grid size-6 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-primary/10 hover:text-ink"
            >
              ×
            </button>
          </span>
        ))}
        <div className="ml-auto flex gap-2">
          {filters.length > 1 && (
            <button type="button" onClick={props.onClear} className="eyebrow px-2 py-1.5 text-[0.6rem] text-ink-muted hover:text-ink">
              Clear all
            </button>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="eyebrow rounded-md bg-primary px-3 py-2 text-[0.6rem] text-primary-ink hover:bg-primary-hover"
          >
            {open ? "Close" : "+ Add filter"}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line p-4">
          <div role="tablist" aria-label="Filter type" className="flex flex-wrap gap-1">
            {(
              [
                ["time", "Time range"],
                ["attribute", "Attribute"],
                ["activity", "Activity"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`eyebrow rounded-md px-3 py-1.5 text-[0.6rem] ${tab === k ? "bg-ink text-surface" : "text-ink-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4">
            {tab === "time" && <TimeForm meta={meta} onAdd={add} />}
            {tab === "attribute" && <AttributeForm meta={meta} onAdd={add} />}
            {tab === "activity" && <ActivityForm meta={meta} onAdd={add} />}
          </div>
          <p className="mt-3 text-xs text-ink-faint">Tip: click a variant, a rule or a root-cause segment below to filter to it.</p>
        </div>
      )}
    </section>
  );
}

const field = "mt-1 block w-full rounded-md border border-line bg-surface px-2.5 py-2 text-sm";
const label = "eyebrow block text-[0.6rem] text-ink-faint";
const submit = "eyebrow rounded-md border border-primary px-4 py-2.5 text-[0.6rem] text-primary hover:bg-primary hover:text-primary-ink disabled:opacity-40";

type Add = (f: Omit<ActiveFilter, "id">) => void;

const MODES = {
  started: "Started",
  completed: "Completed",
  contained: "Started and completed",
  intersecting: "Active",
} as const;

function TimeForm({ meta, onAdd }: { meta: LogMeta; onAdd: Add }) {
  const min = meta.firstEvent !== null ? toDate(meta.firstEvent) : "";
  const max = meta.lastEvent !== null ? toDate(meta.lastEvent) : "";
  const [from, setFrom] = useState(min);
  const [to, setTo] = useState(max);
  const [mode, setMode] = useState<keyof typeof MODES>("started");
  const valid = from !== "" && to !== "" && from <= to;
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const fromMs = Date.parse(`${from}T00:00:00Z`);
        const toMs = Date.parse(`${to}T00:00:00Z`) + DAY - 1;
        onAdd({ label: `${MODES[mode]} ${from} – ${to}`, filter: { kind: "timeframe", from: fromMs, to: toMs, mode } });
      }}
    >
      <label>
        <span className={label}>Cases</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as keyof typeof MODES)} className={field}>
          {Object.entries(MODES).map(([k, v]) => (
            <option key={k} value={k}>
              {v} in range
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className={label}>From (UTC)</span>
        <input type="date" value={from} min={min} max={max} onChange={(e) => setFrom(e.target.value)} className={field} />
      </label>
      <label>
        <span className={label}>To (UTC)</span>
        <input type="date" value={to} min={min} max={max} onChange={(e) => setTo(e.target.value)} className={field} />
      </label>
      <button type="submit" disabled={!valid} className={submit}>
        Apply
      </button>
    </form>
  );
}

function AttributeForm({ meta, onAdd }: { meta: LogMeta; onAdd: Add }) {
  // Id-like attributes (an invoice number per case) make useless filters.
  const categorical = meta.attributes.filter((a) => a.type === "category" && a.distinct <= 200);
  const [key, setKey] = useState(categorical[0]?.key ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exclude, setExclude] = useState(false);
  const attr = categorical.find((a) => a.key === key);
  if (categorical.length === 0) return <p className="text-sm text-ink-muted">This log has no case attributes with a short list of values.</p>;

  const values: AttrValue[] = attr?.values.filter((v) => picked.has(String(v.value))).map((v) => v.value) ?? [];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (values.length === 0) return;
        const shown = values.map((v) => (v === null ? "(missing)" : String(v))).join(", ");
        onAdd({ label: `${key} ${exclude ? "is not" : values.length > 1 ? "is one of" : "is"} ${shown}`, filter: { kind: "attribute", key, values, exclude } });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label>
          <span className={label}>Attribute</span>
          <select
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setPicked(new Set());
            }}
            className={field}
          >
            {categorical.map((a) => (
              <option key={a.key} value={a.key}>
                {a.key} ({a.distinct} values)
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} className="accent-[var(--primary)]" />
          Exclude these
        </label>
      </div>
      <fieldset className="mt-3 max-h-56 overflow-y-auto rounded-md border border-line p-2">
        <legend className="sr-only">Values</legend>
        {attr?.values.map((v) => {
          const s = String(v.value);
          return (
            <label key={s} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 text-sm hover:bg-bg">
              <span className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.has(s)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (e.target.checked) n.add(s);
                      else n.delete(s);
                      return n;
                    })
                  }
                  className="accent-[var(--primary)]"
                />
                <span className="truncate">{v.value === null ? "(missing)" : s}</span>
              </span>
              <span className="font-mono text-xs text-ink-faint">{formatInt(v.count)}</span>
            </label>
          );
        })}
        {attr && attr.distinct > attr.values.length && (
          <p className="px-2 py-1.5 text-xs text-ink-faint">Showing the {attr.values.length} most common of {formatInt(attr.distinct)} values.</p>
        )}
      </fieldset>
      <button type="submit" disabled={values.length === 0} className={`${submit} mt-3`}>
        Apply
      </button>
    </form>
  );
}

function ActivityForm({ meta, onAdd }: { meta: LogMeta; onAdd: Add }) {
  const [activity, setActivity] = useState(meta.activities[0] ?? "");
  const [mode, setMode] = useState<"includes" | "excludes">("includes");
  return (
    <form
      className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        if (!activity) return;
        onAdd({ label: `${mode === "includes" ? "Passes through" : "Skips"} ${activity}`, filter: { kind: "activity", activity, mode } });
      }}
    >
      <label>
        <span className={label}>Cases that</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as "includes" | "excludes")} className={field}>
          <option value="includes">pass through</option>
          <option value="excludes">never pass through</option>
        </select>
      </label>
      <label>
        <span className={label}>Activity</span>
        <select value={activity} onChange={(e) => setActivity(e.target.value)} className={field}>
          {meta.activities.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={submit}>
        Apply
      </button>
    </form>
  );
}
