import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AiPanel } from "@/components/ai/AiPanel";
import { Explorer } from "@/components/explorer/Explorer";
import { describeCost } from "@/lib/costSettings";
import { loadDataset, loadDatasetInputs } from "@/lib/datasetInputs";
import { createClient } from "@/lib/supabase/server";
import { saveAnalysisSettings } from "./actions";
import { AddSampleRules } from "./AddSampleRules";

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
  const dataset = await loadDataset(supabase, id);
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

  const { inputs, rules, costSettings: settings, canEdit } = await loadDatasetInputs(supabase, dataset, auth.claims.sub);
  const { cost, settings: analysisSettings } = inputs;

  return (
    <div className="mt-6">
      <p className="eyebrow text-primary">Dataset</p>
      <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">{dataset.name}</h1>
      <div className="mt-10">
        <Explorer
          source={{ kind: "snapshot", url: signed.signedUrl }}
          cost={cost}
          rules={rules}
          rulesEmptyNote={<AddSampleRules datasetId={dataset.id} />}
          settings={analysisSettings}
          onSaveSettings={canEdit ? saveAnalysisSettings.bind(null, dataset.id) : undefined}
          costNote={
            <>
              Priced with this workspace&rsquo;s cost settings: {describeCost(settings)}.{" "}
              <Link href="/app/settings" className="text-primary underline-offset-4 hover:underline">
                Edit cost settings
              </Link>
            </>
          }
        />
        <AiPanel target={dataset.id} signInNext={`/app/datasets/${dataset.id}`} />
      </div>
    </div>
  );
}
