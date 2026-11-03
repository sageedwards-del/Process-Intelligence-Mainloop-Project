import { generateMemo } from "@/lib/ai/memo";
import { errorResponse } from "@/lib/ai/http";
import { DEMO_REGENERATION, demoIdOf, readDemoOutput } from "@/lib/ai/demoOutputs";
import { readOutput } from "@/lib/ai/store";
import { resolveTarget } from "@/lib/ai/target";

/** The memo for a demo or a dataset ID: GET reads the stored one (or null), POST writes a new one with Claude. */

export const maxDuration = 300;

export async function GET(_: Request, ctx: RouteContext<"/api/ai/[target]/memo">) {
  try {
    const param = (await ctx.params).target;
    // A demo's memo is a committed file anyone can read, signed in or not.
    const demo = demoIdOf(param);
    if (demo) {
      const hit = await readDemoOutput(demo, "memo");
      return Response.json({ memo: hit?.output ?? null, createdAt: hit?.createdAt ?? null, canEdit: DEMO_REGENERATION });
    }
    const target = await resolveTarget(param);
    const stored = await readOutput(target, "memo");
    return Response.json({ memo: stored?.output ?? null, createdAt: stored?.createdAt ?? null, canEdit: target.canEdit });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(_: Request, ctx: RouteContext<"/api/ai/[target]/memo">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    if (!target.canEdit) return Response.json({ error: target.datasetId ? "Viewers can read the memo but not regenerate it." : "The demo's memo is fixed; upload your own log to write a new one." }, { status: 403 });
    const memo = await generateMemo(target);
    return Response.json({ memo, createdAt: new Date().toISOString(), canEdit: true });
  } catch (e) {
    return errorResponse(e);
  }
}
