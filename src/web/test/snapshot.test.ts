import { buildLog } from "@throughline/engine";
import { describe, expect, it } from "vitest";
import { decodeSnapshot, encodeSnapshot } from "../lib/snapshot";

const gzip = (text: string) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).blob();

describe("snapshot", () => {
  const log = buildLog([
    { caseId: "1", activity: "A", timestamp: Date.UTC(2026, 0, 1) },
    { caseId: "1", activity: "B", timestamp: Date.UTC(2026, 0, 2) },
  ]);

  it("round-trips a log", async () => {
    const back = await decodeSnapshot(await encodeSnapshot(log));
    expect(back).toEqual(JSON.parse(JSON.stringify(log)));
  });

  it("refuses a snapshot that decompresses past the cap (gzip bomb)", async () => {
    // 4 MB of zeros gzips to a few KB.
    const bomb = await gzip(JSON.stringify({ version: 2, log: "0".repeat(4 * 1024 * 1024) }));
    expect(bomb.size).toBeLessThan(64 * 1024);
    await expect(decodeSnapshot(bomb, 1024 * 1024)).rejects.toThrow(/over 1 MB once decompressed/);
  });

  it("refuses unknown versions", async () => {
    await expect(decodeSnapshot(await gzip(JSON.stringify({ version: 99, log }))).catch((e: Error) => e.message)).resolves.toMatch(/Unsupported snapshot version 99/);
  });
});
