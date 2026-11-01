"use client";

import { useEffect, useRef, useState } from "react";
import type { FromWorker, Kpi, LogSource, MapView, Overview, ToWorker, ViewOptions } from "@/lib/explorer/protocol";
import { formatDuration, formatInt, formatMoney } from "./format";
import { ProcessMapView } from "./ProcessMapView";

const DAY = 86_400_000;

/**
 * Interactive explorer for one event log. The engine runs in a Web Worker,
 * so dragging a slider never blocks the page; stale layouts are dropped by
 * sequence number.
 */
export function Explorer({ source, costNote }: { source: LogSource; costNote: string }) {
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [view, setView] = useState<MapView | null>(null);
  const [options, setOptions] = useState<ViewOptions>({ activityShare: 1, pathShare: 0.6 });
  const [kpi, setKpi] = useState<Kpi>("frequency");
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const w = new Worker(new URL("../../lib/explorer/explorer.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      if (msg.type === "loaded") setOverview(msg.overview);
      else if (msg.type === "view") {
        if (msg.seq === seq.current) setView(msg.view);
      } else setError(msg.message);
    };
    w.onerror = (e) => setError(e.message || "The analysis worker failed to start.");
    w.postMessage({ type: "load", source } satisfies ToWorker);
    return () => w.terminate();
  }, [source]);

  useEffect(() => {
    if (!overview || !worker.current) return;
    seq.current += 1;
    worker.current.postMessage({ type: "view", options, seq: seq.current } satisfies ToWorker);
  }, [overview, options]);

  if (error) {
    return (
      <p role="alert" className="rounded-xl border border-[#b42318] p-6 text-[#b42318]">
        {error}
      </p>
    );
  }
  if (!overview) return <p className="py-20 text-center text-ink-faint">Loading and analysing the log…</p>;

  const s = overview.summary;
  const span = s.firstEvent !== null && s.lastEvent !== null ? (s.lastEvent - s.firstEvent) / DAY : 0;
  const stats: [string, string][] = [
    ["Cases", formatInt(s.caseCount)],
    ["Events", formatInt(s.eventCount)],
    ["Activities", formatInt(s.activityCount)],
    ["Variants", formatInt(s.variantCount)],
    ["Median case duration", formatDuration(s.throughput.median)],
    ["Time span", `${formatInt(span)} days`],
  ];

  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="eyebrow text-[0.6rem] text-ink-faint">{k}</dt>
            <dd className="mt-1 font-mono text-lg">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8 rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-b border-line p-4">
          <Slider
            label="Activities"
            value={options.activityShare}
            detail={view ? `${view.activitiesShown} of ${view.activitiesTotal}` : ""}
            onChange={(activityShare) => setOptions((o) => ({ ...o, activityShare }))}
          />
          <Slider
            label="Paths"
            value={options.pathShare}
            detail={view ? `${view.edgesShown} of ${view.edgesTotal}` : ""}
            onChange={(pathShare) => setOptions((o) => ({ ...o, pathShare }))}
          />
          <div role="radiogroup" aria-label="Show on paths" className="flex overflow-hidden rounded-md border border-line">
            {(["frequency", "median"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kpi === k}
                onClick={() => setKpi(k)}
                className={`eyebrow px-3 py-2 text-[0.65rem] ${kpi === k ? "bg-primary text-primary-ink" : "text-ink-muted"}`}
              >
                {k === "frequency" ? "Frequency" : "Median wait"}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-1 font-mono text-sm">
            <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))} className="rounded border border-line px-2.5 py-1">
              −
            </button>
            <span className="w-12 text-center text-ink-faint">{Math.round(zoom * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2, z + 0.2))} className="rounded border border-line px-2.5 py-1">
              +
            </button>
          </div>
        </div>
        <div className="dot-grid max-h-[760px] overflow-auto p-4">
          {view ? <ProcessMapView view={view} kpi={kpi} zoom={zoom} /> : <p className="py-20 text-center text-ink-faint">Laying out the map…</p>}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-ink-faint">
          Line thickness shows how often a path is taken; teal marks the most common route. With &ldquo;Median wait&rdquo;,
          colour runs from teal (quick) to red (slowest on screen).
        </p>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="text-xl font-medium">Variants</h2>
          <p className="mt-1 text-sm text-ink-muted">Distinct routes through the process, most common first.</p>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="eyebrow text-[0.6rem] text-ink-faint">
              <tr>
                <th className="py-2 font-normal">Share of cases</th>
                <th className="py-2 font-normal">Steps</th>
                <th className="py-2 text-right font-normal">Median duration</th>
              </tr>
            </thead>
            <tbody>
              {overview.variants.map((v) => (
                <tr key={v.key} className="border-t border-line" title={v.key}>
                  <td className="py-2.5 pr-4">
                    <div className="flex items-center gap-3">
                      <span className="h-1.5 rounded bg-primary" style={{ width: `${Math.max(2, v.share * 120)}px` }} />
                      <span className="font-mono">{(v.share * 100).toFixed(1)}%</span>
                      <span className="font-mono text-ink-faint">({formatInt(v.count)})</span>
                    </div>
                  </td>
                  <td className="py-2.5 font-mono">{v.steps}</td>
                  <td className="py-2.5 text-right font-mono">{formatDuration(v.medianDays * DAY)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="min-w-0">
          <h2 className="text-xl font-medium">Bottlenecks</h2>
          <p className="mt-1 text-sm text-ink-muted">{costNote}</p>

          <h3 className="eyebrow mt-6 text-[0.65rem] text-ink-faint">Costliest waits between steps</h3>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {overview.edges.slice(0, 5).map((e) => (
              <li key={e.id} className="flex items-baseline justify-between gap-4 py-2.5">
                <span className="min-w-0">
                  {e.from} <span className="text-ink-faint">→</span> {e.to}
                  <span className="block font-mono text-xs text-ink-faint">
                    {formatInt(e.frequency)}× · median {formatDuration(e.medianHours * 3_600_000)}
                  </span>
                </span>
                <span className="shrink-0 font-mono">{formatMoney(e.cost, overview.currency)}</span>
              </li>
            ))}
          </ul>

          {overview.resources.length > 0 && (
            <>
              <h3 className="eyebrow mt-6 text-[0.65rem] text-ink-faint">People whose cases wait longer than peers</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {overview.resources.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <span className="min-w-0">
                      {r.resource} <span className="text-ink-faint">on</span> {r.activity}
                      <span className="block font-mono text-xs text-ink-faint">
                        {r.slowdown.toFixed(1)}× slower · {formatDuration(r.medianHours * 3_600_000)} vs{" "}
                        {formatDuration(r.peerHours * 3_600_000)} · n={formatInt(r.executions)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono">{formatMoney(r.cost, overview.currency)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {overview.rework.length > 0 && (
            <>
              <h3 className="eyebrow mt-6 text-[0.65rem] text-ink-faint">Rework (steps repeated within a case)</h3>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {overview.rework.map((r) => (
                  <li key={r.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <span className="min-w-0">
                      {r.activity}
                      <span className="block font-mono text-xs text-ink-faint">
                        {formatInt(r.repeats)} repeats · {(r.share * 100).toFixed(1)}% of cases
                      </span>
                    </span>
                    <span className="shrink-0 font-mono">{formatMoney(r.cost, overview.currency)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Slider(props: { label: string; value: number; detail: string; onChange: (v: number) => void }) {
  return (
    <label className="block min-w-48">
      <span className="eyebrow flex justify-between text-[0.65rem] text-ink-faint">
        <span>{props.label}</span>
        <span className="font-mono normal-case tracking-normal">{props.detail}</span>
      </span>
      <input
        type="range"
        min={5}
        max={100}
        step={5}
        value={Math.round(props.value * 100)}
        onChange={(e) => props.onChange(Number(e.target.value) / 100)}
        className="mt-2 w-full accent-[var(--primary)]"
      />
    </label>
  );
}
