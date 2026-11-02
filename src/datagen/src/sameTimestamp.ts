import type { RawEvent } from "@throughline/engine";
import { Random } from "./random.ts";

/**
 * A small purchase-to-pay log built to stress timestamp ties, as real exports
 * have them: date-only timestamps (every step of a day at midnight, weekends
 * included) and batch timestamps (a nightly job stamping several steps at the
 * same instant). Rows are shuffled across the whole file, so events that share
 * a timestamp appear in an arbitrary order and only the file order can break
 * the tie. The pm4py parity test checks that the engine and pm4py agree on it.
 */
export function generateSameTimestampLog(opts: { cases?: number; seed?: number } = {}): RawEvent[] {
  const rnd = new Random(opts.seed ?? 7);
  const cases = opts.cases ?? 400;
  const DAY = 86_400_000;
  const MIN = 60_000;
  const monday = Date.UTC(2026, 2, 2); // 2026-03-02
  const users = ["clerk-1", "clerk-2", "buyer-1", "buyer-2"];
  const out: RawEvent[] = [];

  for (let i = 0; i < cases; i++) {
    const caseId = `PO-${String(i + 1).padStart(4, "0")}`;
    const kind = rnd.pick(["date-only", "batch", "timed"] as const);
    const day0 = monday + rnd.int(0, 27) * DAY;
    const steps = ["Create Order", "Approve Order", "Receive Goods", "Receive Invoice", "Post to Ledger", "Pay"];
    if (rnd.chance(0.2)) steps.splice(1, 0, "Change Price", "Approve Order"); // rework
    if (rnd.chance(0.25)) [steps[3], steps[4]] = [steps[4]!, steps[3]!]; // invoice before goods

    let t = day0;
    const batchAt = day0 + rnd.int(1, 4) * DAY + 2 * 60 * MIN; // 02:00 a few days later
    steps.forEach((activity, k) => {
      if (kind === "date-only") {
        // Whole days only, and often several steps on the same day.
        if (k > 0 && rnd.chance(0.55)) t += rnd.int(1, 3) * DAY;
      } else if (kind === "batch" && ["Receive Goods", "Receive Invoice", "Post to Ledger"].includes(activity)) {
        t = Math.max(t, batchAt);
      } else {
        t += k === 0 ? rnd.int(8 * 60, 17 * 60) * MIN : rnd.int(5, 3 * 24 * 60) * MIN;
      }
      out.push({ caseId, activity, timestamp: t, resource: rnd.chance(0.9) ? rnd.pick(users) : null });
    });
  }

  // Fisher–Yates over the whole file: tied events end up in arbitrary file order.
  for (let i = out.length - 1; i > 0; i--) {
    const j = rnd.int(0, i);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
