import { describe, expect, it } from "vitest";
import { computeVariants, filterLog, summarize, throughputTrend } from "../src/index.ts";
import { H, T0, orderLog } from "./fixtures.ts";

describe("computeVariants", () => {
  it("groups identical sequences and sorts by frequency", () => {
    const log = orderLog();
    log.cases.push({ ...log.cases[1]!, id: "2b" });
    const variants = computeVariants(log);
    expect(variants).toHaveLength(3);
    expect(variants[0]!.key).toBe("Receive Order → Check Credit → Credit Denied → Cancel Order");
    expect(variants[0]!.count).toBe(2);
    expect(variants[0]!.share).toBe(0.5);
    expect(variants[0]!.caseIds).toEqual(["2", "2b"]);
    expect(variants[0]!.throughput.median / H).toBe(4);
  });
});

describe("filterLog", () => {
  const log = orderLog();
  const ids = (f: Parameters<typeof filterLog>[1]) => filterLog(log, f).cases.map((c) => c.id);

  it("filters by activity", () => {
    expect(ids([{ kind: "activity", activity: "Ship Order", mode: "includes" }])).toEqual(["1", "3"]);
    expect(ids([{ kind: "activity", activity: "Ship Order", mode: "excludes" }])).toEqual(["2"]);
    expect(ids([{ kind: "activity", activity: "Unknown", mode: "includes" }])).toEqual([]);
  });

  it("filters by throughput time", () => {
    expect(ids([{ kind: "throughput", minMs: 24 * H }])).toEqual(["1", "3"]);
    expect(ids([{ kind: "throughput", maxMs: 30 * H }])).toEqual(["1", "2"]);
  });

  it("filters by variant and combines filters with AND", () => {
    const key = computeVariants(log).find((v) => v.caseIds.includes("3"))!.key;
    expect(ids([{ kind: "variant", keys: [key] }])).toEqual(["3"]);
    expect(ids([{ kind: "variant", keys: [key], exclude: true }, { kind: "throughput", minMs: 10 * H }])).toEqual(["1"]);
  });

  it("filters by timeframe", () => {
    expect(ids([{ kind: "timeframe", to: T0 + 30 * H, mode: "contained" }])).toEqual(["1", "2"]);
    expect(ids([{ kind: "timeframe", from: T0 + 70 * H, mode: "intersecting" }])).toEqual(["3"]);
  });
});

describe("summarize / throughputTrend", () => {
  it("summarizes the log", () => {
    const s = summarize(orderLog());
    expect(s).toMatchObject({ caseCount: 3, eventCount: 14, activityCount: 8, variantCount: 3 });
    expect(s.throughput.median / H).toBe(26);
  });

  it("buckets cases by ISO week", () => {
    const trend = throughputTrend(orderLog(), "week");
    expect(trend).toHaveLength(1);
    expect(trend[0]).toMatchObject({ start: Date.UTC(2026, 0, 5), cases: 3 });
  });
});
