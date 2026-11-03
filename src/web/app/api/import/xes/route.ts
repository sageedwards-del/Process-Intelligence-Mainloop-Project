import { createClient } from "@/lib/supabase/server";
import { MAX_UPLOAD_LABEL } from "@/lib/uploadLimit";

/**
 * XES import. The browser has already put the file in Storage at
 * `raw-uploads/<ws>/<dataset>/source.xes[.gz]` (as the user, under RLS) and posts
 * `{ datasetId }`. This route signs a download URL for that file and an upload URL for
 * `raw-uploads/<ws>/<dataset>/xes.json.gz`, and asks the miner to import one into the other.
 * Only small JSON passes through here: Vercel functions cap request and response bodies at
 * 4.5 MB. The browser then downloads the result itself.
 */

const TIMEOUT_MS = 240_000;
export const maxDuration = 300;

export interface XesImportResult {
  /** Where the miner wrote the imported events, in `raw-uploads`, as gzipped JSON. */
  resultPath: string;
  /** Events the miner dropped for lacking a case id, activity or timestamp. */
  droppedEvents: number;
}

interface MinerImportStats {
  stats: { dropped_events: number };
}

const fail = (status: number, error: string) => Response.json({ error }, { status });

/** The miner's limit messages without its setting names, and bytes as MB. */
const plain = (detail: string) =>
  detail
    .replace(/\s*\([A-Z_]+\)/g, "")
    .replace(/(\d{7,}) bytes/g, (_, n: string) => `${Math.round(Number(n) / 1024 / 1024)} MB`)
    .replace(/(\d{4,}) events exceeds the limit of (\d+)/, (_, a: string, b: string) => `${Number(a).toLocaleString("en")} events exceeds the limit of ${Number(b).toLocaleString("en")}`)
    .replace(/\.?$/, ".");

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!auth?.claims || !session) return fail(401, "Sign in again to upload.");

  const body = (await request.json().catch(() => null)) as { datasetId?: unknown } | null;
  const datasetId = typeof body?.datasetId === "string" && /^[0-9a-f-]{36}$/i.test(body.datasetId) ? body.datasetId : null;
  if (!datasetId) return fail(400, "Send the dataset id of the uploaded file.");

  // Read as the user: RLS decides whether they can see the dataset.
  const { data: dataset } = await supabase.from("datasets").select("id, workspace_id, source_path, source_format").eq("id", datasetId).maybeSingle();
  if (!dataset?.source_path || dataset.source_format !== "xes") return fail(404, "No uploaded XES file for that dataset.");

  const minerUrl = process.env.MINER_URL;
  if (!minerUrl) {
    return fail(503, "XES import needs the mining service, which isn't set up here (MINER_URL). Export the log as CSV instead, or try again later.");
  }

  const resultPath = `${dataset.workspace_id}/${dataset.id}/xes.json.gz`;
  const bucket = supabase.storage.from("raw-uploads");
  const [download, upload] = await Promise.all([
    bucket.createSignedUrl(dataset.source_path, 600),
    bucket.createSignedUploadUrl(resultPath, { upsert: true }),
  ]);
  if (download.error || upload.error) return fail(403, "You can't import into this dataset.");

  let upstream: Response;
  try {
    upstream = await fetch(`${minerUrl.replace(/\/$/, "")}/import/xes/url`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ xes_url: download.data.signedUrl, result_url: upload.data.signedUrl, lifecycle: "all" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return fail(504, "The mining service took too long to read this log. Try a smaller export, or a CSV.");
    }
    return fail(503, "The mining service that reads XES files isn't reachable right now. Try again later, or export the log as CSV.");
  }

  if (!upstream.ok) {
    const err = (await upstream.json().catch(() => ({}))) as { detail?: unknown };
    const detail = typeof err.detail === "string" ? err.detail : null;
    if (upstream.status === 413) {
      return fail(413, `That log is too large for the XES importer${detail ? `: ${plain(detail)}` : "."} Export a shorter period, or upload it as CSV (up to ${MAX_UPLOAD_LABEL}).`);
    }
    if (upstream.status === 422) return fail(422, detail ?? "That file isn't a readable XES log.");
    if (upstream.status === 401) return fail(502, "The mining service didn't accept your session. Sign in again, or try later.");
    return fail(502, `The mining service couldn't import the file (${upstream.status}).`);
  }

  const imported = (await upstream.json()) as MinerImportStats;
  const result: XesImportResult = { resultPath, droppedEvents: imported.stats.dropped_events };
  return Response.json(result);
}
