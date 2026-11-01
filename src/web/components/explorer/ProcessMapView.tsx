"use client";

import type { Kpi, MapView } from "@/lib/explorer/protocol";
import { formatDuration, formatInt } from "./format";

/** Teal for quick hand-offs through amber to red for the slowest, relative to the edges on screen. */
function waitColour(t: number): string {
  const stops = [
    [36, 104, 110],
    [181, 71, 8],
    [180, 35, 24],
  ];
  const x = Math.min(1, Math.max(0, t)) * 2;
  const i = Math.min(1, Math.floor(x));
  const f = x - i;
  const [a, b] = [stops[i]!, stops[i + 1]!];
  return `rgb(${a.map((v, k) => Math.round(v + (b[k]! - v) * f)).join(",")})`;
}

export function ProcessMapView({ view, kpi, zoom }: { view: MapView; kpi: Kpi; zoom: number }) {
  const maxFreq = Math.max(1, ...view.edges.map((e) => e.frequency));
  const waits = view.edges.filter((e) => !e.boundary).map((e) => e.medianWaitMs);
  const maxWait = Math.max(1, ...waits);
  const path = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${view.width} ${view.height}`}
      width={view.width * zoom}
      height={view.height * zoom}
      role="img"
      aria-label={`Process map: ${view.activitiesShown} activities and ${view.edgesShown} paths`}
      className="mx-auto block"
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="9"
          markerHeight="9"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-faint)" />
        </marker>
      </defs>

      <g fill="none">
        {view.edges.map((e) => {
          const colour =
            kpi === "median" && !e.boundary ? waitColour(e.medianWaitMs / maxWait) : e.happy ? "var(--primary)" : "var(--ink-faint)";
          return (
            <path
              key={e.id}
              d={path(e.points)}
              stroke={colour}
              strokeOpacity={e.happy || kpi === "median" ? 0.9 : 0.55}
              strokeWidth={1 + (e.frequency / maxFreq) * 6}
              strokeLinejoin="round"
              markerEnd="url(#arrow)"
            >
              <title>{`${formatInt(e.frequency)} times · median wait ${formatDuration(e.medianWaitMs)}`}</title>
            </path>
          );
        })}
      </g>

      <g className="font-mono" fontSize={10.5}>
        {view.edges.map((e) => {
          if (kpi === "median" && e.boundary) return null;
          const text = kpi === "frequency" ? formatInt(e.frequency) : formatDuration(e.medianWaitMs);
          const w = text.length * 6.6 + 10;
          return (
            <g key={e.id} transform={`translate(${e.labelAt.x},${e.labelAt.y})`}>
              <rect x={-w / 2} y={-9} width={w} height={18} rx={4} fill="var(--surface)" stroke="var(--line)" />
              <text textAnchor="middle" y={4} fill="var(--ink-muted)">
                {text}
              </text>
            </g>
          );
        })}
      </g>

      <g>
        {view.nodes.map((n) =>
          n.kind === "activity" ? (
            <g key={n.id} transform={`translate(${n.x},${n.y})`}>
              <rect width={n.w} height={n.h} rx={8} fill="var(--surface)" stroke="var(--ink)" strokeOpacity={0.25} />
              <text x={n.w / 2} y={19} textAnchor="middle" fontSize={13} fontWeight={500} fill="var(--ink)">
                {n.label}
              </text>
              <text x={n.w / 2} y={35} textAnchor="middle" fontSize={10.5} className="font-mono" fill="var(--ink-faint)">
                {formatInt(n.frequency)}
              </text>
            </g>
          ) : (
            <g key={n.id} transform={`translate(${n.x + n.w / 2},${n.y + n.h / 2})`}>
              <circle r={n.w / 2} fill={n.kind === "start" ? "var(--primary)" : "var(--ink)"} />
              <text x={n.w / 2 + 6} y={4} fontSize={11} className="font-mono" fill="var(--ink-faint)">
                {n.label}
              </text>
            </g>
          ),
        )}
      </g>
    </svg>
  );
}
