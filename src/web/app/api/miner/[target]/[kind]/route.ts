import { loadDataset } from "@/lib/datasetInputs";
import { callMiner, MinerError } from "@/lib/miner/client";
import {
  conformanceResult,
  modelResult,
  NOISE_THRESHOLD,
  referenceVariants,
  toContractEvents,
  type MinerConformance,
  type MinerDiscover,
} from "@/lib/miner/contract";
import { decodeSnapshot } from "@/lib/snapshot";
import { createClient } from "@/lib/supabase/server";

/**
 * The BPMN model (`model`) or token-replay conformance (`conformance`) of a dataset. The snapshot
 * is read as the user (RLS), sent to the miner as contract events, and the result trimmed to what
 * the page shows. (The demos' results are committed: lib/miner/demoOutputs.ts.) The response
 * stays small (BPMN XML plus summaries), well under Vercel's 4.5 MB body limit.
 */

export const maxDuration = 300;

const fail = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(_: Request, ctx: RouteContext<"/api/miner/[target]/[kind]">) {
  const { target, kind } = await ctx.params;
  if (kind !== "model" && kind !== "conformance") return fail(404, "Unknown analysis.");

  if (!/^[0-9a-f-]{36}$/i.test(target)) return fail(404, "No such dataset.");
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!auth?.claims || !session) return fail(401, "Sign in to run the mining service on this dataset.");

  const dataset = await loadDataset(supabase, target);
  if (!dataset) return fail(404, "No such dataset.");
  if (dataset.status !== "ready" || !dataset.snapshot_path) return fail(409, "This dataset isn't ready yet.");
  const { data: blob, error } = await supabase.storage.from("snapshots").download(dataset.snapshot_path);
  if (error || !blob) return fail(502, "Couldn't read the dataset's snapshot.");

  try {
    const log = await decodeSnapshot(blob);
    const events = toContractEvents(log);
    if (kind === "model") {
      const r = await callMiner<MinerDiscover>("/discover/inductive", { events, noise_threshold: NOISE_THRESHOLD }, session.access_token);
      return Response.json(modelResult(r));
    }
    const reference = referenceVariants(log);
    const r = await callMiner<MinerConformance>("/conformance/token-replay", { events, happy_variants: reference.variants }, session.access_token);
    return Response.json(conformanceResult(r, reference));
  } catch (e) {
    if (e instanceof MinerError) return fail(e.status, e.message);
    throw e;
  }
}
