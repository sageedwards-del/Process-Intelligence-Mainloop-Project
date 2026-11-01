import type { EventLog } from "@throughline/engine";

/** Bumped whenever the snapshot layout changes, so old snapshots can be detected. */
export const SNAPSHOT_VERSION = 1;

/**
 * The dataset snapshot: the engine's dictionary-encoded log as gzipped JSON,
 * small enough for the browser to download and analyse without the database.
 */
export async function encodeSnapshot(log: EventLog): Promise<Blob> {
  const json = JSON.stringify({ version: SNAPSHOT_VERSION, log });
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).blob();
}

export async function decodeSnapshot(blob: Blob): Promise<EventLog> {
  const stream = blob.stream().pipeThrough(new DecompressionStream("gzip"));
  const parsed = JSON.parse(await new Response(stream).text()) as { version: number; log: EventLog };
  if (parsed.version !== SNAPSHOT_VERSION) throw new Error(`Unsupported snapshot version ${parsed.version}`);
  return parsed.log;
}
