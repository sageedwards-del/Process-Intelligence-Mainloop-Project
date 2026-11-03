import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { TargetError } from "./target";

/** An error as a plain message the page can show, with a fitting status. */
export function errorResponse(e: unknown): Response {
  const [status, error] = describeError(e);
  return Response.json({ error }, { status });
}

export function describeError(e: unknown): [number, string] {
  if (e instanceof TargetError) return [e.status, e.message];
  if (e instanceof Anthropic.RateLimitError) return [429, "The AI service is busy right now (rate limited). Try again in a minute."];
  if (e instanceof Anthropic.AuthenticationError) return [503, "The AI isn't set up correctly on this server (the API key was refused)."];
  if (e instanceof Anthropic.APIError) return [502, `The AI couldn't answer (${e.status ?? "network error"}). Try again.`];
  console.error(e);
  return [500, "Something went wrong. Try again."];
}
