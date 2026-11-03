import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { detectWaitContext, type EventLog } from "@throughline/engine";
import type { AnalysisInputs } from "../analysis/analyse";
import { DEMOS, meridianLog, type DemoId } from "../analysis/demos";
import { loadDataset, loadDatasetInputs } from "../datasetInputs";
import { decodeSnapshot } from "../snapshot";
import { createClient } from "../supabase/server";
import { analyseForAi, type AnalysedLog } from "./bundle";

/**
 * What an AI request runs on: a public demo (Meridian or BPIC 2020) or one of the user's
 * datasets, read as the signed-in user so RLS decides what they can reach.
 * The dataset ID comes from the request URL, never from the model.
 */

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface Target {
  supabase: Supabase;
  userId: string;
  /** The workspace usage is recorded in: the dataset's, or the user's own for the sample. */
  workspaceId: string;
  /** null for the demos, which have no dataset row and so aren't stored in ai_outputs. */
  datasetId: string | null;
  name: string;
  canEdit: boolean;
  costNote: string;
  /** Changes whenever the snapshot, cost settings, rules or wait settings change. */
  inputsHash: string;
  /** The log and its analysis, loaded on first use (reading a stored output doesn't need them). */
  load: () => Promise<Loaded>;
}

export interface Loaded {
  log: EventLog;
  /** With the wait context detected on the whole log. */
  inputs: AnalysisInputs;
  analysed: AnalysedLog;
}

export class TargetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** URL targets for the demos; "sample" is Meridian's original name. */
const DEMO_TARGETS: Record<string, DemoId> = { sample: "meridian", meridian: "meridian", bpic2020: "bpic2020" };

async function demoLog(id: DemoId): Promise<EventLog> {
  const demo = DEMOS[id];
  if (!demo.snapshotPath) return meridianLog();
  // Served from public/ to the browser; read from disk here (next.config traces it into the AI routes).
  const bytes = await readFile(join(process.cwd(), "public", demo.snapshotPath));
  return decodeSnapshot(new Blob([bytes]));
}

// Decoding and analysing a log takes about a second; keep the last few in memory.
const cache = new Map<string, Promise<Loaded>>();
const CACHE_SIZE = 4;

function cached(key: string, load: () => Promise<Loaded>): Promise<Loaded> {
  const hit = cache.get(key) ?? load();
  cache.delete(key);
  cache.set(key, hit);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  // A failed load isn't kept, so the next request tries again.
  hit.catch(() => cache.get(key) === hit && cache.delete(key));
  return hit;
}

function analysed(log: EventLog, inputs: AnalysisInputs): Loaded {
  const full = { ...inputs, context: detectWaitContext(log, inputs.settings) };
  return { log, inputs: full, analysed: analyseForAi(log, full) };
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

/** A demo (`"bpic2020"`, `"meridian"`, or `"sample"` for Meridian) or a dataset ID. Throws TargetError(401/404/409) when it can't be used. */
export async function resolveTarget(target: string): Promise<Target> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) throw new TargetError(401, "Sign in to use Claude's analysis.");
  const userId = auth.claims.sub;

  const demoId = DEMO_TARGETS[target];
  if (demoId) {
    // Demo answers cost money too, so they need an account; usage goes to the user's own workspace.
    const { data: own } = await supabase.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("role", "owner").limit(1).maybeSingle();
    if (!own) throw new TargetError(403, "Your account has no workspace yet.");
    const demo = DEMOS[demoId];
    return {
      supabase,
      userId,
      workspaceId: own.workspace_id,
      datasetId: null,
      name: `${demo.title} (${demoId === "meridian" ? "synthetic sample" : "BPI Challenge 2020"})`,
      canEdit: true,
      costNote: demo.costNote,
      inputsHash: demoId,
      load: () => cached(demoId, async () => analysed(await demoLog(demoId), demo.inputs)),
    };
  }

  if (!/^[0-9a-f-]{36}$/i.test(target)) throw new TargetError(404, "No such dataset.");
  const dataset = await loadDataset(supabase, target);
  if (!dataset) throw new TargetError(404, "No such dataset.");
  if (dataset.status !== "ready" || !dataset.snapshot_path) throw new TargetError(409, "This dataset isn't ready yet.");

  const { inputs, costNote, canEdit } = await loadDatasetInputs(supabase, dataset, userId);
  const inputsHash = hash({ snapshot: dataset.snapshot_path, cost: inputs.cost, rules: inputs.rules, settings: inputs.settings });
  const path = dataset.snapshot_path;
  const load = () =>
    cached(`${dataset.id}:${inputsHash}`, async () => {
      // Downloaded as the user, so storage RLS applies too.
      const { data: blob, error } = await supabase.storage.from("snapshots").download(path);
      if (error || !blob) throw new TargetError(502, "Couldn't read the dataset's snapshot.");
      return analysed(await decodeSnapshot(blob), inputs);
    });
  return { supabase, userId, workspaceId: dataset.workspace_id, datasetId: dataset.id, name: dataset.name, canEdit, costNote, inputsHash, load };
}
