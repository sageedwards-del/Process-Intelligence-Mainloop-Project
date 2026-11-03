import "server-only";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDemoId, type DemoId } from "../analysis/demos";

/**
 * The demos' insights and memo are generated once, pass the grounding check, and are committed as
 * JSON in lib/ai/demo-outputs/, so every visitor sees them without signing in or spending API calls.
 * Regenerating them is a development task: run the dev server with ALLOW_DEMO_REGENERATION=1,
 * sign in, and press Generate; the new output is written back to these files for review and commit.
 */

export type DemoKind = "insights" | "memo";

export const DEMO_REGENERATION = process.env.ALLOW_DEMO_REGENERATION === "1" && process.env.NODE_ENV !== "production";

/** Demo URL targets; "sample" is Meridian's original name. */
const ALIASES: Record<string, DemoId> = { sample: "meridian" };

export function demoIdOf(target: string): DemoId | null {
  const id = ALIASES[target] ?? target;
  return isDemoId(id) ? id : null;
}

// Read from disk (next.config traces this folder into the AI routes) so a regenerated file shows without a rebuild.
const file = (id: DemoId, kind: DemoKind) => join(process.cwd(), "lib/ai/demo-outputs", `${id}.${kind}.json`);

export async function readDemoOutput<T>(id: DemoId, kind: DemoKind): Promise<{ output: T; createdAt: string } | null> {
  try {
    return JSON.parse(await readFile(file(id, kind), "utf8")) as { output: T; createdAt: string };
  } catch {
    return null;
  }
}

export async function writeDemoOutput(id: DemoId, kind: DemoKind, output: unknown, createdAt: string): Promise<void> {
  if (!DEMO_REGENERATION) return;
  await writeFile(file(id, kind), `${JSON.stringify({ createdAt, output }, null, 2)}\n`);
}
