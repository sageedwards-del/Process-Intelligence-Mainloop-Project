"use client";

import type { Figure, Metric, MetricBundle } from "@/lib/ai/metrics";
import { formatMoney } from "../explorer/format";

/** A figure as the page shows it, by unit. */
export function formatFigure(f: Figure, currency: string): string {
  switch (f.unit) {
    case "money":
      return formatMoney(f.value, currency);
    case "share":
      return `${+(f.value * 100).toFixed(1)}%`;
    case "ratio":
      return `${+f.value.toFixed(2)}×`;
    case "hours":
      return `${+f.value.toFixed(1)} h`;
    case "days":
      return `${+f.value.toFixed(1)} d`;
    case "minutes":
      return `${+f.value.toFixed(1)} min`;
    default:
      return Number.isInteger(f.value) ? f.value.toLocaleString("en") : `${+f.value.toFixed(2)}`;
  }
}

/** "costs" → "cost", "medianWaitHours" → "median wait hours". */
const words = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

const CITATION = /\[\[([^\]]+)\]\]/g;

/** Claude's text with each [[metric id]] as a small numbered marker pointing at the sources list, and **bold** as bold. */
export function CitedText({ text, order }: { text: string; order: string[] }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
        i % 2 ? (
          <strong key={i} className="font-medium">
            <Citations text={part} order={order} />
          </strong>
        ) : (
          <Citations key={i} text={part} order={order} />
        ),
      )}
    </>
  );
}

function Citations({ text, order }: { text: string; order: string[] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    parts.push(text.slice(last, m.index));
    const id = m[1]!.trim().replace(/\s*(?:->|→)\s*/g, " → ");
    const n = order.indexOf(id) + 1;
    parts.push(
      <sup key={m.index} className="ml-0.5 font-mono text-[0.65rem] text-primary" title={id}>
        [{n || "?"}]
      </sup>,
    );
    last = m.index! + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

/** The metric IDs cited across some texts, in order of first use. */
export function citationOrder(texts: string[]): string[] {
  const ids: string[] = [];
  for (const t of texts) for (const m of t.matchAll(CITATION)) {
    const id = m[1]!.trim().replace(/\s*(?:->|→)\s*/g, " → ");
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** The numbered sources under a piece of Claude's text: each metric's ID, figures and formula. */
export function Sources({ order, metrics, currency }: { order: string[]; metrics: MetricBundle; currency: string }) {
  if (!order.length) return null;
  return (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer text-ink-muted hover:text-ink">Sources: {order.length} metric{order.length === 1 ? "" : "s"} from the engine</summary>
      <ol className="mt-2 space-y-2">
        {order.map((id, i) => (
          <SourceRow key={id} n={i + 1} id={id} metric={metrics[id]} currency={currency} />
        ))}
      </ol>
    </details>
  );
}

function SourceRow({ n, id, metric, currency }: { n: number; id: string; metric?: Metric; currency: string }) {
  return (
    <li className="min-w-0">
      <p className="break-words font-mono text-xs text-primary">
        [{n}] {id}
      </p>
      {metric && (
        <>
          <p className="text-ink-muted">{metric.label}</p>
          <p className="mt-0.5 break-words font-mono text-xs text-ink-faint">
            {Object.entries(metric.figures)
              .map(([k, f]) => `${words(k)} ${formatFigure(f, currency)}`)
              .join(" · ")}
          </p>
          {metric.formula && <p className="mt-0.5 break-words font-mono text-xs text-ink-faint">{metric.formula}</p>}
        </>
      )}
    </li>
  );
}
