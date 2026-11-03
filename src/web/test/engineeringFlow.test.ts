import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { FLOW } from "@/app/engineering/content";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("Engineering page data-flow diagram", () => {
  test("every step cites the code that does it", () => {
    for (const s of FLOW) expect(s.files.length, s.title).toBeGreaterThan(0);
  });

  test.each(FLOW.flatMap((s) => s.files.map((f) => [s.title, f] as const)))("%s cites %s, which exists", (_, file) => {
    expect(existsSync(ROOT + file)).toBe(true);
  });

  test("only the last step has no arrow", () => {
    expect(FLOW.slice(0, -1).every((s) => s.passes)).toBe(true);
    expect(FLOW.at(-1)?.passes).toBeUndefined();
  });
});
