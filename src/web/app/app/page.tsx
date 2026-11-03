import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Workspace · Process Discovery Engine", robots: { index: false, follow: false } };

export default function AppHome() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
          <Suspense fallback={<p className="text-ink-faint">Loading your workspace…</p>}>
            <Workspace />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

async function Workspace() {
  // Per-request: the Supabase client checks token expiry against the clock.
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login?next=/app");

  // Row-level security limits both queries to workspaces this user belongs to.
  const [{ data: workspaces }, { data: datasets }] = await Promise.all([
    supabase.from("workspaces").select("id, name").order("created_at"),
    supabase.from("datasets").select("id, name, status, error, stats, created_at").order("created_at", { ascending: false }),
  ]);
  const workspace = workspaces?.[0];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow text-primary">Workspace</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">{workspace?.name ?? "Your workspace"}</h1>
          <p className="mt-3 text-ink-muted">
            Signed in as <span className="font-mono text-ink">{String(auth.claims.email ?? "")}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/app/settings" className="eyebrow rounded-md border border-line px-5 py-3 transition hover:border-ink-faint">
            Cost settings
          </Link>
          <form action={signOut}>
            <button type="submit" className="eyebrow rounded-md border border-line px-5 py-3 transition hover:border-ink-faint">
              Sign out
            </button>
          </form>
        </div>
      </div>

      <section className="mt-14">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-medium">Event logs</h2>
          <Link
            href="/app/upload"
            className="eyebrow rounded-md bg-primary px-5 py-3 text-primary-ink transition hover:bg-primary-hover"
          >
            Upload a log
          </Link>
        </div>
        {datasets && datasets.length > 0 ? (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {datasets.map((d) => {
              const stats = d.stats as { caseCount?: number; eventCount?: number } | null;
              return (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4">
                  {d.status === "ready" ? (
                    <Link href={`/app/datasets/${d.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {d.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{d.name}</span>
                  )}
                  <span className="font-mono text-sm text-ink-faint">
                    {stats?.caseCount !== undefined &&
                      `${stats.caseCount.toLocaleString("en")} cases · ${stats.eventCount?.toLocaleString("en")} events · `}
                    <span className={d.status === "error" ? "text-[#b42318]" : d.status === "ready" ? "text-primary" : ""}>
                      {d.status}
                    </span>
                  </span>
                  {d.status === "error" && d.error && <p className="w-full text-sm text-[#b42318]">{d.error}</p>}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="dot-grid mt-4 rounded-xl border border-dashed border-line p-10 text-center">
            <p className="font-medium">No event logs yet</p>
            <p className="mt-2 text-ink-muted">Upload a CSV, Excel or XES event log, one row per event, to get started.</p>
          </div>
        )}
      </section>
    </>
  );
}
