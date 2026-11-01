import { buildLog, type RawEvent } from "../src/index.ts";

export const H = 3_600_000;
export const T0 = Date.UTC(2026, 0, 5, 9); // Monday 5 Jan 2026, 09:00 UTC

/** Build rows for one case from [activity, hoursSinceStart, resource?] tuples. */
export function trace(caseId: string, steps: [string, number, string?][], attrs?: RawEvent["attrs"]): RawEvent[] {
  return steps.map(([activity, h, resource]) => ({ caseId, activity, timestamp: T0 + h * H, resource, attrs }));
}

/** The three order cases from the original project notes. */
export function orderLog() {
  return buildLog([
    ...trace("1", [["Receive Order", 0], ["Check Credit", 1], ["Ship Order", 25], ["Invoice", 26]]),
    ...trace("2", [["Receive Order", 0], ["Check Credit", 2], ["Credit Denied", 3], ["Cancel Order", 4]]),
    ...trace("3", [
      ["Receive Order", 0],
      ["Check Credit", 1],
      ["Ship Order", 49],
      ["Price Change", 50],
      ["Invoice", 51],
      ["Re-invoice", 75],
    ]),
  ]);
}
