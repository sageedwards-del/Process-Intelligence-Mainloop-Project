import type { EventLog } from "@throughline/engine";
import type { AnalysisInputs } from "./analyse";
import { DEMOS, meridianLog } from "./demos";

/** The Meridian sample as /sample shows it: 5,000 invoices, seed 42, its own cost model and rules. */
export function meridianSample(): { log: EventLog; inputs: AnalysisInputs } {
  return { log: meridianLog(), inputs: DEMOS.meridian.inputs };
}
