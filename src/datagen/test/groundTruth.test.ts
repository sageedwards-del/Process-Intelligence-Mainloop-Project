import { DEFAULT_WORK_CALENDAR, analyzeBottlenecks, buildLog, buildProcessMap, evaluateRules } from "@throughline/engine";
import { describe, expect, it } from "vitest";
import { ACTIVITIES, INVOICE_RULES, MERIDIAN_COST_MODEL, generateInvoiceLog, toCsv } from "../src/index.js";

const { rows, groundTruth } = generateInvoiceLog({ cases: 3000, seed: 7 });
const log = buildLog(rows);
const sorted = (xs: string[]) => [...xs].sort();

describe("synthetic invoice log", () => {
  it("is deterministic for a seed", () => {
    const again = generateInvoiceLog({ cases: 3000, seed: 7 });
    expect(again.rows.length).toBe(rows.length);
    expect(again.groundTruth).toEqual(groundTruth);
  });

  it("injects every problem at least a few times", () => {
    expect(groundTruth.segregationViolations.length).toBeGreaterThan(30);
    expect(groundTruth.missingDirectorApproval.length).toBeGreaterThan(5);
    expect(groundTruth.duplicates.length).toBe(30);
    expect(groundTruth.missedDiscounts.length).toBeGreaterThan(50);
  });

  it("serializes to CSV with a header and one line per event", () => {
    const csv = toCsv(rows.slice(0, 3));
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("case_id,activity,timestamp,resource,vendor,invoice_number,amount,practice_area,partner,discount_terms");
    expect(lines).toHaveLength(4);
  });
});

describe("engine recovers the injected problems", () => {
  const report = analyzeBottlenecks(log);

  it("ranks the slow partner as the top resource bottleneck", () => {
    expect(report.resources[0]).toMatchObject(groundTruth.slowApprover);
    expect(report.resources[0]!.slowdown).toBeGreaterThan(3);
  });

  it("still ranks the slow partner first when waits are measured in working hours", () => {
    const working = analyzeBottlenecks(log, undefined, { calendar: DEFAULT_WORK_CALENDAR });
    expect(working.waitBasis).toBe("working");
    expect(working.resources[0]).toMatchObject(groundTruth.slowApprover);
  });

  it("finds the rework loop on matching", () => {
    expect(report.rework[0]!.activity).toBe(groundTruth.reworkActivity);
    expect(report.rework[0]!.medianThroughputWithHours).toBeGreaterThan(report.rework[0]!.medianThroughputWithoutHours);
  });

  it("puts partner approval waiting among the top-3 costliest transitions", () => {
    const top3 = report.edges.slice(0, 3).map((e) => e.to);
    expect(top3).toContain(ACTIVITIES.partner);
  });

  it("rule checks return exactly the injected cases", () => {
    const results = Object.fromEntries(evaluateRules(log, INVOICE_RULES).map((r) => [r.id, r]));
    const ids = (id: string) => sorted(results[id]!.violations.map((v) => v.caseId));
    expect(ids("four-eyes")).toEqual(sorted(groundTruth.segregationViolations));
    expect(ids("director-over-10k")).toEqual(sorted(groundTruth.missingDirectorApproval));
    expect(ids("no-duplicates")).toEqual(sorted(groundTruth.duplicates));
    expect(ids("early-payment-discount")).toEqual(sorted(groundTruth.missedDiscounts));
  });

  it("prices missed discounts at 2% of each late invoice", () => {
    const result = evaluateRules(log, INVOICE_RULES, MERIDIAN_COST_MODEL).find((r) => r.id === "early-payment-discount")!;
    const late = new Set(groundTruth.missedDiscounts);
    const expected = log.cases.filter((c) => late.has(c.id)).reduce((sum, c) => sum + (c.attrs.amount as number) * 0.02, 0);
    expect(result.cost).toBeCloseTo(expected, 6);
    expect(result.impact?.category).toBe("time");
  });

  it("happy path follows the designed main flow", () => {
    const map = buildProcessMap(log);
    const onPath = [...map.happyPath].flatMap((k) => k.split(">").map(Number)).filter((a) => a >= 0);
    const names = new Set(onPath.map((a) => log.activities[a]));
    expect(names).toEqual(
      new Set([ACTIVITIES.receive, ACTIVITIES.register, ACTIVITIES.match, ACTIVITIES.partner, ACTIVITIES.approvePayment, ACTIVITIES.schedule, ACTIVITIES.pay]),
    );
  });
});
