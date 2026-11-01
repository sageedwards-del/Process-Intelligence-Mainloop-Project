import { describe, expect, it } from "vitest";
import {
  DEFAULT_COST_MODEL,
  DEFAULT_COST_SETTINGS,
  attributeOverview,
  buildLog,
  caseTimeline,
  costModelFromSettings,
  filterLog,
  parseCostSettings,
  parseRule,
  slowCasesFilter,
  slowestCases,
} from "../src/index.ts";
import { H, T0, orderLog, trace } from "./fixtures.ts";

describe("caseTimeline", () => {
  it("lists events in order with the wait before each", () => {
    const log = buildLog([
      ...trace("A", [["Submit", 0, "Ann"], ["Approve", 5, "Bob"], ["Pay", 29]], { team: "X", amount: 100 }),
    ]);
    const t = caseTimeline(log, "A")!;
    expect(t).toMatchObject({ id: "A", attrs: { team: "X", amount: 100 }, start: T0, end: T0 + 29 * H, throughputMs: 29 * H });
    expect(t.events.map((e) => [e.activity, e.resource, e.waitMs / H])).toEqual([
      ["Submit", "Ann", 0],
      ["Approve", "Bob", 5],
      ["Pay", null, 24],
    ]);
  });

  it("keeps event-level attributes and returns null for unknown cases", () => {
    const log = buildLog([
      { caseId: "A", activity: "Submit", timestamp: T0, attrs: { note: "first" } },
      { caseId: "A", activity: "Edit", timestamp: T0 + H, attrs: { note: "second" } },
    ]);
    expect(caseTimeline(log, "A")!.events.map((e) => e.attrs)).toEqual([{ note: "first" }, { note: "second" }]);
    expect(caseTimeline(log, "nope")).toBeNull();
  });
});

describe("slowestCases and slowCasesFilter", () => {
  const log = orderLog(); // throughput: 1 → 26 h, 2 → 4 h, 3 → 75 h

  it("ranks cases by duration", () => {
    expect(slowestCases(log, 2).map((c) => [c.id, c.throughputMs / H, c.steps])).toEqual([
      ["3", 75, 6],
      ["1", 26, 4],
    ]);
  });

  it("thresholds at a duration percentile", () => {
    const f = slowCasesFilter(log, 0.5);
    expect(f).toEqual({ kind: "throughput", minMs: 26 * H });
    expect(filterLog(log, [f]).cases.map((c) => c.id)).toEqual(["1", "3"]);
    expect(filterLog(log, [slowCasesFilter(log, 1)]).cases.map((c) => c.id)).toEqual(["3"]);
  });
});

describe("attributeOverview", () => {
  it("summarises categorical and numeric case attributes", () => {
    const log = buildLog([
      ...trace("1", [["A", 0]], { team: "X", amount: 10 }),
      ...trace("2", [["A", 0]], { team: "Y", amount: 30 }),
      ...trace("3", [["A", 0]], { team: "X" }),
    ]);
    expect(attributeOverview(log)).toEqual([
      { key: "amount", type: "number", distinct: 3, values: [], min: 10, max: 30 },
      { key: "team", type: "category", distinct: 2, values: [{ value: "X", count: 2 }, { value: "Y", count: 1 }] },
    ]);
    expect(attributeOverview(log, 1)[1]!.values).toEqual([{ value: "X", count: 2 }]);
  });
});

describe("parseCostSettings", () => {
  it("fills defaults and coerces form strings", () => {
    expect(parseCostSettings({})).toEqual({
      ok: true,
      settings: DEFAULT_COST_SETTINGS,
    });
    const r = parseCostSettings({ currency: "USD", hourlyRate: "80", delayCostPerCaseDay: "2.5", capitalCost: { attribute: " amount ", annualRate: "0.08" } });
    expect(r).toEqual({
      ok: true,
      settings: { currency: "USD", hourlyRate: 80, delayCostPerCaseDay: 2.5, defaultHandlingMinutes: 10, capitalCost: { attribute: "amount", annualRate: 0.08 } },
    });
  });

  it("rejects negative, non-numeric and out-of-range values", () => {
    const r = parseCostSettings({ currency: "XYZ", hourlyRate: -1, delayCostPerCaseDay: "abc", capitalCost: { attribute: "amount", annualRate: 2 } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(4);
  });
});

describe("costModelFromSettings", () => {
  it("builds an engine cost model and carries rule impacts", () => {
    const settings = { currency: "EUR", hourlyRate: 60, delayCostPerCaseDay: 3, defaultHandlingMinutes: 15 };
    expect(costModelFromSettings(settings)).toEqual({ ...DEFAULT_COST_MODEL, hourlyRate: 60, delayCostPerCaseDay: 3, defaultHandlingMinutes: 15 });
    const rule = parseRule({ id: "r", name: "R", type: "requires", activity: "Approve", impact: { category: "compliance", perViolation: 100 } })!;
    expect(costModelFromSettings(settings, [rule]).ruleImpacts).toEqual({ r: { category: "compliance", perViolation: 100 } });
  });
});

describe("parseRule", () => {
  it("accepts each rule type and uses the fallback id", () => {
    expect(parseRule({ name: "P", type: "precedence", before: "A", after: "B" }, "row-1")).toMatchObject({ id: "row-1" });
    expect(parseRule({ id: "s", name: "S", type: "segregation", activities: ["A", "B"] })).not.toBeNull();
    expect(parseRule({ id: "l", name: "L", type: "sla", from: "A", to: "B", maxHours: 24 })).not.toBeNull();
    expect(parseRule({ id: "d", name: "D", type: "duplicate", keys: ["vendor"] })).not.toBeNull();
  });

  it("rejects malformed rules and drops empty impacts", () => {
    expect(parseRule(null)).toBeNull();
    expect(parseRule({ id: "x", name: "X", type: "teleport" })).toBeNull();
    expect(parseRule({ id: "x", name: "X", type: "sla", from: "A", to: "B" })).toBeNull();
    expect(parseRule({ name: "X", type: "requires", activity: "A" })).toBeNull();
    expect(parseRule({ id: "x", name: "X", type: "requires", activity: "A", impact: { category: "time" } })).not.toHaveProperty("impact");
  });
});
