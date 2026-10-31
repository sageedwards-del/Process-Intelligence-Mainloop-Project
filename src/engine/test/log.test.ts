import { describe, expect, it } from "vitest";
import { NO_RESOURCE, buildLog, projectActivities, throughputTime } from "../src/index.js";
import { H, T0, orderLog, trace } from "./fixtures.js";

describe("buildLog", () => {
  it("groups by case, interns activities and keeps first-seen case order", () => {
    const log = orderLog();
    expect(log.cases.map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(log.activities).toEqual([
      "Receive Order",
      "Check Credit",
      "Ship Order",
      "Invoice",
      "Credit Denied",
      "Cancel Order",
      "Price Change",
      "Re-invoice",
    ]);
    expect(log.cases[0]!.events.every((e) => e.r === NO_RESOURCE)).toBe(true);
  });

  it("sorts events by timestamp and keeps input order on ties", () => {
    const log = buildLog([
      { caseId: "a", activity: "B", timestamp: T0 + H },
      { caseId: "a", activity: "A", timestamp: T0 },
      { caseId: "a", activity: "C", timestamp: T0 + H },
    ]);
    expect(log.cases[0]!.events.map((e) => log.activities[e.a])).toEqual(["A", "B", "C"]);
  });

  it("promotes constant attributes to case level and keeps varying ones on events", () => {
    const log = buildLog([
      { caseId: "a", activity: "A", timestamp: T0, attrs: { vendor: "Acme", step: 1 } },
      { caseId: "a", activity: "B", timestamp: T0 + H, attrs: { vendor: "Acme", step: 2 } },
    ]);
    const c = log.cases[0]!;
    expect(c.attrs).toEqual({ vendor: "Acme" });
    expect(c.events.map((e) => e.attrs)).toEqual([{ step: 1 }, { step: 2 }]);
  });

  it("does not mutate the input rows", () => {
    const shared = { vendor: "Acme" };
    const rows = [
      { caseId: "a", activity: "A", timestamp: T0, attrs: shared },
      { caseId: "a", activity: "B", timestamp: T0 + H, attrs: shared },
    ];
    buildLog(rows);
    expect(shared).toEqual({ vendor: "Acme" });
  });

  it("rejects invalid timestamps with a useful message", () => {
    expect(() => buildLog([{ caseId: "x", activity: "A", timestamp: Number.NaN }])).toThrow(/case "x"/);
  });

  it("computes throughput time", () => {
    expect(orderLog().cases.map((c) => throughputTime(c) / H)).toEqual([26, 4, 75]);
  });
});

describe("projectActivities", () => {
  it("drops hidden activities and removes empty cases", () => {
    const log = buildLog([...trace("a", [["A", 0], ["B", 1], ["C", 2]]), ...trace("b", [["B", 0]])]);
    const keep = new Set([log.activities.indexOf("A"), log.activities.indexOf("C")]);
    const p = projectActivities(log, keep);
    expect(p.cases).toHaveLength(1);
    expect(p.cases[0]!.events.map((e) => p.activities[e.a])).toEqual(["A", "C"]);
  });
});
