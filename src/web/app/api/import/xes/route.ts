import { tableFromRecords, XES_COLUMNS, type RecordValue, type Table } from "@throughline/engine";
import { createClient } from "@/lib/supabase/server";

/**
 * XES upload: streams the browser's multipart body (field "file") to the
 * miner's POST /import/xes with the user's access token, and answers with the
 * events as a `Table` so the browser maps and checks them like a CSV.
 * Lives outside /app so proxy.ts doesn't buffer the body.
 */

const MAX_BYTES = 100 * 1024 * 1024; // the upload page's limit
const TIMEOUT_MS = 180_000;

export interface XesImportResult {
  table: Table;
  /** Events the miner dropped for lacking a case id, activity or timestamp. */
  droppedEvents: number;
}

interface MinerImport {
  events: Record<string, RecordValue>[];
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

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES + 64 * 1024) return fail(413, "That file is over 100 MB, the current upload limit.");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data") || !request.body) return fail(400, "Send the file as multipart form data.");

  const minerUrl = process.env.MINER_URL;
  if (!minerUrl) {
    return fail(503, "XES import needs the mining service, which isn't set up here (MINER_URL). Export the log as CSV instead, or try again later.");
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${minerUrl.replace(/\/$/, "")}/import/xes?lifecycle=all`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": contentType },
      body: request.body,
      // Stream the upload through rather than buffering it here.
      duplex: "half",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    } as RequestInit & { duplex: "half" });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return fail(504, "The mining service took too long to read this log. Try a smaller export, or a CSV.");
    }
    return fail(503, "The mining service that reads XES files isn't reachable right now. Try again later, or export the log as CSV.");
  }

  if (!upstream.ok) {
    const body = (await upstream.json().catch(() => ({}))) as { detail?: unknown };
    const detail = typeof body.detail === "string" ? body.detail : null;
    if (upstream.status === 413) {
      return fail(413, `That log is too large for the XES importer${detail ? `: ${plain(detail)}` : "."} Export a shorter period, or upload it as CSV.`);
    }
    if (upstream.status === 422) return fail(422, detail ?? "That file isn't a readable XES log.");
    if (upstream.status === 401) return fail(502, "The mining service didn't accept your session. Sign in again, or try later.");
    return fail(502, `The mining service couldn't import the file (${upstream.status}).`);
  }

  const imported = (await upstream.json()) as MinerImport;
  const leading = [XES_COLUMNS.caseId, XES_COLUMNS.activity, XES_COLUMNS.timestamp, XES_COLUMNS.resource];
  const result: XesImportResult = {
    table: tableFromRecords(imported.events, leading),
    droppedEvents: imported.stats.dropped_events,
  };
  return Response.json(result);
}
