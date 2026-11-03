import { generateInsights } from "@/lib/ai/insights";
import { errorResponse } from "@/lib/ai/http";
import { DEMO_REGENERATION, demoIdOf, readDemoOutput } from "@/lib/ai/demoOutputs";
import { readOutput } from "@/lib/ai/store";
import { resolveTarget } from "@/lib/ai/target";

/** The insights for a demo or a dataset ID: GET reads the stored ones (or null), POST writes new ones with Claude. */

export const maxDuration = 300;

export async function GET(_: Request, ctx: RouteContext<"/api/ai/[target]/insights">) {
  try {
    const param = (await ctx.params).target;
    // A demo's insights is a committed file anyone can read, signed in or not.
    const demo = demoIdOf(param);
    if (demo) {
      const hit = await readDemoOutput(demo, "insights");
      return Response.json({ insights: hit?.output ?? null, createdAt: hit?.createdAt ?? null, canEdit: DEMO_REGENERATION });
    }
    const target = await resolveTarget(param);
    const stored = await readOutput(target, "insights");
    return Response.json({ insights: stored?.output ?? null, createdAt: stored?.createdAt ?? null, canEdit: target.canEdit });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(_: Request, ctx: RouteContext<"/api/ai/[target]/insights">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    if (!target.canEdit) return Response.json({ error: target.datasetId ? "Viewers can read the insights but not regenerate them." : "The demo's insights are fixed; upload your own log to generate new ones." }, { status: 403 });
    const insights = await generateInsights(target);
    return Response.json({ insights, createdAt: new Date().toISOString(), canEdit: true });
  } catch (e) {
    return errorResponse(e);
  }
}
