import Link from "next/link";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AiPanel } from "@/components/ai/AiPanel";
import { Explorer } from "@/components/explorer/Explorer";
import { ModelPanel } from "@/components/miner/ModelPanel";
import { DEMO_MINER_OUTPUTS } from "@/lib/miner/demoOutputs";
import { DEMOS, type Demo, type DemoId } from "@/lib/analysis/demos";
import { DemoIcon } from "./DemoArt";

const HREF: Record<DemoId, string> = { bpic2020: "/sample", meridian: "/sample/meridian" };

const STEPS = [
  { id: "choose", title: "Choose data", text: "Real or synthetic" },
  { id: "process", title: "Discover the process", text: "The map and the numbers" },
  { id: "insights", title: "AI-powered insights", text: "Summary and recommended actions" },
];

/** The four counts on the explorer, in plain words, with this demo's examples. */
function terms(d: Demo) {
  return [
    {
      term: "Cases",
      means: "One run of the process from start to finish.",
      example: `Here, ${d.terms.caseIs}.`,
      read: "The volume of work. Filters show how many cases match.",
    },
    {
      term: "Events",
      means: "One recorded step in a case, with when it happened.",
      example: `For example ${d.terms.eventExample}.`,
      read: "Events per case show how long the typical path is; the gaps between them are the waits.",
    },
    {
      term: "Activities",
      means: "A kind of step: the boxes on the map.",
      example: `For example ${d.terms.activityExample}.`,
      read: "Few activities means a simple process; repeats of one in a case are rework.",
    },
    {
      term: "Variants",
      means: "One exact route through the process: the same steps in the same order.",
      example: "The process is all its variants together; every case follows exactly one, and one extra or skipped step makes a new one.",
      read: "A few variants covering most cases means a standard process; hundreds means exceptions. The top one is the usual route; long, rare ones often hide rework.",
    },
  ];
}

function StepHeading({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-6">
      <p className="font-mono text-[0.75rem] text-primary">Step {n}</p>
      <h2 className="mt-1 text-2xl font-medium tracking-[-0.01em] sm:text-3xl">{title}</h2>
      <div className="mt-3 max-w-3xl leading-relaxed text-ink-muted">{children}</div>
    </div>
  );
}

/** A public demo, laid out as three steps: choose data, discover the process, generate insights. */
export function DemoPage({ id }: { id: DemoId }) {
  const demo = DEMOS[id];
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
          <p className="eyebrow text-primary">Demo</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-medium tracking-[-0.02em]">
            See what the Process Discovery Engine does with event data.
          </h1>
          <p className="mt-4 max-w-3xl leading-relaxed text-ink-muted">
            Pick a log below. The engine counts its cases, events, activities and variants, draws the process as a map, and
            finds where work waits, loops back or breaks the rules. AI then turns those figures into recommended actions
            and a go / no-go recommendation, and code checks every number it cites.
          </p>

          <ol className="mt-8 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.id} className="bg-surface">
                <a href={`#${s.id}`} className="flex h-full items-center gap-4 p-4 transition hover:bg-bg">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-mono text-sm text-primary-ink">
                    {i + 1}
                  </span>
                  <span>
                    <span className="block font-medium">{s.title}</span>
                    <span className="block text-sm text-ink-muted">{s.text}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>

          <section className="mt-16">
            <StepHeading n={1} id="choose" title="Choose data">
              <p>Real data shows how the engine copes with a genuine log; synthetic data has known answers to check it against.</p>
            </StepHeading>
            <nav aria-label="Demo data" className="mt-6 grid gap-3 sm:grid-cols-2">
              {Object.values(DEMOS).map((d) => {
                const current = d.id === id;
                return (
                  <Link
                    key={d.id}
                    href={HREF[d.id]}
                    aria-current={current ? "page" : undefined}
                    className={`rounded-xl border p-4 transition ${current ? "border-primary bg-surface ring-1 ring-primary" : "border-line bg-surface hover:border-ink-faint"}`}
                  >
                    <span className="flex items-start gap-4">
                      <DemoIcon id={d.id} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="eyebrow text-[0.65rem] text-primary">{d.label}</span>
                          {current && <span className="eyebrow rounded bg-primary px-2 py-0.5 text-[0.55rem] text-primary-ink">Showing</span>}
                        </span>
                        <span className="mt-2 block text-sm leading-relaxed text-ink-muted">{d.summary}</span>
                      </span>
                    </span>
                  </Link>
                );
              })}
            </nav>
            <div className="mt-8 grid gap-6 rounded-xl border border-line bg-surface p-5 sm:p-6 md:grid-cols-[1fr_16rem] md:items-center">
              <div>
              <p className="eyebrow text-[0.65rem] text-ink-faint">{demo.eyebrow}</p>
              <h3 className="mt-2 text-xl font-medium">{demo.title}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-muted">{demo.intro}</p>
              {demo.source && (
                <p className="mt-3 max-w-3xl font-mono text-[0.72rem] leading-relaxed text-ink-faint">
                  Data:{" "}
                  <a href={demo.source.href} className="underline underline-offset-2 hover:text-ink-muted">
                    {demo.source.text}
                  </a>
                  {" · "}
                  <a href={demo.source.licenceHref} className="underline underline-offset-2 hover:text-ink-muted">
                    {demo.source.licence}
                  </a>
                  , converted
                </p>
              )}
              </div>
              <div aria-hidden className="dot-grid hidden h-44 place-items-center rounded-xl border border-line md:grid">
                <DemoIcon id={id} size="lg" />
              </div>
            </div>
          </section>

          <section className="mt-16">
            <StepHeading n={2} id="process" title="Discover the process">
              <p>The numbers first, then the map of how cases actually flowed. New to the terms? Open the guide below.</p>
            </StepHeading>
            <details className="group mt-6 rounded-xl border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 [&::-webkit-details-marker]:hidden">
                <span>
                  <span className="block font-medium">Understanding process discovery terminology</span>
                  <span className="block text-sm text-ink-muted">Cases, events, activities and variants, and how to read the map</span>
                </span>
                <span aria-hidden className="font-mono text-lg text-primary transition group-open:rotate-45">+</span>
              </summary>
              <div className="border-t border-line p-5">
            <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {terms(demo).map((t) => (
                // Subgrid rows line up the term, definition and "how to read it" across each row of cards.
                <div key={t.term} className="row-span-3 grid grid-rows-subgrid gap-y-0 bg-surface p-5">
                  <dt className="font-medium">{t.term}</dt>
                  <dd className="mt-2 text-sm leading-relaxed">
                    {t.means} <span className="text-ink-muted">{t.example}</span>
                  </dd>
                  <dd className="mt-4 border-t border-line pt-3 text-sm leading-relaxed text-ink-muted">
                    <span className="font-mono text-[0.7rem] text-primary">How to read it · </span>
                    {t.read}
                  </dd>
                </div>
              ))}
            </dl>
            <ul className="mt-6 grid gap-2 text-sm leading-relaxed text-ink-muted sm:grid-cols-3 sm:gap-6">
              <li>
                <span className="font-medium text-ink">The map.</span> Boxes are activities; an arrow means one step directly
                followed another, and thicker means more cases. The teal line is the most common path.
              </li>
              <li>
                <span className="font-medium text-ink">Waits.</span> Switch the map to median wait to colour arrows by how long
                cases sat between those steps. Sliders hide rare steps and paths.
              </li>
              <li>
                <span className="font-medium text-ink">Below the map.</span> Variants (the common routes), Bottlenecks (where time
                goes), Rules (what broke policy) and Root causes (which kinds of cases run slow).
              </li>
            </ul>
              </div>
            </details>
            <div className="mt-8">
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
              <ModelPanel key={`model-${id}`} target={id} initial={DEMO_MINER_OUTPUTS[id]} signInNext={HREF[id]} />
            </div>
          </section>

          <section className="mt-16">
            <StepHeading n={3} id="insights" title="AI-powered insights">
              <p>
                Press <strong className="font-medium text-ink">Generate insights</strong> for a short summary of how the
                process runs and data-backed recommendations on what to change. Each recommendation is an action you can take,
                with the evidence behind it, its expected impact and first steps, ordered by money or risk at stake. Every
                figure is checked against the engine before it&rsquo;s shown. <strong className="font-medium text-ink">Ask</strong>{" "}
                answers a question in plain English, and <strong className="font-medium text-ink">Memo</strong> drafts a go /
                no-go recommendation with the savings sized in code. Needs a free sign-in, because each run is a real API call.
              </p>
            </StepHeading>
            <AiPanel target={id} signInNext={`${HREF[id]}#insights`} />
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
