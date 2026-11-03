import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { EventLog } from "@throughline/engine";
import { beforeAll, describe, expect, test } from "vitest";
import { analyseForAi } from "@/lib/ai/bundle";
import { readDemoOutput } from "@/lib/ai/demoOutputs";
import { indexMetrics, type MetricIndex } from "@/lib/ai/grounding";
import type { InsightsOutput } from "@/lib/ai/insights";
import type { MemoOutput } from "@/lib/ai/memo";
import { groundAction, groundMemoText, groundOpportunity, groundSummary } from "@/lib/ai/outputs";
import { DEMOS, meridianLog, type DemoId } from "@/lib/analysis/demos";
import { decodeSnapshot } from "@/lib/snapshot";

/**
 * The demos' insights and memo are committed files shown to every visitor. Re-run the grounding
 * check on them against today's engine, so a change to the engine or the cost model can't leave
 * a figure on the site that no longer matches its metric. If this fails, regenerate the demo
 * outputs (ALLOW_DEMO_REGENERATION=1, see lib/ai/demoOutputs.ts).
 */

async function demoLog(id: DemoId): Promise<EventLog> {
  const path = DEMOS[id].snapshotPath;
  if (!path) return meridianLog();
  return decodeSnapshot(new Blob([readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url)))]));
}

// Analysing the 10,500-case BPIC log takes a few seconds, more on a busy CI runner: do it once per demo, with room.
const SLOW = 60_000;

describe.each(["bpic2020", "meridian"] as const)("%s committed outputs", (id) => {
  let index: MetricIndex;
  beforeAll(async () => {
    index = indexMetrics(analyseForAi(await demoLog(id), DEMOS[id].inputs).bundle);
  }, SLOW);

  test("insights exist and still pass the grounding check", async () => {
    const stored = await readDemoOutput<InsightsOutput>(id, "insights");
    expect(stored, "missing lib/ai/demo-outputs insights").not.toBeNull();
    const { summary, actions } = stored!.output;
    expect(summary).toBeTruthy();
    expect(groundSummary(summary!, index)).toEqual([]);
    expect(actions.length).toBeGreaterThanOrEqual(3);
    for (const a of actions) expect(groundAction(a, index), a.action).toEqual([]);
  });

  test("the memo, if committed, still passes the grounding check", async () => {
    const stored = await readDemoOutput<MemoOutput>(id, "memo");
    if (!stored) return;
    expect(groundMemoText(stored.output, index)).toEqual([]);
    const used = new Set<string>();
    for (const o of stored.output.opportunities) expect(groundOpportunity(o, index, used), o.title).toEqual([]);
  });
});
