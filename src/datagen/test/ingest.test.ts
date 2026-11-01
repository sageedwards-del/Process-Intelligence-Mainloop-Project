import { buildLog, guessMapping, ingestTable, summarize } from "@throughline/engine";
import { describe, expect, it } from "vitest";
import { generateInvoiceLog, toCsv } from "../src/index.ts";

// The sample CSV has no quoted commas, so a plain split is enough here.
const { rows } = generateInvoiceLog({ cases: 500, seed: 3 });
const [header, ...lines] = toCsv(rows).trim().split("\n");
const table = { headers: header!.split(","), rows: lines.map((l) => l.split(",")) };

describe("uploading the Meridian CSV", () => {
  const mapping = guessMapping(table);

  it("guesses every column role", () => {
    expect(mapping).toMatchObject({ caseId: "case_id", activity: "activity", timestamp: "timestamp", resource: "resource", timestampFormat: "iso" });
    expect(mapping.attributes).toEqual(["vendor", "invoice_number", "amount", "practice_area", "partner", "discount_terms"]);
  });

  it("ingests into the same log as the generator, with no errors", () => {
    const { events, report } = ingestTable(table, mapping);
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report.eventsKept).toBe(rows.length);
    expect(summarize(buildLog(events))).toEqual(summarize(buildLog(rows)));
  });
});
