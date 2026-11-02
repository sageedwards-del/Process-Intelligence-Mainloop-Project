"use client";

import { useState } from "react";
import type { LogMeta, Outcome, RootCauseRow, RootCauseView } from "@/lib/explorer/protocol";
import { formatInt } from "./format";

const PERCENTILES = [0.75, 0.9, 0.95];
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Pick an outcome; see which case segments are over-represented among those cases. */
export function RootCausePanel(props: {
  meta: LogMeta;
  report: RootCauseView | null;
  busy: boolean;
  onRun: (o: Outcome) => void;
  onFilter: (row: RootCauseRow) => void;
}) {
  const { meta, report } = props;
  const [kind, setKind] = useState<Outcome["kind"]>("slow");
  const [percentile, setPercentile] = useState(0.9);
  const [activity, setActivity] = useState(meta.activities[0] ?? "");
  const [ruleId, setRuleId] = useState(meta.rules[0]?.id ?? "");

  const outcome: Outcome =
    kind === "slow" ? { kind, percentile } : kind === "activity" ? { kind, activity } : { kind, ruleId };
  const field = "rounded-md border border-line bg-surface px-2.5 py-2 text-sm";

  return (
    <div>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          props.onRun(outcome);
        }}
      >
        <label className="min-w-0">
          <span className="eyebrow block text-[0.6rem] text-ink-faint">Explain</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as Outcome["kind"])} className={`${field} mt-1 block`}>
            <option value="slow">Slow cases</option>
            <option value="activity">Cases with an activity</option>
            {meta.rules.length > 0 && <option value="rule">A rule&rsquo;s violators</option>}
          </select>
        </label>
        {kind === "slow" && (
          <label className="min-w-0">
            <span className="eyebrow block text-[0.6rem] text-ink-faint">Slower than</span>
            <select value={percentile} onChange={(e) => setPercentile(Number(e.target.value))} className={`${field} mt-1 block`}>
              {PERCENTILES.map((p) => (
                <option key={p} value={p}>
                  {Math.round(p * 100)}th percentile
                </option>
              ))}
            </select>
          </label>
        )}
        {kind === "activity" && (
          <label className="min-w-0 max-w-full">
            <span className="eyebrow block text-[0.6rem] text-ink-faint">Activity</span>
            <select value={activity} onChange={(e) => setActivity(e.target.value)} className={`${field} mt-1 block max-w-full`}>
              {meta.activities.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
        )}
        {kind === "rule" && (
          <label className="min-w-0 max-w-full">
            <span className="eyebrow block text-[0.6rem] text-ink-faint">Rule</span>
            <select value={ruleId} onChange={(e) => setRuleId(e.target.value)} className={`${field} mt-1 block max-w-full`}>
              {meta.rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="eyebrow rounded-md bg-primary px-4 py-2.5 text-[0.6rem] text-primary-ink hover:bg-primary-hover">
          {props.busy ? "Analysing…" : "Analyse"}
        </button>
      </form>

      {report && (
        <div className="mt-6">
          <p className="text-sm text-ink-muted">
            Outcome: <span className="text-ink">{report.outcomeLabel}</span>,{" "}
            <span className="font-mono text-ink">{formatInt(report.outcomeCases)}</span> of{" "}
            <span className="font-mono text-ink">{formatInt(report.totalCases)}</span> cases in the current filter (
            <span className="font-mono">{pct(report.overallRate)}</span>). The segments below are{" "}
            <strong className="font-medium text-ink">correlated with</strong> that outcome; a segment can look bad because it gets the
            hardest work, so check with the people involved before calling it a cause.
          </p>
          {report.factors.length === 0 ? (
            <p className="mt-4 text-sm text-ink-muted">No segment is over-represented (or the outcome covers no case, or every case).</p>
          ) : (
            <ul className="mt-4 divide-y divide-line border-y border-line">
              {report.factors.map((f) => (
                <li key={f.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3">
                  <div className="min-w-0">
                    <p className="break-words">
                      {f.attribute.startsWith("passes:") ? (
                        <>
                          <span className="text-ink-muted">{f.value === "yes" ? "Passes through" : "Skips"}</span>{" "}
                          <span className="font-medium">{f.attribute.slice(7)}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-ink-muted">{f.attribute.startsWith("resource@") ? `Who did ${f.attribute.slice(9)}` : f.attribute}</span>{" "}
                          ={" "}
                          <span className="font-medium">
                            {f.attribute.startsWith("resource@") && f.value === "(missing)" ? "nobody (step not in the case)" : f.value}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="mt-1 font-mono text-xs text-ink-faint">
                      n={formatInt(f.cases)} · {pct(f.rate)} vs {pct(f.restRate)} for the rest · lift {f.lift.toFixed(2)}× ·{" "}
                      {formatInt(f.excessCases)} more than expected
                    </p>
                    <p className="mt-1 break-all font-mono text-[0.65rem] text-ink-faint">{f.id}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {f.significant && <Badge tone="strong">Significant</Badge>}
                    {f.smallSample && <Badge tone="warn">Small sample</Badge>}
                    {f.filter && (
                      <button
                        type="button"
                        onClick={() => props.onFilter(f)}
                        className="eyebrow rounded-md border border-line px-2.5 py-1.5 text-[0.55rem] text-ink-muted hover:border-primary hover:text-primary"
                      >
                        Filter
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-faint">
            Significant = at least 30 cases and |z| ≥ 3 on a two-proportion test (a strict bar, because many segments are compared). Small
            sample = fewer than 30 cases.
          </p>
        </div>
      )}
    </div>
  );
}

function Badge({ tone, children }: { tone: "strong" | "warn"; children: React.ReactNode }) {
  const cls = tone === "strong" ? "border-primary/50 text-primary" : "border-[#b54708]/50 text-[#b54708]";
  return <span className={`eyebrow rounded-full border px-2 py-0.5 text-[0.55rem] ${cls}`}>{children}</span>;
}
