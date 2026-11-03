import type { Metadata } from "next";
import Link from "next/link";
import { HonestNo, NobodyMentioned, NumbersOnTheComplaint, WhereToLook } from "@/components/benefits/Illustrations";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { MAINLOOP_CLOSING, MAINLOOP_POINTS, POSTING } from "./content";

export const metadata: Metadata = {
  title: "Benefits · Process Discovery Engine",
  description: "What the Process Discovery Engine gives Mainloop's Forward Deployed Engineers, from the first interview to an honest go / no-go.",
};

const ILLUSTRATIONS = [WhereToLook, NumbersOnTheComplaint, NobodyMentioned, HonestNo];

export default function Benefits() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <section className="dot-grid border-b border-line">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
            <p className="eyebrow text-primary">Benefits · written for Mainloop&rsquo;s FDE role</p>
            <h1 className="mt-6 max-w-4xl text-[2.4rem] font-medium leading-[1.05] tracking-[-0.03em] sm:text-6xl">
              Built for Forward Deployed Engineers.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink-muted">
              Four ways the engine shortens the first weeks of an engagement, from the first interview to the go / no-go. Each
              one rests on something already built, with real figures from the sample and from public event logs.
            </p>
            <nav aria-label="On this page" className="mt-10 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[0.8rem]">
              {MAINLOOP_POINTS.map((p) => (
                <a key={p.n} href={`#benefit-${p.n}`} className="text-primary underline-offset-4 hover:underline">
                  {p.n} {p.title}
                </a>
              ))}
            </nav>
          </div>
        </section>

        {MAINLOOP_POINTS.map((p, i) => {
          const Illustration = ILLUSTRATIONS[i]!;
          return (
            <section key={p.n} id={`benefit-${p.n}`} className={`scroll-mt-6 border-b border-line ${i % 2 ? "dot-grid" : "bg-surface"}`}>
              <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-8 sm:py-20 lg:grid-cols-2 lg:gap-16">
                <div className={i % 2 ? "lg:order-2" : ""}>
                  <span className="font-mono text-6xl font-medium text-line">{p.n}</span>
                  <h2 className="mt-4 text-3xl font-medium tracking-[-0.02em]">{p.title}</h2>
                  <p className="mt-4 max-w-xl text-lg leading-relaxed text-ink-muted">{p.body}</p>
                  <p className="mt-6 font-mono text-[0.78rem] text-ink-faint">
                    Built on:{" "}
                    <Link href={p.builtOn.href} className="text-primary underline-offset-4 hover:underline">
                      {p.builtOn.label}
                    </Link>
                  </p>
                </div>
                <div className={`min-w-0 ${i % 2 ? "lg:order-1" : ""}`}>
                  <Illustration />
                </div>
              </div>
            </section>
          );
        })}

        <section className="bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
            <p className="max-w-2xl text-lg leading-relaxed text-ink-muted">{MAINLOOP_CLOSING}</p>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link href="/sample" className="eyebrow rounded-md bg-primary px-6 py-4 text-primary-ink transition hover:bg-primary-hover">
                Explore real data
              </Link>
              <Link href="/#validation" className="eyebrow rounded-md border border-line bg-surface px-6 py-4 transition hover:border-ink-faint">
                See the validation
              </Link>
            </div>
            <p className="mt-8 font-mono text-[0.78rem]">
              Written against{" "}
              <a href={POSTING.href} target="_blank" rel="noreferrer" className="text-primary underline-offset-4 hover:underline">
                Mainloop&rsquo;s Forward Deployed Engineer posting
              </a>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
