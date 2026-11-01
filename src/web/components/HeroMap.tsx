import type { CSSProperties } from "react";
import { buildHeroMap } from "@/lib/heroMap";

const PAD = 60;

/** Seeded scatter of faint dots behind the map, so the field feels like data rather than a flat fill. */
function starfield(width: number, height: number, n: number) {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => ({ x: rnd() * width, y: rnd() * height, r: 0.5 + rnd() * 1.1, o: 0.08 + rnd() * 0.25 }));
}

export async function HeroMap() {
  const map = await buildHeroMap();
  // Room on the left for rework arcs and on the right for labels and the callout.
  const left = -PAD - 140;
  const w = Math.max(map.width, map.callout.x + 380) + PAD + 140;
  const h = map.height + PAD * 2;
  const happy = map.edges.filter((e) => e.happy);

  return (
    <svg
      viewBox={`${left} ${-PAD} ${w} ${h}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label={`Process map of ${map.cases.toLocaleString("en")} sample invoices: ${map.nodes.length - 2} activities, ${map.edges.length} paths`}
    >
      <g>
        {starfield(w, h, 160).map((d, i) => (
          <circle key={i} cx={d.x + left} cy={d.y - PAD} r={d.r} fill="var(--map-node)" opacity={d.o * 0.5} />
        ))}
      </g>

      <g fill="none">
        {map.edges.map((e) => (
          <path
            key={e.id}
            d={e.path}
            stroke="var(--map-edge)"
            strokeWidth={0.6 + e.weight * 2.4}
            opacity={e.happy ? 0.75 : 0.18 + e.weight * 0.3}
          />
        ))}
      </g>

      {happy.flatMap((e, i) =>
        [0, 1].map((k) => (
          <circle
            key={`${e.id}-${k}`}
            r={2.2}
            fill="var(--map-node)"
            className="case-token"
            style={{ offsetPath: `path("${e.path}")`, "--dur": `${3 + (i % 3)}s`, "--delay": `${i * 0.45 + k * 1.6}s` } as CSSProperties}
          />
        )),
      )}

      <g>
        {map.nodes.map((n) => {
          const r = n.id === "start" || n.id === "end" ? 4 : 3.5 + n.weight * 5;
          return (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={r + 6} fill="var(--map-edge)" opacity={0.08} />
              <circle cx={n.x} cy={n.y} r={r} fill="var(--map-node)" />
              <text
                x={n.x + r + 10}
                y={n.y + 3.5}
                fill="var(--map-muted)"
                className="font-mono"
                fontSize={10}
                letterSpacing="0.04em"
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </g>

      <circle cx={map.callout.x} cy={map.callout.y} r={15} fill="none" stroke="var(--map-edge)" strokeOpacity={0.7} />
      <g transform={`translate(${map.callout.x + 150}, ${map.callout.y - 24})`} className="font-mono">
        <path d="M-34,24 L-12,24" stroke="var(--map-edge)" strokeOpacity={0.6} strokeDasharray="2 3" />
        <rect x={-12} y={0} width={232} height={46} rx={6} fill="var(--map-callout)" stroke="var(--map-edge)" strokeOpacity={0.5} />
        <text x={0} y={19} fill="var(--map-edge)" fontSize={9.5} letterSpacing="0.03em">
          {map.callout.id}
        </text>
        <text x={0} y={35} fill="var(--map-muted)" fontSize={9.5}>
          approvals wait {map.callout.slowdown.toFixed(1)}× longer than peers
        </text>
      </g>
    </svg>
  );
}
