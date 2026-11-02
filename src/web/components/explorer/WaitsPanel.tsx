"use client";

import { useState, useTransition } from "react";
import type { AnalysisSettings } from "@throughline/engine";
import type { LogMeta } from "@/lib/explorer/protocol";

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PERCENTILES = [0.5, 0.75, 0.9];

const hh = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/**
 * How waits are classified: the working calendar, steps on planned dates and
 * systems. Editors can correct what was detected; the explorer reloads with it.
 */
export function WaitsPanel({
  meta,
  settings,
  onSave,
}: {
  meta: LogMeta;
  settings: AnalysisSettings;
  /** Absent for read-only views (the sample, viewers). */
  onSave?: (next: AnalysisSettings) => Promise<{ error?: string }>;
}) {
  const w = meta.waits;
  const [scheduled, setScheduled] = useState(() => new Set(w.scheduled.map((s) => s.activity)));
  const [systems, setSystems] = useState(() => new Set(settings.systemResources ?? []));
  const [percentile, setPercentile] = useState(w.normalWaitPercentile);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const detected = new Set(w.scheduled.filter((s) => s.source === "detected").map((s) => s.activity));
  const canEdit = Boolean(onSave);

  const offset = w.calendar.utcOffsetMinutes / 60;
  const days = w.calendar.workDays.length === 5 && w.calendar.workDays.every((d, i) => d === i + 1) ? "Mon–Fri" : w.calendar.workDays.map((d) => DAYS[d]).join(", ");
  const calendarText = `${days} ${hh(w.calendar.startHour)}–${hh(w.calendar.endHour)}, UTC${offset >= 0 ? "+" : "−"}${Math.abs(offset)}`;
  const calendarSource =
    w.calendarSource === "discovered"
      ? `learned from when people act; ${Math.round(w.calendarCoverage * 100)}% of their steps fall inside it`
      : w.calendarSource === "configured"
        ? "set for this dataset"
        : "a default: too few steps by people to learn one";

  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const save = () =>
    start(async () => {
      const next: AnalysisSettings = {
        ...settings,
        scheduledActivities: [...scheduled].filter((a) => !detected.has(a)),
        notScheduled: [...detected].filter((a) => !scheduled.has(a)),
        systemResources: [...systems],
        normalWaitPercentile: percentile,
      };
      const res = await onSave!(next);
      setError(res.error ?? null);
    });

  const label = "eyebrow text-[0.6rem] text-ink-faint";
  const field = "rounded-md border border-line bg-surface px-2 py-1.5 text-sm disabled:opacity-60";

  return (
    <div className="space-y-5 text-sm">
      <p className="text-ink-muted">
        Only <span className="font-medium text-ink">queue time</span> counts as excess: working hours a case waits beyond the usual for that step. Nights and
        weekends, steps that follow within a minute (automatic), waits for batch runs and waits for planned dates are shown, but never ranked as delays.
      </p>

      <div>
        <p className={label}>Working hours</p>
        <p className="mt-1 font-mono">{calendarText}</p>
        <p className="text-xs text-ink-faint">{calendarSource}</p>
      </div>

      <div>
        <p className={label}>Usual wait</p>
        <label className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-ink-muted">Waits up to the</span>
          <select disabled={!canEdit} value={percentile} onChange={(e) => setPercentile(Number(e.target.value))} className={field}>
            {PERCENTILES.map((p) => (
              <option key={p} value={p}>
                {Math.round(p * 100)}th
              </option>
            ))}
          </select>
          <span className="text-ink-muted">percentile of each step&rsquo;s human waits are normal.</span>
        </label>
      </div>

      <fieldset disabled={!canEdit}>
        <legend className={label}>Steps on planned dates</legend>
        <ul className="mt-1 space-y-2">
          {[...new Set([...w.scheduled.map((s) => s.activity), ...scheduled])].map((a) => {
            const info = w.scheduled.find((s) => s.activity === a);
            return (
              <li key={a}>
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1 accent-[var(--primary)]" checked={scheduled.has(a)} onChange={() => toggle(scheduled, a, setScheduled)} />
                  <span>
                    {a}
                    {info && <span className="block text-xs text-ink-faint">{info.evidence}</span>}
                  </span>
                </label>
              </li>
            );
          })}
          {scheduled.size === 0 && w.scheduled.length === 0 && <li className="text-ink-faint">None detected.</li>}
        </ul>
        {canEdit && (
          <select value="" onChange={(e) => e.target.value && toggle(scheduled, e.target.value, setScheduled)} className={`${field} mt-2 block w-full min-w-0 truncate`}>
            <option value="">Mark another step as on a planned date…</option>
            {meta.activities
              .filter((a) => !scheduled.has(a))
              .map((a) => (
                <option key={a}>{a}</option>
              ))}
          </select>
        )}
      </fieldset>

      <fieldset disabled={!canEdit}>
        <legend className={label}>Systems and batch jobs</legend>
        <ul className="mt-1 space-y-1">
          {w.systemResources
            .filter((s) => s.source !== "set")
            .map((s) => (
              <li key={s.resource}>
                <span className="font-mono">{s.resource}</span> <span className="text-xs text-ink-faint">({s.evidence})</span>
              </li>
            ))}
          {[...systems].map((r) => (
            <li key={r}>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="accent-[var(--primary)]" checked onChange={() => toggle(systems, r, setSystems)} />
                <span className="font-mono">{r}</span> <span className="text-xs text-ink-faint">(marked)</span>
              </label>
            </li>
          ))}
          {w.systemResources.length === 0 && systems.size === 0 && <li className="text-ink-faint">None detected.</li>}
        </ul>
        {canEdit && (
          <select value="" onChange={(e) => e.target.value && toggle(systems, e.target.value, setSystems)} className={`${field} mt-2 block w-full min-w-0 truncate`}>
            <option value="">Mark a resource as a system…</option>
            {w.resources
              .filter((r) => !systems.has(r) && !w.systemResources.some((s) => s.resource === r))
              .map((r) => (
                <option key={r}>{r}</option>
              ))}
          </select>
        )}
      </fieldset>

      {canEdit ? (
        <div>
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="eyebrow rounded-md border border-primary px-4 py-2.5 text-[0.6rem] text-primary hover:bg-primary hover:text-primary-ink disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save and re-analyse"}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-[#b42318]">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-faint">Read-only here.</p>
      )}
    </div>
  );
}
