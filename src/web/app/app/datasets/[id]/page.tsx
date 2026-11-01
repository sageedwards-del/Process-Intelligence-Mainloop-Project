import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Explorer } from "@/components/explorer/Explorer";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dataset · Process Discovery Engine" };

export default function DatasetPage({ params }: PageProps<"/app/datasets/[id]">) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-8">
          <Link href="/app" className="text-sm text-primary underline-offset-4 hover:underline">
            &larr; Workspace
          </Link>
          <Suspense fallback={<p className="mt-10 text-ink-faint">Loading the dataset…</p>}>
            <Dataset params={params} />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

async function Dataset({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect(`/login?next=/app/datasets/${id}`);

  // RLS returns nothing for datasets outside the user's workspaces.
  const { data: dataset } = await supabase
    .from("datasets")
    .select("id, name, status, error, snapshot_path")
    .eq("id", id)
    .maybeSingle();
  if (!dataset) notFound();

  if (dataset.status !== "ready" || !dataset.snapshot_path) {
    return (
      <div className="mt-8">
        <h1 className="text-4xl font-medium tracking-[-0.02em]">{dataset.name}</h1>
        <p className="mt-4 text-ink-muted">
          This dataset is <span className="font-mono">{dataset.status}</span>
          {dataset.error ? `: ${dataset.error}` : "."}
        </p>
      </div>
    );
  }

  // A short-lived link the browser's worker downloads the snapshot from.
  const { data: signed, error } = await supabase.storage.from("snapshots").createSignedUrl(dataset.snapshot_path, 3600);
  if (error || !signed) throw new Error(`Couldn't open the dataset: ${error?.message ?? "no link"}`);

  return (
    <div className="mt-6">
      <p className="eyebrow text-primary">Dataset</p>
      <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">{dataset.name}</h1>
      <div className="mt-10">
        <Explorer
          source={{ kind: "snapshot", url: signed.signedUrl }}
          costNote="Priced with default assumptions: €55 per staff hour and €4 per case per day of excess waiting. Editable cost settings come later."
        />
      </div>
    </div>
  );
}
