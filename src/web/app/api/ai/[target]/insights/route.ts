import { generateInsights } from "@/lib/ai/insights";
import { errorResponse } from "@/lib/ai/http";
import { readOutput } from "@/lib/ai/store";
import { resolveTarget } from "@/lib/ai/target";

/** The insights for a demo or a dataset ID: GET reads the stored ones (or null), POST writes new ones with Claude. */

export const maxDuration = 300;

export async function GET(_: Request, ctx: RouteContext<"/api/ai/[target]/insights">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    const stored = await readOutput(target, "insights");
    return Response.json({ insights: stored?.output ?? null, createdAt: stored?.createdAt ?? null, canEdit: target.canEdit });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(_: Request, ctx: RouteContext<"/api/ai/[target]/insights">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    if (!target.canEdit) return Response.json({ error: "Viewers can read the insights but not regenerate them." }, { status: 403 });
    const insights = await generateInsights(target);
    return Response.json({ insights, createdAt: new Date().toISOString(), canEdit: true });
  } catch (e) {
    return errorResponse(e);
  }
}
