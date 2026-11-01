import { describe, expect, it } from "vitest";
import { analyzeRootCauses, buildLog, type CaseFilter } from "../src/index.ts";
import { H, trace } from "./fixtures.ts";

// 40 cases: team B (approved by Bob) is slow in 15 of 20 cases, team A in 2 of 20.
const rows = [];
for (let i = 0; i < 40; i++) {
  const teamB = i >= 20;
  const slow = teamB ? i < 35 : i < 2;
  rows.push(
    ...trace(`c${i}`, [["Submit", 0, "Clerk"], ["Approve", slow ? 100 : 10, teamB ? "Bob" : "Ann"]], {
      team: teamB ? "B" : "A",
      amount: (i + 1) * 100,
      ref: `INV-${i}`,
    }),
  );
}
const log = buildLog(rows);
const slowCases: CaseFilter[] = [{ kind: "throughput", minMs: 50 * H }];

describe("analyzeRootCauses", () => {
  const report = analyzeRootCauses(log, slowCases, { resourceActivities: ["Approve"], minCases: 10 });
  const byId = Object.fromEntries(report.factors.map((f) => [f.id, f]));

  it("puts the over-represented segment first, with its evidence", () => {
    expect(report).toMatchObject({ totalCases: 40, outcomeCases: 17, overallRate: 17 / 40 });
    expect(report.factors.slice(0, 2).map((f) => f.id).sort()).toEqual(["segment:resource@Approve=Bob", "segment:team=B"]);
    const b = byId["segment:team=B"]!;
    expect(b).toMatchObject({ cases: 20, outcomeCases: 15, rate: 0.75, restRate: 0.1, smallSample: false, significant: true });
    expect(b.lift).toBeCloseTo(0.75 / 0.425, 10);
    expect(b.excessCases).toBeCloseTo(6.5, 10);
    expect(b.z).toBeCloseTo(4.158, 3);
    expect(byId["segment:team=A"]!.excessCases).toBeCloseTo(-6.5, 10);
  });

  it("buckets numeric attributes by quantile and skips id-like ones", () => {
    const amount = report.factors.filter((f) => f.attribute === "amount").map((f) => f.value);
    expect(amount).toHaveLength(4);
    expect(amount).toContain("[100, 1080)");
    expect(amount).toContain("[3030, 4000]");
    expect(report.factors.some((f) => f.attribute === "ref")).toBe(false);
  });

  it("flags small segments and never calls them significant", () => {
    const thin = analyzeRootCauses(log, slowCases); // default minCases 30 > 20 per team
    expect(thin.factors.find((f) => f.id === "segment:team=B")).toMatchObject({ smallSample: true, significant: false });
  });

  it("returns no factors when the outcome hits no case or every case", () => {
    expect(analyzeRootCauses(log, [{ kind: "throughput", minMs: 1000 * H }]).factors).toEqual([]);
    expect(analyzeRootCauses(log, []).factors).toEqual([]);
  });

  it("can be limited to named attributes", () => {
    const only = analyzeRootCauses(log, slowCases, { attributes: ["team"] });
    expect(new Set(only.factors.map((f) => f.attribute))).toEqual(new Set(["team"]));
  });
});
