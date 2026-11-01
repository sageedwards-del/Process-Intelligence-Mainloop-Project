import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "./actions";

export const metadata: Metadata = { title: "Workspace · Process Discovery Engine" };

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
    supabase.from("datasets").select("id, name, status, created_at").order("created_at", { ascending: false }),
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
        <form action={signOut}>
          <button type="submit" className="eyebrow rounded-md border border-line px-5 py-3 transition hover:border-ink-faint">
            Sign out
          </button>
        </form>
      </div>

      <section className="mt-14">
        <h2 className="text-xl font-medium">Event logs</h2>
        {datasets && datasets.length > 0 ? (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {datasets.map((d) => (
              <li key={d.id} className="flex justify-between py-4">
                <span>{d.name}</span>
                <span className="font-mono text-sm text-ink-faint">{d.status}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="dot-grid mt-4 rounded-xl border border-dashed border-line p-10 text-center">
            <p className="font-medium">No event logs yet</p>
            <p className="mt-2 text-ink-muted">Uploading a CSV or XES export is the next feature to land.</p>
          </div>
        )}
      </section>
    </>
  );
}
