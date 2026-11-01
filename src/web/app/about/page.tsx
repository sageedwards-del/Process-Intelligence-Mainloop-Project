import type { Metadata } from "next";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { REPO } from "@/lib/site";
import { ARCHITECTURE, ROADMAP, SECTIONS, type Capability, type Status } from "./content";

export const metadata: Metadata = {
  title: "About · Process Discovery Engine",
  description: "How the Process Discovery Engine works: architecture, engine, pm4py service, data security and verification.",
};

const STATUS: Record<Status, { label: string; style: string }> = {
  done: { label: "Done", style: "bg-primary text-primary-ink" },
  next: { label: "Next", style: "border border-primary text-primary" },
  planned: { label: "Planned", style: "border border-line text-ink-faint" },
};

function Chip({ status }: { status: Status }) {
  const s = STATUS[status];
  return <span className={`eyebrow inline-block shrink-0 rounded px-2 py-1 text-[0.62rem] ${s.style}`}>{s.label}</span>;
}

function CapabilityGrid({ items }: { items: Capability[] }) {
  return (
    <ul className="mt-10 grid gap-x-12 border-t border-line sm:grid-cols-2">
      {items.map((c) => (
        <li key={c.title} className="border-b border-line py-6">
          <div className="flex items-start justify-between gap-4">
            <h3 className="font-medium">{c.title}</h3>
            <Chip status={c.status} />
          </div>
          <p className="mt-2 leading-relaxed text-ink-muted">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

export default function About() {
  return (
    <>
      <SiteHeader />

      <main className="flex-1">
        <section className="dot-grid border-b border-line">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8 sm:py-24">
            <p className="eyebrow text-primary">About</p>
            <h1 className="mt-6 max-w-4xl text-[2.4rem] font-medium leading-[1.05] tracking-[-0.03em] sm:text-6xl">
              How the Process Discovery Engine works.
            </h1>
            <p className="mt-8 max-w-2xl text-lg leading-relaxed text-ink-muted">
              Four parts: a web app, a TypeScript engine, a Python service built on pm4py, and a Postgres database.
              Each item below is marked as done, next or planned, so you can see exactly what exists today.
            </p>

            <div className="mt-14 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
              {ARCHITECTURE.map((b) => (
                <div key={b.name} className="flex flex-col bg-surface p-6">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-medium">{b.name}</h2>
                    <Chip status={b.status} />
                  </div>
                  <p className="mt-1 font-mono text-[0.75rem] text-primary">{b.tech}</p>
                  <p className="mt-4 text-sm leading-relaxed text-ink-muted">{b.role}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} className="border-b border-line bg-surface">
            <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
              <p className="eyebrow text-primary">{s.eyebrow}</p>
              <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-[-0.02em] sm:text-4xl">{s.heading}</h2>
              <p className="mt-4 max-w-3xl leading-relaxed text-ink-muted">{s.intro}</p>
              <CapabilityGrid items={s.items} />
            </div>
          </section>
        ))}

        <section className="bg-surface">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
            <p className="eyebrow text-primary">What&rsquo;s next</p>
            <h2 className="mt-4 max-w-2xl text-3xl font-medium tracking-[-0.02em] sm:text-4xl">
              From the sample to real client data.
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
