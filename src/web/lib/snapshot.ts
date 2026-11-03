import type { EventLog } from "@throughline/engine";

/**
 * Bumped whenever the snapshot layout changes, so old snapshots can be detected.
 * Version 2 adds optional per-event start (`s`) and processing time (`p`);
 * version 1 snapshots are the same shape without them, so both decode.
 */
export const SNAPSHOT_VERSION = 2;
const READABLE = new Set([1, 2]);

/**
 * The dataset snapshot: the engine's dictionary-encoded log as gzipped JSON,
 * small enough for the browser to download and analyse without the database.
 */
export async function encodeSnapshot(log: EventLog): Promise<Blob> {
  const json = JSON.stringify({ version: SNAPSHOT_VERSION, log });
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

/**
 * Largest decompressed snapshot we'll read: well above the biggest real log we've loaded
 * (the 87 MB BPIC 2019 subset) and below what a browser tab or a 2 GB function can parse.
 * A gzip bomb stops here instead of exhausting memory.
 */
export const MAX_SNAPSHOT_BYTES = 256 * 1024 * 1024;

export async function decodeSnapshot(blob: Blob, maxBytes = MAX_SNAPSHOT_BYTES): Promise<EventLog> {
  const reader = blob.stream().pipeThrough(new DecompressionStream("gzip")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`Snapshot is over ${Math.round(maxBytes / 1024 / 1024)} MB once decompressed`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { version: number; log: EventLog };
  if (!READABLE.has(parsed.version)) throw new Error(`Unsupported snapshot version ${parsed.version}`);
  return parsed.log;
}
