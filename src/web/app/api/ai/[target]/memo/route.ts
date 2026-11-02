import { generateMemo } from "@/lib/ai/memo";
import { errorResponse } from "@/lib/ai/http";
import { readOutput } from "@/lib/ai/store";
import { resolveTarget } from "@/lib/ai/target";

/** The memo for "sample" or a dataset ID: GET reads the stored one (or null), POST writes a new one with Claude. */

export const maxDuration = 300;

export async function GET(_: Request, ctx: RouteContext<"/api/ai/[target]/memo">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    const stored = await readOutput(target, "memo");
    return Response.json({ memo: stored?.output ?? null, createdAt: stored?.createdAt ?? null, canEdit: target.canEdit });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(_: Request, ctx: RouteContext<"/api/ai/[target]/memo">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    if (!target.canEdit) return Response.json({ error: "Viewers can read the memo but not regenerate it." }, { status: 403 });
    const memo = await generateMemo(target);
    return Response.json({ memo, createdAt: new Date().toISOString(), canEdit: true });
  } catch (e) {
    return errorResponse(e);
  }
}
