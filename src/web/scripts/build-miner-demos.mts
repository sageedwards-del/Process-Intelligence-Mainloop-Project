/**
 * Computes the demos' BPMN model and conformance with the miner and writes them to
 * lib/miner/demo-outputs/, the same way the /api/miner route does for a dataset.
 *
 *   cd src/miner && AUTH_DISABLED=1 uv run uvicorn --factory throughline_miner.main:create_app --port 8010
 *   cd src/web && MINER_URL=http://127.0.0.1:8010 npx tsx scripts/build-miner-demos.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import type { EventLog } from "@throughline/engine";
import { DEMOS, meridianLog, type DemoId } from "../lib/analysis/demos.ts";
import {
  conformanceResult,
  modelResult,
  NOISE_THRESHOLD,
  referenceVariants,
  toContractEvents,
  type MinerConformance,
  type MinerDiscover,
} from "../lib/miner/contract.ts";

const MINER = (process.env.MINER_URL ?? "http://127.0.0.1:8010").replace(/\/$/, "");
const OUT = resolve(import.meta.dirname, "../lib/miner/demo-outputs");

function demoLog(id: DemoId): EventLog {
  const path = DEMOS[id].snapshotPath;
  if (!path) return meridianLog();
  return (JSON.parse(gunzipSync(readFileSync(resolve(import.meta.dirname, "../public", `.${path}`))).toString()) as { log: EventLog }).log;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${MINER}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

for (const id of Object.keys(DEMOS) as DemoId[]) {
  const log = demoLog(id);
  const events = toContractEvents(log);
  const model = modelResult(await post<MinerDiscover>("/discover/inductive", { events, noise_threshold: NOISE_THRESHOLD }));
  const reference = referenceVariants(log);
  const conformance = conformanceResult(await post<MinerConformance>("/conformance/token-replay", { events, happy_variants: reference.variants }), reference);
  writeFileSync(resolve(OUT, `${id}.model.json`), `${JSON.stringify(model, null, 2)}\n`);
  writeFileSync(resolve(OUT, `${id}.conformance.json`), `${JSON.stringify(conformance, null, 2)}\n`);
  console.log(`${id}: ${events.length} events, ${model.stats.activities} activities in the model; conformance ${(conformance.conformanceRate * 100).toFixed(1)}% against ${reference.variants.length} variant(s) covering ${(reference.share * 100).toFixed(1)}%`);
}
