import { ask, type AskAnswer } from "@/lib/ai/ask";
import { describeError, errorResponse } from "@/lib/ai/http";
import { readAnswers } from "@/lib/ai/store";
import { resolveTarget } from "@/lib/ai/target";

/**
 * Ask your process. GET lists the dataset's earlier answers; POST {question}
 * streams newline-delimited JSON: one {type:"tool"} line per engine call as it
 * happens, then {type:"answer"} once the answer has passed the grounding check.
 * The answer's text is never streamed before that check.
 */

export const maxDuration = 300;

export async function GET(_: Request, ctx: RouteContext<"/api/ai/[target]/ask">) {
  try {
    const target = await resolveTarget((await ctx.params).target);
    const answers = await readAnswers<AskAnswer>(target);
    return Response.json({ answers: answers.map((a) => a.output) });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/ai/[target]/ask">) {
  let question: string;
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim().slice(0, 1000) : "";
  } catch {
    question = "";
  }
  if (!question) return Response.json({ error: "Ask a question." }, { status: 400 });

  let target;
  try {
    target = await resolveTarget((await ctx.params).target);
  } catch (e) {
    return errorResponse(e);
  }
  const encoder = new TextEncoder();
  const events = ask(target, question);
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await events.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
      } catch (e) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: describeError(e)[1] })}\n`));
        controller.close();
      }
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
