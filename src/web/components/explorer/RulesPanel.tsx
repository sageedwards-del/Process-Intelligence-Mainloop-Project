"use client";

import type { RuleRow } from "@/lib/explorer/protocol";
import { formatInt, formatMoney } from "./format";

const TYPE_LABEL: Record<RuleRow["type"], string> = {
  precedence: "Order",
  segregation: "Four eyes",
  requires: "Required step",
  sla: "Time limit",
  duplicate: "Duplicate",
};

/** Each business rule with its violations; a click filters the explorer to the violating cases. */
export function RulesPanel(props: {
  rules: RuleRow[];
  currency: string;
  emptyNote: React.ReactNode;
  onFilter: (rule: RuleRow) => void;
  onOpenCase: (id: string) => void;
}) {
  if (props.rules.length === 0) return <div className="mt-4 text-sm text-ink-muted">{props.emptyNote}</div>;
  return (
    <ul className="mt-4 divide-y divide-line border-y border-line">
      {props.rules.map((r) => (
        <li key={r.id} className="py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow text-[0.55rem] text-ink-faint">{TYPE_LABEL[r.type]}</p>
              <p className="mt-1 font-medium">{r.name}</p>
              <p className="mt-1 font-mono text-xs text-ink-faint">
                {formatInt(r.violations)} of {formatInt(r.casesChecked)} cases checked · {(r.rate * 100).toFixed(1)}%
              </p>
            </div>
            <span className="shrink-0 text-right font-mono">{r.violations > 0 && r.cost > 0 ? formatMoney(r.cost, props.currency) : "–"}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-ink-faint">{r.formula}</p>
          {r.violations > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => props.onFilter(r)}
                className="eyebrow rounded-md border border-primary px-3 py-1.5 text-[0.6rem] text-primary hover:bg-primary hover:text-primary-ink"
              >
                Show {formatInt(r.caseIds.length)} violating cases
              </button>
              <details className="min-w-0 text-sm">
                <summary className="cursor-pointer text-ink-muted hover:text-ink">Examples</summary>
                <ul className="mt-2 space-y-1.5">
                  {r.examples.map((v, i) => (
                    <li key={`${v.caseId}-${i}`} className="min-w-0">
                      <button type="button" onClick={() => props.onOpenCase(v.caseId)} className="font-mono text-primary underline-offset-4 hover:underline">
                        {v.caseId}
                      </button>{" "}
                      <span className="break-words text-ink-muted">{v.detail}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
