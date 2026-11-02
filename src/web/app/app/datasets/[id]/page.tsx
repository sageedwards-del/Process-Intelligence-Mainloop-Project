import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Explorer } from "@/components/explorer/Explorer";
import { costModelFromSettings, parseAnalysisSettings, parseRule, type RuleWithImpact } from "@throughline/engine";
import { describeCost, loadWorkspaceCost } from "@/lib/costSettings";
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
  const { data: dataset } = await supabase
    .from("datasets")
    .select("id, workspace_id, name, status, error, snapshot_path, analysis_settings")
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

  const [{ settings }, { data: ruleRows }, { data: membership }] = await Promise.all([
    loadWorkspaceCost(supabase, dataset.workspace_id),
    supabase.from("rules").select("id, definition").eq("dataset_id", dataset.id).eq("enabled", true).order("created_at"),
    supabase.from("workspace_members").select("role").eq("workspace_id", dataset.workspace_id).eq("user_id", auth.claims.sub).maybeSingle(),
  ]);
  const analysisSettings = parseAnalysisSettings(dataset.analysis_settings);
  const canEdit = membership !== null && membership.role !== "viewer";
  const rules = (ruleRows ?? []).map((r) => parseRule(r.definition, r.id)).filter((r): r is RuleWithImpact => r !== null);
  const cost = costModelFromSettings(settings, rules);

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
      </div>
    </div>
  );
}
