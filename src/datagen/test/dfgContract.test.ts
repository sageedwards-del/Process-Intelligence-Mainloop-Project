import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildLog } from "@throughline/engine";
import { describe, expect, it } from "vitest";
import { dfgContract, generateInvoiceLog, toCsv } from "../src/index.ts";

// The pm4py worker checks its own DFG against data/sample/meridian-invoices.dfg.json.
// These tests keep that file in step with the sample CSV and the engine.
const sample = resolve(import.meta.dirname, "../../../data/sample");
const { rows } = generateInvoiceLog({ cases: 5000, seed: 42 });

describe("engine DFG contract for the pm4py parity test", () => {
  it("sample CSV matches the generator (run `npm run datagen` if not)", () => {
    expect(readFileSync(resolve(sample, "meridian-invoices.csv"), "utf8")).toBe(toCsv(rows));
  });

  it("committed DFG matches the engine (run `npm run datagen` if not)", () => {
    const committed = JSON.parse(readFileSync(resolve(sample, "meridian-invoices.dfg.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(dfgContract(buildLog(rows)))));
  });
});
