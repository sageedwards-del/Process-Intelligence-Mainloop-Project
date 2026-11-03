"use client";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ConformanceResult, ModelResult } from "@/lib/miner/contract";
import { formatInt } from "../explorer/format";

type Tab = "model" | "conformance";

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/**
 * The mining service's views (pm4py, src/miner): the process as a BPMN model from the
 * Inductive Miner, and how well each case fits a reference by token replay. A demo passes its
 * committed results in `initial`; a dataset runs on request, since each run uses the service.
 */
export function ModelPanel({
  target,
  initial,
  signInNext,
}: {
  target: string;
  initial?: { model: ModelResult; conformance: ConformanceResult };
  signInNext: string;
}) {
  const isDemo = Boolean(initial);
  const [tab, setTab] = useState<Tab>("model");
  const [model, setModel] = useState<ModelResult | null>(initial?.model ?? null);
  const [conformance, setConformance] = useState<ConformanceResult | null>(initial?.conformance ?? null);
  const [busy, setBusy] = useState<Tab | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  async function run(kind: Tab) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(`/api/miner/${target}/${kind}`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError({ status: res.status, message: body.error ?? `The mining service failed (${res.status}).` });
      if (kind === "model") setModel(body as ModelResult);
      else setConformance(body as ConformanceResult);
    } catch {
      setError({ status: 0, message: "The request failed. Check your connection." });
    } finally {
      setBusy(null);
    }
  }

  const result = tab === "model" ? model : conformance;

  return (
    <section className="mt-12 min-w-0 rounded-xl border border-line bg-surface" aria-labelledby="model-panel-title">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-4 pt-5 sm:px-6">
        <div className="pb-4">
          <p className="eyebrow text-primary">Mining service · pm4py</p>
          <h2 id="model-panel-title" className="mt-2 text-xl font-medium">
            Process model and conformance
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-muted">
            The map above shows what happened. Here the Inductive Miner turns the log into a BPMN model (with choices, loops and parallel steps made
            explicit), and token replay checks each case against the way most cases go.
          </p>
        </div>
        <div role="tablist" aria-label="Mining views" className="flex gap-1">
          {(["model", "conformance"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`eyebrow border-b-2 px-3 pb-3 text-[0.65rem] ${tab === t ? "border-primary text-ink" : "border-transparent text-ink-faint hover:text-ink"}`}
            >
              {t === "model" ? "BPMN model" : "Conformance"}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-6 sm:px-6" role="tabpanel" aria-label={tab === "model" ? "BPMN model" : "Conformance"}>
        {error &&
          (error.status === 401 ? (
            <p className="text-sm text-ink-muted">
              <Link href={`/login?next=${encodeURIComponent(signInNext)}`} className="text-primary underline-offset-4 hover:underline">
                Sign in
              </Link>{" "}
              to run the mining service on this dataset.
            </p>
          ) : (
            <p role="alert" className="text-sm text-[#b42318]">
              {error.message}
            </p>
          ))}

        {busy === tab ? (
          <p className="py-10 text-center text-sm text-ink-faint" aria-live="polite">
            {tab === "model" ? "Discovering the model…" : "Replaying every case on the reference…"} This can take a minute on a large log.
          </p>
        ) : !result ? (
          !isDemo && (
            <div className="dot-grid rounded-lg border border-dashed border-line px-4 py-10 text-center">
              <p className="mx-auto max-w-xl text-sm text-ink-muted">
                {tab === "model"
                  ? "Send this dataset's events to the mining service and draw the discovered BPMN model."
                  : "Replay every case on a reference built from the most common paths, and see which cases and steps don't fit."}
              </p>
              <button type="button" onClick={() => run(tab)} className="eyebrow mt-5 rounded-md bg-primary px-4 py-2 text-[0.65rem] text-primary-ink hover:bg-primary-hover">
                {tab === "model" ? "Discover the BPMN model" : "Check conformance"}
              </button>
            </div>
          )
        ) : tab === "model" ? (
          <ModelView model={model!} />
        ) : (
          <ConformanceView result={conformance!} />
        )}
      </div>
    </section>
  );
}

function ModelView({ model }: { model: ModelResult }) {
  const s = model.stats;
  return (
    <div>
      <p className="text-sm text-ink-muted">
        Inductive Miner (infrequent), noise threshold <span className="font-mono">{model.noiseThreshold}</span>: paths taken by fewer than{" "}
        {Math.round(model.noiseThreshold * 100)}% of the cases at each point are left out so the model stays readable. Built from{" "}
        <span className="font-mono">{formatInt(s.cases)}</span> cases, <span className="font-mono">{formatInt(s.events)}</span> events,{" "}
        <span className="font-mono">{formatInt(s.activities)}</span> activities. Drag to pan, scroll to zoom.
      </p>
      <BpmnDiagram xml={model.bpmnXml} label="Discovered BPMN process model" />
    </div>
  );
}

function ConformanceView({ result: r }: { result: ConformanceResult }) {
  const [showReference, setShowReference] = useState(false);
  const stats: [string, string][] = [
    ["Cases that fit", pct(r.conformanceRate)],
    ["Fitting / all", `${formatInt(r.fitCases)} / ${formatInt(r.cases)}`],
    ["Average fitness", r.averageFitness.toFixed(3)],
    ["Log fitness", r.logFitness.toFixed(3)],
  ];
  const maxWeek = Math.max(1, ...r.weekly.map((w) => w.cases));
  return (
    <div className="min-w-0">
      <p className="max-w-3xl text-sm text-ink-muted">
        Reference: the {r.reference.variants.length === 1 ? "most common path" : `${r.reference.variants.length} most common paths`}, taken by{" "}
        <span className="font-mono">{pct(r.reference.share)}</span> of cases, standing in for the intended process. A case fits when it replays on
        that model with no missing or leftover tokens; fitness runs from 0 to 1. This shows where cases differ from the usual path, not whether the
        difference is wrong: check it with the people who do the work.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <dt className="eyebrow text-[0.6rem] text-ink-faint">{k}</dt>
            <dd className="mt-1 font-mono text-lg">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="eyebrow text-[0.65rem] text-ink-muted">Steps that don&rsquo;t fit, by cases</h3>
          {r.deviations.length === 0 ? (
            <p className="mt-3 text-sm text-ink-faint">Every case fits the reference.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {r.deviations.map((d) => (
                <li key={d.activity} className="flex min-w-0 items-baseline justify-between gap-4 text-sm">
                  <span className="min-w-0 break-words">{d.activity}</span>
                  <span className="shrink-0 font-mono text-ink-muted">{formatInt(d.cases)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="eyebrow text-[0.65rem] text-ink-muted">Share of cases that fit, by week started</h3>
          <div className="mt-3 flex h-32 items-end gap-px overflow-hidden" role="img" aria-label={`Weekly conformance across ${r.weekly.length} weeks`}>
            {r.weekly.map((w) => (
              <div
                key={w.week}
                className="min-w-px flex-1 bg-primary"
                style={{ height: `${Math.max(2, w.rate * 100)}%`, opacity: 0.35 + 0.65 * (w.cases / maxWeek) }}
                title={`${w.week}: ${pct(w.rate)} of ${formatInt(w.cases)} cases`}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-faint">
            {r.weekly[0]?.weekStart} to {r.weekly.at(-1)?.weekStart}. Paler bars are weeks with fewer cases.
          </p>
        </div>
      </div>

      {r.worstCases.length > 0 && (
        <details className="group mt-8 border-t border-line pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
            <span className="eyebrow text-[0.65rem] text-ink-muted">
              Lowest-fitness cases <span className="text-ink-faint">· {r.worstCases.length}</span>
            </span>
            <span aria-hidden className="font-mono text-sm text-primary transition group-open:rotate-45">+</span>
          </summary>
          <ul className="mt-3 space-y-2 text-sm">
            {r.worstCases.map((c) => (
              <li key={c.caseId} className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-mono">{c.caseId}</span>
                <span className="font-mono text-ink-muted">{c.fitness.toFixed(3)}</span>
                <span className="min-w-0 break-words text-ink-faint">{c.deviating.join(", ") || "order differs from the reference"}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {r.reference.bpmnXml && (
        <div className="mt-6">
          <button type="button" onClick={() => setShowReference((v) => !v)} className="eyebrow rounded-md border border-line px-3 py-2 text-[0.65rem] hover:border-ink-faint">
            {showReference ? "Hide the reference model" : "Show the reference model"}
          </button>
          {showReference && <BpmnDiagram xml={r.reference.bpmnXml} label="Reference BPMN model" />}
        </div>
      )}
    </div>
  );
}

/** bpmn-js's read-only viewer with pan and zoom. Its bpmn.io watermark must stay visible (bpmn-js licence). */
function BpmnDiagram({ xml, label }: { xml: string; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let viewer: { destroy(): void } | null = null;
    let live = true;
    (async () => {
      const { default: NavigatedViewer } = await import("bpmn-js/lib/NavigatedViewer");
      if (!live || !host.current) return;
      const v = new NavigatedViewer({ container: host.current });
      viewer = v;
      try {
        await v.importXML(xml);
        (v.get("canvas") as { zoom(level: string): void }).zoom("fit-viewport");
      } catch (e) {
        if (live) setFailed(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
      viewer?.destroy();
    };
  }, [xml]);

  if (failed) {
    return (
      <p role="alert" className="mt-4 text-sm text-[#b42318]">
        Couldn&rsquo;t draw the model: {failed}
      </p>
    );
  }
  return <div ref={host} role="img" aria-label={label} className="dot-grid mt-4 h-[420px] w-full overflow-hidden rounded-lg border border-line bg-surface sm:h-[520px]" />;
}
