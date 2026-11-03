import { describe, expect, test } from "vitest";
import { safeNext } from "@/lib/supabase/env";

describe("safeNext", () => {
  test("keeps same-site paths with their query and hash", () => {
    expect(safeNext("/sample")).toBe("/sample");
    expect(safeNext("/sample/meridian#insights")).toBe("/sample/meridian#insights");
    expect(safeNext("/app/datasets/1?tab=memo")).toBe("/app/datasets/1?tab=memo");
  });

  test.each([
    ["//evil.com"],
    ["/\\evil.com"],
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/\r\n/evil.com"],
    ["https://evil.com"],
    ["evil.com"],
    [""],
  ])("refuses %j", (next) => {
    expect(safeNext(next)).toBe("/app");
  });

  test("falls back when there is no value", () => {
    expect(safeNext(null)).toBe("/app");
    expect(safeNext(undefined, "/sample")).toBe("/sample");
  });
});
