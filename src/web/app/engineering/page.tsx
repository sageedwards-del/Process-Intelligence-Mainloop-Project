import type { Metadata } from "next";
import { DataFlow } from "@/components/engineering/DataFlow";
import { StatusChip } from "@/components/engineering/StatusChip";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { REPO } from "@/lib/site";
import { ARCHITECTURE, ROADMAP, SECTIONS, type Capability } from "./content";

export const metadata: Metadata = {
  title: "Engineering · Process Discovery Engine",
  description: "How the Process Discovery Engine works: architecture, engine, pm4py service, data security and verification.",
};

function CapabilityGrid({ items }: { items: Capability[] }) {
  return (
    <ul className="mt-10 grid gap-x-12 border-t border-line sm:grid-cols-2">
      {items.map((c) => (
        <li key={c.title} className="border-b border-line py-6">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-medium">{c.title}</h3>
            <StatusChip status={c.status} />
          </div>
          <p className="mt-2 leading-relaxed text-ink-muted">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

const JUMP = [
  { href: "#architecture", label: "Architecture" },
  { href: "#data-flow", label: "Data flow" },
  ...SECTIONS.map((s) => {
    const label = s.eyebrow.replace(/^The /, "");
    return { href: `#${s.id}`, label: label[0]!.toUpperCase() + label.slice(1) };
  }),
  { href: "#roadmap", label: "Roadmap" },
];

export default function Engineering() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <section className="dot-grid border-b border-line">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
            <p className="eyebrow text-primary">Engineering</p>
            <h1 className="mt-6 max-w-4xl text-[2.4rem] font-medium leading-[1.05] tracking-[-0.03em] sm:text-6xl">
              How the Process Discovery Engine works.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink-muted">
              Four parts: a web app, a TypeScript engine, a Python service built on pm4py, and a Postgres database.
              Each item below is marked as done, next or planned, so you can see exactly what exists today.
            </p>

            <nav aria-label="On this page" className="mt-10 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[0.8rem]">
              {JUMP.map((j) => (
                <a key={j.href} href={j.href} className="text-primary underline-offset-4 hover:underline">
                  {j.label}
                </a>
              ))}
            </nav>

            <div id="architecture" className="mt-10 grid scroll-mt-6 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {ARCHITECTURE.map((b) => (
                <div key={b.name} className="flex flex-col bg-surface p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-medium">{b.name}</h2>
                    <StatusChip status={b.status} />
                  </div>
                  <p className="mt-1 font-mono text-[0.75rem] text-primary">{b.tech}</p>
                  <p className="mt-4 text-sm leading-relaxed text-ink-muted">{b.role}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="data-flow" className="scroll-mt-6 border-b border-line bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
            <p className="eyebrow text-primary">Data flow</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-[-0.02em] sm:text-4xl">Where your event log goes.</h2>
            <p className="mt-4 max-w-3xl leading-relaxed text-ink-muted">
              Five steps, from upload to AI-powered insights.
            </p>
            <DataFlow />
          </div>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-6 border-b border-line bg-surface">
            <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
              <p className="eyebrow text-primary">{s.eyebrow}</p>
              <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-[-0.02em] sm:text-4xl">{s.heading}</h2>
              <p className="mt-4 max-w-3xl leading-relaxed text-ink-muted">{s.intro}</p>
              <CapabilityGrid items={s.items} />
            </div>
          </section>
        ))}

        <section id="roadmap" className="scroll-mt-6 bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
            <p className="eyebrow text-primary">Roadmap</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-[-0.02em] sm:text-4xl">
              What&rsquo;s built, and what comes next.
            </h2>
            <CapabilityGrid items={ROADMAP} />
            <a
              href={REPO}
              className="eyebrow mt-12 inline-block rounded-md bg-primary px-6 py-4 text-primary-ink transition hover:bg-primary-hover"
            >
              Read the source
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
