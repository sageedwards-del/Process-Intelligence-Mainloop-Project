import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AiPanel } from "@/components/ai/AiPanel";
import { Explorer } from "@/components/explorer/Explorer";
import { DEMOS, type DemoId } from "@/lib/analysis/demos";

const HREF: Record<DemoId, string> = { bpic2020: "/sample", meridian: "/sample/meridian" };

/** A public demo: the picker, its description and source, the explorer and Claude's panel. */
export function DemoPage({ id }: { id: DemoId }) {
  const demo = DEMOS[id];
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
          <nav aria-label="Demo data" className="flex flex-wrap gap-2">
            {Object.values(DEMOS).map((d) => (
              <Link
                key={d.id}
                href={HREF[d.id]}
                aria-current={d.id === id ? "page" : undefined}
                className={`eyebrow rounded-full px-4 py-2 text-[0.65rem] transition ${
                  d.id === id ? "bg-primary text-primary-ink" : "border border-line text-ink-muted hover:border-ink-faint"
                }`}
              >
                {d.label}
              </Link>
            ))}
          </nav>
          <p className="eyebrow mt-8 text-primary">{demo.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">{demo.title}</h1>
          <p className="mt-3 max-w-3xl leading-relaxed text-ink-muted">
            {demo.intro} Drag the sliders to simplify the map, filter the cases, check the business rules, ask which kinds of
            cases run slow, or open a single case to see its timeline.
          </p>
          {demo.source && (
            <p className="mt-3 max-w-3xl font-mono text-[0.72rem] leading-relaxed text-ink-faint">
              Data:{" "}
              <a href={demo.source.href} className="underline underline-offset-2 hover:text-ink-muted">
                {demo.source.text}
              </a>
              , licensed{" "}
              <a href={demo.source.licenceHref} className="underline underline-offset-2 hover:text-ink-muted">
                {demo.source.licence}
              </a>
              . Converted from XES and re-encoded for the engine. Checked against published analyses in{" "}
              <Link href="/#validation" className="underline underline-offset-2 hover:text-ink-muted">
                the validation
              </Link>
              .
            </p>
          )}
          <div className="mt-10">
            {demo.snapshotPath ? (
              <Explorer
                key={id}
                source={{ kind: "snapshot", url: demo.snapshotPath }}
                cost={demo.inputs.cost}
                rules={demo.inputs.rules}
                costNote={demo.costNote}
              />
            ) : (
              <Explorer key={id} source={{ kind: "sample" }} costNote={demo.costNote} />
            )}
            <AiPanel target={id} signInNext={HREF[id]} />
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
