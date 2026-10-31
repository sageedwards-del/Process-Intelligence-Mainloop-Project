import { describe, expect, it } from "vitest";
import { analyzeBottlenecks, buildLog, evaluateRules, type CostModel, type Rule } from "../src/index.js";
import { orderLog, trace } from "./fixtures.js";

const cost: CostModel = {
  currency: "EUR",
  hourlyRate: 60,
  handlingMinutes: { "Re-invoice": 30 },
  defaultHandlingMinutes: 10,
  delayCostPerCaseDay: 24,
  waitTargetsHours: { "Check Credit → Ship Order": 30 },
};

describe("analyzeBottlenecks", () => {
  it("ranks transitions by delay cost above target", () => {
    const report = analyzeBottlenecks(orderLog(), cost);
    const ship = report.edges.find((e) => e.id === "edge:Check Credit → Ship Order")!;
    // waits of 24 h and 48 h against a 30 h target -> 18 h excess -> 0.75 day * 24 EUR
    expect(ship.totalWaitHours).toBe(72);
    expect(ship.excessWaitHours).toBe(18);
    expect(ship.delayCost).toBe(18);
    expect(report.edges[0]!.id).toBe("edge:Invoice → Re-invoice"); // 24 h with no target
  });

  it("finds a slow resource", () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      const approver = i % 3 === 0 ? "Slow" : i % 3 === 1 ? "Fast1" : "Fast2";
      const wait = approver === "Slow" ? 50 : 5;
      rows.push(...trace(`c${i}`, [["Submit", 0, "Clerk"], ["Approve", wait, approver]]));
    }
    const report = analyzeBottlenecks(buildLog(rows), cost, { minResourceExecutions: 5 });
    expect(report.resources).toHaveLength(1);
    expect(report.resources[0]).toMatchObject({ id: "resource:Approve@Slow", executions: 10, medianWaitHours: 50 });
    expect(report.resources[0]!.slowdown).toBe(10);
    expect(report.resources[0]!.excessWaitHours).toBe(450);
  });

  it("measures rework and its handling cost", () => {
    const log = buildLog([
      ...trace("a", [["Invoice", 0], ["Re-invoice", 10], ["Re-invoice", 20]]),
      ...trace("b", [["Invoice", 0]]),
    ]);
    const [hotspot] = analyzeBottlenecks(log, cost).rework;
    expect(hotspot).toMatchObject({ id: "rework:Re-invoice", repeatExecutions: 1, casesAffected: 1, shareOfCases: 0.5 });
    expect(hotspot!.handlingCost).toBe(30); // 1 repeat * 30 min * 60 EUR/h
    expect(hotspot!.medianThroughputWithHours).toBe(20);
  });
});

describe("evaluateRules", () => {
  const log = buildLog([
    ...trace("ok", [["Receive", 0, "ann"], ["Approve", 5, "bob"], ["Pay", 30, "cat"]], { amount: 15000, vendor: "A", inv: "1" }),
    ...trace("no-approval", [["Receive", 0, "ann"], ["Pay", 5, "cat"]], { amount: 500, vendor: "B", inv: "7" }),
    ...trace("same-person", [["Receive", 0, "ann"], ["Approve", 5, "ann"], ["Pay", 300, "cat"]], { amount: 20000, vendor: "A", inv: "2" }),
    ...trace("dup", [["Receive", 10, "dan"], ["Approve", 12, "bob"], ["Pay", 20, "cat"]], { amount: 15000, vendor: "A", inv: "1" }),
  ]);
  const rules: Rule[] = [
    { id: "r1", name: "Approve before pay", type: "precedence", before: "Approve", after: "Pay" },
    { id: "r2", name: "Four eyes", type: "segregation", activities: ["Receive", "Approve"] },
    {
      id: "r3",
      name: "Large invoices need approval",
      type: "requires",
      activity: "Approve",
      where: [{ attribute: "amount", op: "gt", value: 10000 }],
    },
    { id: "r4", name: "Pay within 10 days", type: "sla", from: "Receive", to: "Pay", maxHours: 240 },
    { id: "r5", name: "No duplicate invoices", type: "duplicate", keys: ["vendor", "inv"] },
  ];
  const results = Object.fromEntries(evaluateRules(log, rules).map((r) => [r.id, r]));
  const violators = (id: string) => results[id]!.violations.map((v) => v.caseId);

  it("checks precedence", () => expect(violators("r1")).toEqual(["no-approval"]));
  it("checks segregation of duties", () => {
    expect(violators("r2")).toEqual(["same-person"]);
    expect(results.r2!.violations[0]!.detail).toContain("ann");
  });
  it("applies where-conditions", () => {
    expect(results.r3!.casesChecked).toBe(3);
    expect(violators("r3")).toEqual([]);
  });
  it("checks SLAs", () => {
    expect(violators("r4")).toEqual(["same-person"]);
    expect(results.r4!.violationRate).toBe(0.25);
  });
  it("flags later duplicates", () => expect(violators("r5")).toEqual(["dup"]));
});
