"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisSettings, CaseTimeline, CostModel, Rule } from "@throughline/engine";
import type {
  Analysis,
  FromWorker,
  Kpi,
  LogMeta,
  LogSource,
  MapView,
  Outcome,
  RootCauseView,
  ToWorker,
  ViewOptions,
} from "@/lib/explorer/protocol";
import { CaseDialog } from "./CaseDialog";
import { FilterBar, type ActiveFilter } from "./FilterBar";
import { formatDuration, formatInt, formatMoney } from "./format";
import { ProcessMapView } from "./ProcessMapView";
import { RootCausePanel } from "./RootCausePanel";
import { RulesPanel } from "./RulesPanel";
import { WaitsPanel } from "./WaitsPanel";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * Interactive explorer for one event log. The engine runs in a Web Worker,
 * so filtering or dragging a slider never blocks the page; stale results are
 * dropped by sequence number.
 */
/** One part of the Bottlenecks section, collapsible so the section stays short; the count shows what's inside. */
function Group({ title, count, open, children }: { title: string; count: number; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group mt-4 border-t border-line pt-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="eyebrow text-[0.65rem] text-ink-muted">
          {title} <span className="text-ink-faint">· {count}</span>
        </span>
        <span aria-hidden className="font-mono text-sm text-primary transition group-open:rotate-45">+</span>
      </summary>
      <div className="pb-1">{children}</div>
    </details>
  );
}

/** Variants listed before "show all"; the rest of the top 12 sit behind it. */
const TOP_VARIANTS = 4;

export function Explorer({
  source,
  costNote,
  cost,
  rules,
  rulesEmptyNote = "No business rules are set up for this log.",
  settings = NO_SETTINGS,
  onSaveSettings,
}: {
  source: LogSource;
  costNote: React.ReactNode;
  cost?: CostModel;
  rules?: Rule[];
  rulesEmptyNote?: React.ReactNode;
  /** How this dataset's waits are classified (scheduled steps, systems, usual-wait percentile). */
  settings?: AnalysisSettings;
  /** Saves corrected settings; absent where the viewer can't edit. */
  onSaveSettings?: (next: AnalysisSettings) => Promise<{ error?: string }>;
}) {
  const worker = useRef<Worker | null>(null);
  const seqs = useRef({ filter: 0, view: 0, rootCause: 0 });
  const rootCauseFilters = useRef<ActiveFilter[]>([]);
  const nextId = useRef(0);
  const [meta, setMeta] = useState<LogMeta | null>(null);
  const [openVariants, setOpenVariants] = useState<Set<string>>(() => new Set());
  const [showAllVariants, setShowAllVariants] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [view, setView] = useState<MapView | null | undefined>(undefined);
  const [filters, setFilters] = useState<ActiveFilter[]>([]);
  const [options, setOptions] = useState<ViewOptions>({ activityShare: 1, pathShare: 0.6 });
  const [kpi, setKpi] = useState<Kpi>("frequency");
  const [zoom, setZoom] = useState(1);
  // Kept with the filters it was computed for, so a filter change hides a stale report.
  const [rootCause, setRootCause] = useState<{ report: RootCauseView; filters: ActiveFilter[] } | null>(null);
  const [rootCauseBusy, setRootCauseBusy] = useState(false);
  const [openCase, setOpenCase] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<CaseTimeline | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const send = (msg: ToWorker) => worker.current?.postMessage(msg);

  useEffect(() => {
    const w = new Worker(new URL("../../lib/explorer/explorer.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      if (msg.type === "loaded") setMeta(msg.meta);
      else if (msg.type === "analysis") {
        if (msg.seq === seqs.current.filter) setAnalysis(msg.analysis);
      } else if (msg.type === "view") {
        if (msg.seq === seqs.current.view) setView(msg.view);
      } else if (msg.type === "rootCause") {
        if (msg.seq === seqs.current.rootCause) {
          setRootCause({ report: msg.report, filters: rootCauseFilters.current });
          setRootCauseBusy(false);
        }
      } else if (msg.type === "case") setTimeline(msg.timeline);
      else setError(msg.message);
    };
    w.onerror = (e) => setError(e.message || "The analysis worker failed to start.");
    w.postMessage({ type: "load", source, cost, rules, settings } satisfies ToWorker);
    return () => w.terminate();
  }, [source, cost, rules, settings]);

  // A new filter re-runs the analysis and the map; the worker handles messages in order.
  useEffect(() => {
    if (!meta) return;
    seqs.current.filter += 1;
    send({ type: "filter", filters: filters.map((f) => f.filter), seq: seqs.current.filter });
  }, [meta, filters]);

  useEffect(() => {
    if (!meta) return;
    seqs.current.view += 1;
    send({ type: "view", options, seq: seqs.current.view });
  }, [meta, filters, options]);

  const addFilter = useCallback((f: Omit<ActiveFilter, "id">) => {
    nextId.current += 1;
    setFilters((fs) => [...fs, { ...f, id: `f${nextId.current}` }]);
  }, []);

  const showCase = (id: string) => {
    setTimeline(undefined);
    setOpenCase(id);
    send({ type: "case", id });
  };

  const runRootCause = (outcome: Outcome) => {
    seqs.current.rootCause += 1;
    rootCauseFilters.current = filters;
    setRootCauseBusy(true);
    send({ type: "rootCause", outcome, seq: seqs.current.rootCause });
  };

  if (error) {
    return (
      <p role="alert" className="rounded-xl border border-[#b42318] p-6 text-[#b42318]">
        {error}
      </p>
    );
  }
  if (!meta || !analysis) return <p className="py-20 text-center text-ink-faint">Loading and analysing the log…</p>;

  const s = analysis.summary;
  const span = s.firstEvent !== null && s.lastEvent !== null ? (s.lastEvent - s.firstEvent) / DAY : 0;
  const stats: [string, string][] = [
    ["Cases", formatInt(s.caseCount)],
    ["Events", formatInt(s.eventCount)],
    ["Activities", formatInt(s.activityCount)],
    ["Variants", formatInt(s.variantCount)],
    ["Median case duration", formatDuration(s.throughput.median)],
    ["Time span", `${formatInt(span)} days`],
  ];
  const money = (n: number) => formatMoney(n, analysis.currency);
  // A wait with no time cost set reads as "–", not a misleading €0; its formula says why.
  const waitMoney = (n: number) => (n > 0 ? money(n) : "–");
  const variantFilter = filters.find((f) => f.filter.kind === "variant");
  const empty = s.caseCount === 0;

  return (
    <div>
      <FilterBar
        meta={meta}
        filters={filters}
        caseCount={s.caseCount}
        onAdd={addFilter}
        onRemove={(id) => setFilters((fs) => fs.filter((f) => f.id !== id))}
        onClear={() => setFilters([])}
      />

      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
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
          {empty || view === null ? (
            <p className="py-20 text-center text-ink-faint">No cases match the current filters.</p>
          ) : view ? (
            <ProcessMapView view={view} kpi={kpi} zoom={zoom} />
          ) : (
            <p className="py-20 text-center text-ink-faint">Laying out the map…</p>
          )}
        </div>
        <p className="border-t border-line px-4 py-3 text-xs text-ink-faint">
          Line thickness shows how often a path is taken; teal marks the most common route. With &ldquo;Median wait&rdquo;,
          colour runs from teal (quick) to red (slowest on screen).
        </p>
      </section>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="text-xl font-medium">Variants</h2>
          <p className="mt-1 text-sm text-ink-muted">
            A variant is one exact route through the process. Most common first. Click a share to filter the map and every figure
            to those cases; click the steps to see the route.
          </p>
          <table className="mt-4 w-full table-fixed text-left text-sm">
            <thead className="eyebrow text-[0.6rem] text-ink-faint">
              <tr>
                <th className="w-[55%] py-2 font-normal">Share of cases</th>
                <th className="py-2 font-normal">Route</th>
                <th className="py-2 text-right font-normal">Median</th>
              </tr>
            </thead>
            <tbody>
              {analysis.variants.map((v, i) => {
                const active = variantFilter?.filter.kind === "variant" && variantFilter.filter.keys.includes(v.key);
                // A filtered variant stays visible even when it's beyond the first few.
                if (!showAllVariants && i >= TOP_VARIANTS && !active) return null;
                const open = openVariants.has(v.key);
                const stepsId = `variant-steps-${i}`;
                return (
                  <Fragment key={v.key}>
                    <tr className={`border-t border-line ${active ? "bg-primary/5" : ""}`}>
                      <td className="py-2.5 pr-4">
                        <button
                          type="button"
                          aria-pressed={active}
                          aria-label={`Variant ${i + 1}: ${(v.share * 100).toFixed(1)}% of cases. ${active ? "Remove filter" : "Filter to these cases"}`}
                          onClick={() =>
                            active
                              ? setFilters((fs) => fs.filter((f) => f !== variantFilter))
                              : addFilter({
                                  label: `Variant ${i + 1} (${v.steps} steps, ${formatInt(v.count)} cases)`,
                                  filter: { kind: "variant", keys: [v.key] },
                                })
                          }
                          className="flex w-full min-w-0 items-center gap-3 text-left hover:text-primary"
                        >
                          <span className="w-5 shrink-0 font-mono text-xs text-ink-faint">{i + 1}</span>
                          <span className="h-1.5 shrink-0 rounded bg-primary" style={{ width: `${Math.max(2, v.share * 100)}px` }} />
                          <span className="font-mono">{(v.share * 100).toFixed(1)}%</span>
                          <span className="truncate font-mono text-ink-faint">({formatInt(v.count)})</span>
                        </button>
                      </td>
                      <td className="py-2.5">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={stepsId}
                          onClick={() =>
                            setOpenVariants((s) => {
                              const next = new Set(s);
                              if (next.has(v.key)) next.delete(v.key);
                              else next.add(v.key);
                              return next;
                            })
                          }
                          className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                        >
                          {v.steps} steps
                          <span aria-hidden className={`text-[0.6rem] transition ${open ? "rotate-180" : ""}`}>▾</span>
                        </button>
                      </td>
                      <td className="py-2.5 text-right font-mono">{formatDuration(v.medianDays * DAY)}</td>
                    </tr>
                    {open && (
                      <tr className={active ? "bg-primary/5" : ""}>
                        <td colSpan={3} className="pb-3">
                          <ol id={stepsId} className="ml-8 space-y-1 border-l border-line pl-4 text-xs leading-snug text-ink-muted">
                            {v.key.split(" → ").map((step, j) => (
                              <li key={j}>
                                <span className="mr-2 font-mono text-ink-faint">{j + 1}</span>
                                {step}
                              </li>
                            ))}
                          </ol>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {analysis.variants.length > TOP_VARIANTS && (
            <button
              type="button"
              aria-expanded={showAllVariants}
              onClick={() => setShowAllVariants((x) => !x)}
              className="eyebrow mt-3 text-[0.65rem] text-primary hover:underline"
            >
              {showAllVariants ? `Show the top ${TOP_VARIANTS}` : `Show all ${analysis.variants.length} variants`}
            </button>
          )}
        </section>

        <section className="min-w-0">
          <h2 className="text-xl font-medium">Bottlenecks</h2>
          <div className="mt-1 text-sm text-ink-muted">{costNote}</div>

          <details className="mt-4 rounded-lg border border-line px-4 py-3">
            <summary className="cursor-pointer text-sm text-primary">How waits are classified</summary>
            <div className="mt-3">
              <WaitsPanel key={JSON.stringify(settings)} meta={meta} settings={settings} onSave={onSaveSettings} />
            </div>
          </details>

          <Group title="Costliest waits between steps" count={Math.min(5, analysis.edges.length)} open>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {analysis.edges.slice(0, 5).map((e) => (
              <PricedRow key={e.id} cost={waitMoney(e.cost)} formula={e.formula}>
                {e.from} <span className="text-ink-faint">→</span> {e.to}
                <span className="block font-mono text-xs text-ink-faint">
                  {formatInt(e.frequency)}× · median {formatDuration(e.medianHours * HOUR)}
                  {e.automaticShare >= 0.05 && ` · ${Math.round(e.automaticShare * 100)}% automatic`}
                  {e.stuckCount > 0 && ` · ${formatInt(e.stuckCount)} stuck far longer, counted apart`}
                </span>
                <WaitBar breakdown={e.breakdown} />
              </PricedRow>
            ))}
          </ul>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.65rem] text-ink-faint">
            {WAIT_PARTS.map((p) => (
              <span key={p.key} className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 rounded-sm ${p.className}`} />
                {p.label}
              </span>
            ))}
          </p>
          </Group>

          {analysis.batches.length > 0 && (
            <Group title="Waiting for batch runs" count={analysis.batches.length}>
              <p className="mt-1 text-xs text-ink-faint">Steps done for many cases at once. The lever is how often they run, not how fast people work.</p>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {analysis.batches.map((b) => (
                  <li key={b.id} className="py-2.5">
                    {b.activity} <span className="text-ink-faint">by</span> {b.resource ?? "no one recorded"}
                    <span className="block font-mono text-xs text-ink-faint">
                      {formatInt(b.runs)} {b.runs === 1 ? "run" : "runs"} · {b.runsPerWeek.toFixed(1)} a week · {formatInt(b.casesPerRun)} cases a run · median wait {formatDuration(b.medianWaitHours * HOUR)}
                    </span>
                    <span className="block font-mono text-[0.68rem] text-ink-faint">{b.id}</span>
                  </li>
                ))}
              </ul>
            </Group>
          )}

          {analysis.planned.length > 0 && (
            <Group title="Time until planned dates" count={analysis.planned.length}>
              <p className="mt-1 text-xs text-ink-faint">Waits that end on a date set in advance, such as a trip. Not a delay, so never priced or ranked.</p>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {analysis.planned.map((e) => (
                  <li key={e.id} className="py-2.5">
                    {e.from} <span className="text-ink-faint">→</span> {e.to}
                    <span className="block font-mono text-xs text-ink-faint">
                      {formatInt(e.frequency)}× · median {formatDuration(e.medianHours * HOUR)}
                    </span>
                  </li>
                ))}
              </ul>
            </Group>
          )}

          {analysis.resources.length > 0 && (
            <Group title="People whose cases wait longer than peers" count={analysis.resources.length}>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {analysis.resources.map((r) => (
                  <PricedRow key={r.id} cost={waitMoney(r.cost)} formula={r.formula}>
                    {r.resource} <span className="text-ink-faint">on</span> {r.activity}
                    <span className="block font-mono text-xs text-ink-faint">
                      {r.slowdown.toFixed(1)}× slower · {formatDuration(r.medianHours * HOUR)} vs {formatDuration(r.peerHours * HOUR)} · n=
                      {formatInt(r.executions)}
                    </span>
                  </PricedRow>
                ))}
              </ul>
            </Group>
          )}

          {analysis.rework.length > 0 && (
            <Group title="Rework (steps repeated within a case)" count={analysis.rework.length}>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {analysis.rework.map((r) => (
                  <PricedRow key={r.id} cost={money(r.cost)} formula={r.formula}>
                    {r.activity}
                    <span className="block font-mono text-xs text-ink-faint">
                      {formatInt(r.repeats)} repeats · {(r.share * 100).toFixed(1)}% of cases
                    </span>
                  </PricedRow>
                ))}
              </ul>
            </Group>
          )}

          {analysis.costToServe.activities.length > 0 && (
            <Group title="Baseline labour (hands-on time for every step)" count={analysis.costToServe.activities.length}>
              <p className="mt-1 text-xs text-ink-faint">
                {money(analysis.costToServe.cost)} in all = {analysis.costToServe.formula}. What automating a step could save, not a loss.
              </p>
              <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
                {analysis.costToServe.activities.map((a) => (
                  <PricedRow key={a.id} cost={money(a.cost)} formula={a.formula}>
                    {a.activity}
                  </PricedRow>
                ))}
              </ul>
            </Group>
          )}
        </section>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="text-xl font-medium">Rules &amp; violations</h2>
          <p className="mt-1 text-sm text-ink-muted">Business rules checked against every case in the current filter.</p>
          <RulesPanel
            rules={analysis.rules}
            currency={analysis.currency}
            emptyNote={rulesEmptyNote}
            onOpenCase={showCase}
            onFilter={(r) => addFilter({ label: `Violates: ${r.name}`, filter: { kind: "cases", ids: r.caseIds } })}
          />
        </section>

        <section className="min-w-0">
          <h2 className="text-xl font-medium">Root causes</h2>
          <p className="mt-1 text-sm text-ink-muted">Which kinds of cases are over-represented among an outcome you pick.</p>
          <RootCausePanel
            meta={meta}
            report={rootCause?.filters === filters ? rootCause.report : null}
            busy={rootCauseBusy}
            onRun={runRootCause}
            onFilter={(f) =>
              f.filter &&
              addFilter({
                label: f.attribute.startsWith("passes:") ? `${f.value === "yes" ? "Passes through" : "Skips"} ${f.attribute.slice(7)}` : `${f.attribute} is ${f.value}`,
                filter: f.filter,
              })
            }
          />
        </section>
      </div>

      <section className="mt-12 min-w-0">
        <h2 className="text-xl font-medium">Slowest cases</h2>
        <p className="mt-1 text-sm text-ink-muted">The longest-running cases in the current filter. Open one to see its timeline.</p>
        <ul className="mt-4 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
          {analysis.slowest.map((c) => (
            <li key={c.id} className="bg-surface">
              <button type="button" onClick={() => showCase(c.id)} className="flex w-full items-baseline justify-between gap-4 px-4 py-3 text-left hover:bg-bg">
                <span className="min-w-0 truncate font-mono text-primary">{c.id}</span>
                <span className="shrink-0 font-mono text-xs text-ink-faint">
                  {c.steps} steps · {formatDuration(c.throughputMs)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <CaseDialog caseId={openCase} timeline={timeline} onClose={() => setOpenCase(null)} />
    </div>
  );
}

const WAIT_PARTS = [
  { key: "queueHours", label: "Queue (working hours)", className: "bg-[var(--primary)]" },
  { key: "offHoursHours", label: "Nights and weekends", className: "bg-[var(--line)]" },
  { key: "batchHours", label: "Batch run", className: "bg-[var(--ai-to)] opacity-60" },
  { key: "scheduledHours", label: "Planned date", className: "bg-[var(--dot)]" },
] as const;

/** Where a transition's waiting time went, as one stacked bar. */
function WaitBar({ breakdown }: { breakdown: Analysis["edges"][number]["breakdown"] }) {
  const total = WAIT_PARTS.reduce((s, p) => s + breakdown[p.key], 0);
  if (total <= 0) return null;
  return (
    <span className="mt-1.5 flex h-1.5 w-full max-w-xs overflow-hidden rounded-sm" role="img" aria-label={WAIT_PARTS.map((p) => `${p.label} ${Math.round((breakdown[p.key] / total) * 100)}%`).join(", ")}>
      {WAIT_PARTS.map((p) => (
        <span key={p.key} className={p.className} style={{ width: `${(breakdown[p.key] / total) * 100}%` }} />
      ))}
    </span>
  );
}

const NO_SETTINGS: AnalysisSettings = {};

function PricedRow({ cost, formula, children }: { cost: string; formula: string; children: React.ReactNode }) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <span className="min-w-0">{children}</span>
        <span className="shrink-0 font-mono">{cost}</span>
      </div>
      <p className="mt-0.5 font-mono text-[0.68rem] text-ink-faint">= {formula}</p>
    </li>
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
