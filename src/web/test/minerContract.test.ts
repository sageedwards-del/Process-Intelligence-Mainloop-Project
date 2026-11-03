import { buildLog } from "@throughline/engine";
import { describe, expect, it } from "vitest";
import { conformanceResult, referenceVariants, toContractEvents, type MinerConformance } from "@/lib/miner/contract";
import { DEMO_MINER_OUTPUTS } from "@/lib/miner/demoOutputs";

const t = (d: number, h = 9) => Date.UTC(2026, 2, d, h);
const log = buildLog([
  ...["1", "2", "3"].flatMap((id) => [
    { caseId: id, activity: "Receive", timestamp: t(1), resource: "ana" },
    { caseId: id, activity: "Approve", timestamp: t(2) },
    { caseId: id, activity: "Pay", timestamp: t(3) },
  ]),
  { caseId: "4", activity: "Receive", timestamp: t(1) },
  { caseId: "4", activity: "Pay", timestamp: t(2) },
]);

describe("miner contract", () => {
  it("sends every event with an ISO timestamp in UTC and the resource only when known", () => {
    const events = toContractEvents(log);
    expect(events).toHaveLength(11);
    expect(events[0]).toEqual({ case_id: "1", activity: "Receive", timestamp: "2026-03-01T09:00:00.000Z", resource: "ana" });
    expect(events[1]).not.toHaveProperty("resource");
  });

  it("takes the most common variants until they cover half the cases", () => {
    expect(referenceVariants(log)).toEqual({ variants: [["Receive", "Approve", "Pay"]], share: 0.75 });
    expect(referenceVariants(log, 0.9).variants).toHaveLength(2);
    expect(referenceVariants(log, 1, 1).variants).toHaveLength(1);
  });

  it("trims conformance to deviations by case and the lowest-fitness cases", () => {
    const raw: MinerConformance = {
      num_cases: 3,
      num_fit_cases: 1,
      conformance_rate: 1 / 3,
      average_fitness: 0.8,
      log_fitness: 0.79,
      cases: [
        { case_id: "a", fitness: 1, is_fit: true, deviating_activities: [] },
        { case_id: "b", fitness: 0.6, is_fit: false, deviating_activities: ["Rework", "Rework", "Skip"] },
        { case_id: "c", fitness: 0.8, is_fit: false, deviating_activities: ["Rework"] },
      ],
      weekly: [{ iso_week: "2026-W10", week_start: "2026-03-02", num_cases: 3, num_fit_cases: 1, conformance_rate: 1 / 3 }],
      reference: { bpmn_xml: "<xml/>", matched_cases: 1, unmatched_variants: [] },
      duration_ms: 5,
    };
    const r = conformanceResult(raw, { variants: [["A"]], share: 0.3 });
    // "Rework" twice in case b counts once.
    expect(r.deviations).toEqual([
      { activity: "Rework", cases: 2 },
      { activity: "Skip", cases: 1 },
    ]);
    expect(r.worstCases.map((c) => c.caseId)).toEqual(["b", "c"]);
    expect(r.reference.bpmnXml).toBe("<xml/>");
    expect(r.weekly).toEqual([{ week: "2026-W10", weekStart: "2026-03-02", cases: 3, rate: 1 / 3 }]);
  });

  it("ships demo results that match the demos' logs", () => {
    // Regenerate with scripts/build-miner-demos.mts if a demo log changes.
    expect(DEMO_MINER_OUTPUTS.bpic2020.model.stats.cases).toBe(10500);
    expect(DEMO_MINER_OUTPUTS.meridian.model.stats.events).toBe(37587);
    for (const { model, conformance } of Object.values(DEMO_MINER_OUTPUTS)) {
      expect(model.bpmnXml).toContain("bpmndi:BPMNDiagram");
      expect(conformance.cases).toBe(model.stats.cases);
      expect(conformance.conformanceRate).toBeGreaterThan(0);
    }
  });
});
