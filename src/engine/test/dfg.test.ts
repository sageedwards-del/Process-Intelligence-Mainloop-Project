import { describe, expect, it } from "vitest";
import { END, START, buildProcessMap, computeDfg, edgeKey, edgeName, type EventLog } from "../src/index.ts";
import { H, orderLog } from "./fixtures.ts";

const named = (log: EventLog) =>
  Object.fromEntries(computeDfg(log).edges.map((e) => [edgeName(log, e.from, e.to), e]));

describe("computeDfg", () => {
  it("aggregates the three order cases into a directly-follows graph", () => {
    const log = orderLog();
    const dfg = computeDfg(log);
    expect(dfg.caseCount).toBe(3);
    expect(dfg.eventCount).toBe(14);

    const edges = named(log);
    expect(edges["▶ Start → Receive Order"]!.frequency).toBe(3);
    expect(edges["Receive Order → Check Credit"]!.frequency).toBe(3);
    expect(edges["Check Credit → Ship Order"]!.frequency).toBe(2);
    expect(edges["Check Credit → Credit Denied"]!.frequency).toBe(1);
    expect(edges["Invoice → ■ End"]!.frequency).toBe(1);
    expect(edges["Re-invoice → ■ End"]!.frequency).toBe(1);
    expect(edges["Cancel Order → ■ End"]!.frequency).toBe(1);
  });

  it("annotates transitions with waiting time", () => {
    const edges = named(orderLog());
    const ship = edges["Check Credit → Ship Order"]!.duration;
    expect(ship.count).toBe(2);
    expect(ship.min / H).toBe(24);
    expect(ship.max / H).toBe(48);
    expect(ship.median / H).toBe(36);
    expect(ship.total / H).toBe(72);
  });

  it("counts self-loops and distinct cases per edge", () => {
    const log = orderLog();
    log.cases[0]!.events.push({ a: log.cases[0]!.events[3]!.a, t: log.cases[0]!.events[3]!.t + H, r: -1 });
    const inv = named(log)["Invoice → Invoice"]!;
    expect(inv.frequency).toBe(1);
    expect(inv.caseCount).toBe(1);
  });
});

describe("buildProcessMap", () => {
  it("marks the most frequent variant as the happy path", () => {
    const log = orderLog();
    // Duplicate case 1 so it becomes the most frequent variant.
    log.cases.push({ ...log.cases[0]!, id: "1b" });
    const map = buildProcessMap(log);
    const a = (n: string) => log.activities.indexOf(n);
    expect(map.happyPath).toEqual(
      new Set([
        edgeKey(START, a("Receive Order")),
        edgeKey(a("Receive Order"), a("Check Credit")),
        edgeKey(a("Check Credit"), a("Ship Order")),
        edgeKey(a("Ship Order"), a("Invoice")),
        edgeKey(a("Invoice"), END),
      ]),
    );
  });

  it("hides rare activities by bridging their neighbours", () => {
    const log = orderLog();
    const map = buildProcessMap(log, { activityShare: 0.5 });
    const names = map.activities.map((id) => map.dfg.nodes.find((n) => n.activity === id) && log.activities[id]);
    expect(names).toHaveLength(4);
    expect(names).toEqual(expect.arrayContaining(["Receive Order", "Check Credit", "Ship Order", "Invoice"]));
  });

  it("never orphans a visible activity when paths are reduced", () => {
    const map = buildProcessMap(orderLog(), { pathShare: 0 });
    for (const id of map.activities) {
      expect(map.edges.some((e) => e.to === id)).toBe(true);
      expect(map.edges.some((e) => e.from === id)).toBe(true);
    }
  });
});
