import type { DemoId } from "../analysis/demos";
import type { ConformanceResult, ModelResult } from "./contract";
import bpic2020Conformance from "./demo-outputs/bpic2020.conformance.json";
import bpic2020Model from "./demo-outputs/bpic2020.model.json";
import meridianConformance from "./demo-outputs/meridian.conformance.json";
import meridianModel from "./demo-outputs/meridian.model.json";

/**
 * The demos' BPMN model and conformance, computed once by scripts/build-miner-demos.mts against
 * the miner and committed, so visitors see them without signing in and the public demo doesn't
 * load the mining service.
 */
export const DEMO_MINER_OUTPUTS: Record<DemoId, { model: ModelResult; conformance: ConformanceResult }> = {
  bpic2020: { model: bpic2020Model, conformance: bpic2020Conformance },
  meridian: { model: meridianModel, conformance: meridianConformance },
};
