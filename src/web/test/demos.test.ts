import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { detectWaitContext } from "@throughline/engine";
import { beforeAll, describe, expect, test } from "vitest";
import { analyseForAi, type AnalysedLog } from "@/lib/ai/bundle";
import { DEMOS } from "@/lib/analysis/demos";
import { decodeSnapshot } from "@/lib/snapshot";

// The committed BPIC 2020 snapshot, read the way lib/ai/target.ts reads it. Figures are the published ones (docs/validation.md).
const demo = DEMOS.bpic2020;
let analysed: AnalysedLog;
let cases: number;
let events: number;

beforeAll(async () => {
  const bytes = readFileSync(fileURLToPath(new URL(`../public${demo.snapshotPath}`, import.meta.url)));
  const log = await decodeSnapshot(new Blob([bytes]));
  cases = log.cases.length;
  events = log.cases.reduce((n, c) => n + c.events.length, 0);
  analysed = analyseForAi(log, { ...demo.inputs, context: detectWaitContext(log, demo.inputs.settings) });
}, 60_000); // a few seconds locally, more on a busy CI runner

describe("BPIC 2020 demo snapshot", () => {
  test("has the published case and event counts", () => {
    expect(cases).toBe(10_500);
    expect(events).toBe(56_437);
  });

  test("finds the two declarations paid without final approval, and no duplicates", () => {
    const rules = Object.fromEntries(analysed.analysis.rules.map((r) => [r.id, r.violations]));
    expect(rules["approved-before-payment"]).toBe(2);
    expect(rules["no-duplicate-declarations"]).toBe(0);
  });

  test("gives Claude metrics for the rules and the resubmission loop", () => {
    expect(analysed.bundle["rule:approved-before-payment"]).toBeDefined();
    expect(analysed.bundle["rework:Declaration SUBMITTED by EMPLOYEE"]).toBeDefined();
  });
});
