import { generateFindings } from "@/lib/ai/findings";
import { errorResponse } from "@/lib/ai/http";
import { readOutput } from "@/lib/ai/store";
import { resolveTarget } from "@/lib/ai/target";

/** The findings for a demo or a dataset ID: GET reads the stored one (or null), POST writes a new one with Claude. */

export const maxDuration = 300;

export async function GET(_: Request, ctx: RouteContext<"/api/ai/[target]/findings">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    const stored = await readOutput(target, "findings");
    return Response.json({ findings: stored?.output ?? null, createdAt: stored?.createdAt ?? null, canEdit: target.canEdit });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(_: Request, ctx: RouteContext<"/api/ai/[target]/findings">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    if (!target.canEdit) return Response.json({ error: "Viewers can read the findings but not regenerate it." }, { status: 403 });
    const findings = await generateFindings(target);
    return Response.json({ findings, createdAt: new Date().toISOString(), canEdit: true });
  } catch (e) {
    return errorResponse(e);
  }
}
