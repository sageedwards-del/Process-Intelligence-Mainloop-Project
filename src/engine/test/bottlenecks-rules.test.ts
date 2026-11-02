import { describe, expect, it } from "vitest";
import { DEFAULT_COST_MODEL, analyzeBottlenecks, buildLog, evaluateRules, type CostModel, type Rule } from "../src/index.ts";
import { orderLog, trace } from "./fixtures.ts";

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
    expect(ship.capitalCost).toBe(0); // no capitalCost configured
    expect(ship).toMatchObject({ targetHours: 30, targetSource: "configured", consequenceCost: 0 });
    expect(report.edges[0]!.id).toBe("edge:Check Credit → Ship Order");
  });

  it("counts only waiting beyond the median when no target is set", () => {
    const log = buildLog([
      ...trace("a", [["Bill", 0], ["Collect", 24]]),
      ...trace("b", [["Bill", 0], ["Collect", 24]]),
      ...trace("c", [["Bill", 0], ["Collect", 72]]),
    ]);
    const [edge] = analyzeBottlenecks(log, cost).edges;
    expect(edge).toMatchObject({ targetHours: 24, targetSource: "median", excessWaitHours: 48 });
    expect(edge!.delayCost).toBe(48); // 2 excess days × 24 EUR
  });

  it("charges no flat delay cost by default", () => {
    const [edge] = analyzeBottlenecks(orderLog()).edges;
    expect(DEFAULT_COST_MODEL.delayCostPerCaseDay).toBe(0);
    expect(edge!.delayCost).toBe(0);
  });

  it("adds the capital tied up by each waiting case", () => {
    const log = buildLog([
      ...trace("a", [["Bill", 0], ["Collect", 24]], { amount: 36500 }), // 10 EUR/day at 10%
      ...trace("b", [["Bill", 0], ["Collect", 48]], { amount: 73000 }), // 20 EUR/day
      ...trace("c", [["Bill", 0], ["Collect", 24]]), // no amount: flat cost only
    ]);
    const report = analyzeBottlenecks(log, {
      ...cost,
      delayCostPerCaseDay: 1,
      waitTargetsHours: { "Bill → Collect": 0 },
      capitalCost: { attribute: "amount", annualRate: 0.1 },
    });
    const [edge] = report.edges;
    expect(edge!.capitalCost).toBeCloseTo(1 * 10 + 2 * 20, 10);
    expect(edge!.delayCost).toBeCloseTo(50 + (1 + 2 + 1) * 1, 10);
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

  it("prices a slow resource's excess wait with capital cost", () => {
    const rows = [];
    for (let i = 0; i < 30; i++) {
      const approver = i % 3 === 0 ? "Slow" : "Fast";
      rows.push(...trace(`c${i}`, [["Submit", 0, "Clerk"], ["Approve", approver === "Slow" ? 50 : 5, approver]], { amount: 36500 }));
    }
    const capital = { ...cost, delayCostPerCaseDay: 0, capitalCost: { attribute: "amount", annualRate: 0.1 } };
    const [slow] = analyzeBottlenecks(buildLog(rows), capital, { minResourceExecutions: 5 }).resources;
    // 10 executions × (50 − 5) h = 18.75 days × 10 EUR/day
    expect(slow!.capitalCost).toBeCloseTo(187.5, 10);
    expect(slow!.delayCost).toBeCloseTo(187.5, 10);
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

  it("costs every execution for the baseline cost to serve", () => {
    const log = buildLog([
      ...trace("a", [["Invoice", 0], ["Re-invoice", 10], ["Re-invoice", 20]]),
      ...trace("b", [["Invoice", 0]]),
    ]);
    const { costToServe } = analyzeBottlenecks(log, cost);
    // Re-invoice: 2 × 30 min × 60 EUR/h = 60; Invoice: 2 × 10 min = 20
    expect(costToServe.activities).toEqual([
      { id: "labour:Re-invoice", activity: "Re-invoice", executions: 2, minutes: 30, cost: 60 },
      { id: "labour:Invoice", activity: "Invoice", executions: 2, minutes: 10, cost: 20 },
    ]);
    expect(costToServe).toMatchObject({ total: 80, perCase: 40 });
  });
});

describe("allocating time-rule costs to waits", () => {
  // A 2% discount is lost when Receive → Pay takes over 10 days. Approve is usually 1 day.
  const rows = [];
  for (let i = 0; i < 9; i++) rows.push(...trace(`ok${i}`, [["Receive", 0], ["Approve", 24], ["Pay", 48]], { amount: 1000 }));
  rows.push(...trace("late", [["Receive", 0], ["Approve", 24 * 11], ["Pay", 24 * 13]], { amount: 5000 }));
  const log = buildLog(rows);
  const rules: Rule[] = [{ id: "disc", name: "Pay within 10 days", type: "sla", from: "Receive", to: "Pay", maxHours: 240 }];
  const priced: CostModel = { ...cost, delayCostPerCaseDay: 0, ruleImpacts: { disc: { category: "time", share: { attribute: "amount", fraction: 0.02 } } } };

  it("puts the lost discount on the waits that ran over, without adding money", () => {
    const report = analyzeBottlenecks(log, priced, { rules });
    const approve = report.edges.find((e) => e.id === "edge:Receive → Approve")!;
    const pay = report.edges.find((e) => e.id === "edge:Approve → Pay")!;
    // The late case waits 10 days beyond the 1-day median before Approve, 1 day beyond before Pay.
    expect(approve.consequenceCost).toBeCloseTo((100 * 10) / 11, 10);
    expect(pay.consequenceCost).toBeCloseTo((100 * 1) / 11, 10);
    expect(approve.consequenceCost + pay.consequenceCost).toBeCloseTo(evaluateRules(log, rules, priced)[0]!.cost, 10);
    expect(report.edges[0]!.id).toBe("edge:Receive → Approve");
  });

  it("ignores compliance rules and runs without rules", () => {
    const compliance: CostModel = { ...priced, ruleImpacts: { disc: { category: "compliance", perViolation: 50 } } };
    expect(analyzeBottlenecks(log, compliance, { rules }).edges.every((e) => e.consequenceCost === 0)).toBe(true);
    expect(analyzeBottlenecks(log, priced).edges.every((e) => e.consequenceCost === 0)).toBe(true);
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

  it("prices violations from the cost model", () => {
    const priced = evaluateRules(log, rules, {
      ...cost,
      ruleImpacts: {
        r4: { category: "time", share: { attribute: "amount", fraction: 0.02 } },
        r5: { category: "compliance", perViolation: 50, share: { attribute: "amount", fraction: 1 } },
      },
    });
    const byId = Object.fromEntries(priced.map((r) => [r.id, r]));
    expect(byId.r4!.cost).toBe(400); // 2% of the 20k "same-person" invoice
    expect(byId.r5!.violations[0]!.cost).toBe(15050); // whole duplicate amount + 50 handling
    expect(byId.r5!.impact?.category).toBe("compliance");
    expect(byId.r1!.cost).toBe(0);
    expect(byId.r1!.impact).toBeNull();
  });

  it("prices the expected loss when part of the amount is recovered", () => {
    const [dup] = evaluateRules(log, [rules[4]!], {
      ...cost,
      ruleImpacts: { r5: { category: "compliance", perViolation: 50, share: { attribute: "amount", fraction: 1 }, recoveryRate: 0.9 } },
    });
    expect(dup!.cost).toBeCloseTo(50 + 15000 * 0.1, 10);
  });
});
