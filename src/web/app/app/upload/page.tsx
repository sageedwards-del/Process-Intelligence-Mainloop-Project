import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { Uploader } from "./Uploader";

export const metadata: Metadata = { title: "Upload an event log · Process Discovery Engine", robots: { index: false, follow: false } };

export default function UploadPage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-8">
          <p className="eyebrow text-primary">New dataset</p>
          <h1 className="mt-4 text-4xl font-medium tracking-[-0.02em]">Upload an event log</h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-ink-muted">
            A CSV or Excel export with one row per event (which case it belongs to, what happened, and when), or an XES
            log from a process-mining tool. You check the columns and data quality before anything is saved. CSV and
            Excel files are read in your browser; XES logs are read by our mining service.
          </p>
          <div className="mt-12">
            <Suspense fallback={<p className="text-ink-faint">Loading…</p>}>
              <WorkspaceUploader />
            </Suspense>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

async function WorkspaceUploader() {
  await connection();
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login?next=/app/upload");
  const { data: workspaces } = await supabase.from("workspaces").select("id").order("created_at").limit(1);
  const workspaceId = workspaces?.[0]?.id as string | undefined;
  if (!workspaceId) return <p className="text-ink-muted">No workspace found for this account.</p>;
  return <Uploader workspaceId={workspaceId} />;
}
