/**
 * Builds the BPI Challenge 2020 Domestic Declarations demo snapshot served by /sample, through
 * the upload page's pipeline (Papa Parse → guessMapping → ingestTable → buildLog). People in the
 * log are anonymised, so the resource is the `org:role` column, as in validate-bpic.ts.
 *
 *   npm run bpic:download -w @throughline/miner     (fetches and converts the logs)
 *   npx tsx scripts/build-demo.ts                   (from src/web; writes public/demo/)
 *
 * Source: B.F. van Dongen (2020), doi:10.4121/uuid:3f422315-ed9d-4882-891f-e180b5b4feb5, CC BY-NC 4.0.
 * Changes: converted from XES to CSV, one row per complete event, re-encoded as the engine's log.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { buildLog, guessMapping, ingestTable, summarize } from "@throughline/engine";
import Papa from "papaparse";
import { SNAPSHOT_VERSION } from "../lib/snapshot.ts";

const SOURCE = process.argv[2] ?? resolve(import.meta.dirname, "../../../data/external/bpic/bpic2020-domestic.csv");
const OUT = resolve(import.meta.dirname, "../public/demo/bpic2020-domestic.json.gz");

const rows = Papa.parse<string[]>(readFileSync(SOURCE, "utf8"), { skipEmptyLines: "greedy" }).data;
const table = { headers: rows[0]!, rows: rows.slice(1) };
const guessed = guessMapping(table);
// case:id repeats the case ID and event_id is per event, so neither is a useful case attribute.
const drop = new Set(["org:role", "case:id", "event_id"]);
const mapping = { ...guessed, resource: "org:role", attributes: guessed.attributes.filter((a) => !drop.has(a)) };
const { events, report } = ingestTable(table, mapping);
const log = buildLog(events);
const gz = gzipSync(JSON.stringify({ version: SNAPSHOT_VERSION, log }), { level: 9 });
writeFileSync(OUT, gz);

const s = summarize(log);
console.log(`${s.caseCount} cases, ${s.eventCount} events, ${s.activityCount} activities, ${report.issues.length} quality notes`);
console.log(`mapping: case=${mapping.caseId} activity=${mapping.activity} time=${mapping.timestamp} resource=${mapping.resource} attributes=${mapping.attributes.join(", ")}`);
console.log(`wrote ${OUT} (${(gz.length / 1024).toFixed(0)} KB)`);
