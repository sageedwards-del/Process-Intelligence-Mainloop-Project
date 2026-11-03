import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { loadWorkspaceCost } from "@/lib/costSettings";
import { createClient } from "@/lib/supabase/server";
import { CostSettingsForm } from "./CostSettingsForm";

export const metadata: Metadata = { title: "Cost settings · Process Discovery Engine", robots: { index: false, follow: false } };

export default function SettingsPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-4 py-12 sm:px-8">
          <Link href="/app" className="text-sm text-primary underline-offset-4 hover:underline">
            &larr; Workspace
          </Link>
          <Suspense fallback={<p className="mt-10 text-ink-faint">Loading cost settings…</p>}>
            <Settings />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

async function Settings() {
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login?next=/app/settings");

  // Like /app, this edits the user's first workspace.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role, workspaces(id, name, created_at)")
    .eq("user_id", auth.claims.sub)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const workspace = membership?.workspaces as unknown as { id: string; name: string } | null;
  if (!membership || !workspace) redirect("/app");
  const { settings, saved } = await loadWorkspaceCost(supabase, workspace.id);

  return (
    <div className="mt-6">
      <p className="eyebrow text-primary">Cost settings</p>
      <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">What time costs in {workspace.name}</h1>
      <p className="mt-3 leading-relaxed text-ink-muted">
        Every money figure for this workspace&rsquo;s uploaded datasets is derived from these inputs, and each one shows its
        formula next to it. {saved ? "" : "Nothing is saved yet, so the explorer uses the defaults shown below."} The demos keep
        their own fixed assumptions.
      </p>
      <div className="mt-10">
        <CostSettingsForm workspaceId={workspace.id} initial={settings} canEdit={membership.role !== "viewer"} />
      </div>
    </div>
  );
}
