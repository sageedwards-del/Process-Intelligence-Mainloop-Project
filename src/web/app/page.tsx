import Link from "next/link";
import { HeroMap } from "@/components/HeroMap";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { REPO } from "@/lib/site";
import { FAQ } from "./faq";
import { VALIDATION } from "./validation";

const STEPS = [
  {
    n: "01",
    title: "Upload an export",
    soon: false,
    body: "A CSV export from your finance or ticketing system. Confirm the case, activity and timestamp columns and get a data-quality report before anything is saved.",
  },
  {
    n: "02",
    title: "See how work really flows",
    body: "A process map built from what happened, not the policy document. Find where cases wait, loop back, or skip a control, measured in business hours.",
  },
  {
    n: "03",
    title: "Decide what's worth fixing",
    body: "Each bottleneck is priced in labour, time and compliance, with the formula shown. Claude drafts a go / no-go memo from those figures, and code checks each one, so “not worth fixing” can be an honest answer.",
  },
];

export default function Home() {

  return (
    <>
      <SiteHeader />

      <section className="dot-grid border-b border-line">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="eyebrow text-primary">Process discovery · for operations teams</p>
            <h1 className="mt-6 text-[clamp(2.6rem,5.2vw,4.5rem)] font-medium leading-[1.03] tracking-[-0.035em]">
              Find where work stalls through process discovery. <span className="ai-gradient">Fix what pays.</span>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-muted">
              The Process Discovery Engine shows how a Forward Deployed Engineer at Mainloop could turn event-log data
              exported from a client&rsquo;s ERP, finance or ticketing systems into a map of how their processes really
              run, and see which bottlenecks cost the most. It runs on a TypeScript engine checked against pm4py, the standard
              open-source process-mining library. For the full technical picture, see the{" "}
              <Link href="/engineering" className="text-primary underline underline-offset-4">
                Engineering
              </Link>{" "}
              page; for validation, see the{" "}
              <Link href="/#validation" className="text-primary underline underline-offset-4">
                Validation
              </Link>{" "}
              page.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/sample"
                className="eyebrow rounded-md bg-primary px-6 py-4 text-primary-ink transition hover:bg-primary-hover"
              >
                Explore the sample
              </Link>
              <Link
                href="/app/upload"
                className="eyebrow rounded-md border border-line bg-surface px-6 py-4 transition hover:border-ink-faint"
              >
                Upload a log
              </Link>
            </div>
            <p className="mt-8 text-sm text-ink-faint">
              Explore a 5,050-invoice sample now, or sign in to upload and explore your own CSV export.
            </p>
          </div>
          <div className="h-[420px] rounded-2xl border border-line bg-surface p-3 shadow-[0_20px_60px_-30px_rgba(14,20,22,0.25)] lg:h-[580px]">
            <HeroMap />
          </div>
        </div>
      </section>

      <main className="flex-1">
        <section id="questions" className="border-b border-line bg-surface">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-20 sm:px-8 lg:grid-cols-[1fr_2fr] lg:gap-16">
            <div>
              <p className="eyebrow text-primary">About this project</p>
              <h2 className="mt-4 text-3xl font-medium tracking-[-0.02em]">
                Questions you might be asking.
              </h2>
            </div>
            <div className="divide-y divide-line border-y border-line">
              {FAQ.map((f) => (
                <details key={f.question} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-lg font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                    {f.question}
                    <span
                      aria-hidden="true"
                      className="font-mono text-2xl font-light leading-none text-primary transition-transform group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <div className="max-w-2xl space-y-4 pb-7 leading-relaxed text-ink-muted">
                    {f.answer.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                    {f.bullets && (
                      <ul className="space-y-3">
                        {f.bullets.map((b) => (
                          <li key={b.lead} className="flex gap-3">
                            <span aria-hidden="true" className="mt-[0.7em] h-1 w-1 shrink-0 rounded-full bg-primary" />
                            <span>
                              <strong className="font-medium text-ink">{b.lead}</strong> {b.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {f.after?.map((p) => (
                      <p key={p}>{p}</p>
                    ))}
                    {f.signature && <p className="font-mono text-sm text-ink">{f.signature}</p>}
                    {f.sources && (
                      <div className="border-t border-line pt-4">
                        <p className="eyebrow text-[0.65rem] text-ink-faint">Sources</p>
                        <ul className="mt-2 space-y-1.5 font-mono text-[0.78rem]">
                          {f.sources.map((src) => (
                            <li key={src.href}>
                              <a
                                href={src.href}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline-offset-4 hover:underline"
                              >
                                {src.label}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="border-b border-line bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
            <p className="eyebrow text-primary">How it works</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-[-0.02em] sm:text-4xl">
              From a raw export to a go / no-go in an afternoon.
            </h2>
            <ol className="mt-14 grid gap-12 sm:grid-cols-3">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <div className="flex items-center gap-4">
                    <span className="font-mono text-6xl font-medium text-line">{s.n}</span>
                    {s.soon && (
                      <span className="eyebrow rounded border border-primary px-2 py-1 text-[0.62rem] text-primary">
                        Coming next
                      </span>
                    )}
                  </div>
                  <h3 className="mt-4 text-xl font-medium tracking-tight">{s.title}</h3>
                  <p className="mt-3 leading-relaxed text-ink-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="validation" className="bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
            <p className="eyebrow text-primary">Proven on real data</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-[-0.02em] sm:text-4xl">
              Same answers as the experts, on real event logs.
            </h2>
            <p className="mt-4 max-w-2xl text-ink-muted">
              The engine, the same code the upload page runs, was tested on public BPI Challenge logs: real records from a
              university&rsquo;s expense claims, a multinational&rsquo;s SAP purchasing, a bank and an EU agency. Its results were
              compared with analyses published by university research teams, and with pm4py, the standard open-source
              process-mining library.
            </p>
            <div className="mt-12 grid border-t-2 border-ink md:grid-cols-3">
              {VALIDATION.map((v, i) => (
                <article
                  key={v.label}
                  className={`flex flex-col border-line py-8 md:px-8 ${i > 0 ? "border-t" : ""} ${i % 3 === 0 ? "md:pl-0" : "md:border-l"} ${i < 3 ? "md:border-t-0" : "md:border-t"}`}
                >
                  <p className="font-mono text-4xl font-medium tracking-tight tabular-nums">{v.figure}</p>
                  <p className="mt-2 font-medium">{v.label}</p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">{v.detail}</p>
                  <p className="mt-auto pt-5 font-mono text-[0.7rem] text-ink-faint">{v.source}</p>
                </article>
              ))}
            </div>
            <p className="mt-10 max-w-2xl text-ink-muted">
              The runs also exposed five bugs in the engine, all fixed. Where our figures differ from the papers, the write-up
              explains why.{" "}
              <Link href={`${REPO}/blob/main/docs/validation.md`} className="text-primary underline-offset-4 hover:underline">
                Read the full validation
              </Link>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
