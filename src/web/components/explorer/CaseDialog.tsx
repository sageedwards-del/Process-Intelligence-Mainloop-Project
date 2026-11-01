"use client";

import { useEffect, useRef } from "react";
import type { AttrValue, CaseTimeline } from "@throughline/engine";
import { formatDuration } from "./format";

const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
const show = (v: AttrValue) => (v === null ? "(missing)" : typeof v === "number" ? v.toLocaleString("en") : String(v));

/** One case's timeline in a modal: events in order, the wait before each, who did it, attributes. */
export function CaseDialog(props: { caseId: string | null; timeline: CaseTimeline | null | undefined; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = props.caseId !== null;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const t = props.timeline;
  const longest = t ? Math.max(1, ...t.events.map((e) => e.waitMs)) : 1;

  return (
    <dialog
      ref={ref}
      onClose={props.onClose}
      onClick={(e) => e.target === ref.current && props.onClose()}
      aria-labelledby="case-title"
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl border-l border-line bg-surface p-0 text-ink backdrop:bg-ink/30"
    >
      <div className="flex items-start justify-between gap-4 border-b border-line p-5">
        <div className="min-w-0">
          <p className="eyebrow text-[0.6rem] text-primary">Case</p>
          <h2 id="case-title" className="mt-1 break-all font-mono text-xl">
            {props.caseId}
          </h2>
          {t && (
            <p className="mt-1 font-mono text-xs text-ink-faint">
              {t.events.length} events · {formatDuration(t.throughputMs)} end to end · {when(t.start)} → {when(t.end)} UTC
            </p>
          )}
        </div>
        <button type="button" onClick={props.onClose} aria-label="Close case" className="grid size-9 shrink-0 place-items-center rounded-md border border-line text-lg">
          ×
        </button>
      </div>

      {t === undefined && <p className="p-5 text-ink-faint">Loading the case…</p>}
      {t === null && <p className="p-5 text-ink-muted">This case isn&rsquo;t in the log.</p>}
      {t && (
        <div className="p-5">
          {Object.keys(t.attrs).length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {Object.entries(t.attrs).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-faint">{k}</dt>
                  <dd className="min-w-0 break-words font-mono">{show(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          <ol className="mt-6">
            {t.events.map((e, i) => (
              <li key={i}>
                {i > 0 && (
                  <div className="flex items-center gap-3 py-1.5 pl-[5px]">
                    <span className="h-6 w-px bg-line" />
                    <span className="h-1 rounded bg-[#d97706]/70" style={{ width: `${Math.max(2, (e.waitMs / longest) * 120)}px` }} />
                    <span className="font-mono text-xs text-ink-faint">waited {formatDuration(e.waitMs)}</span>
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-primary bg-surface" />
                  <div className="min-w-0">
                    <p className="font-medium">{e.activity}</p>
                    <p className="font-mono text-xs text-ink-faint">
                      {when(e.timestamp)} UTC{e.resource ? ` · ${e.resource}` : ""}
                    </p>
                    {Object.keys(e.attrs).length > 0 && (
                      <p className="mt-0.5 break-words font-mono text-xs text-ink-muted">
                        {Object.entries(e.attrs)
                          .map(([k, v]) => `${k}: ${show(v)}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </dialog>
  );
}
