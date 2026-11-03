import "server-only";

/**
 * Calls the miner (src/miner) from server code with the user's access token. Throws
 * MinerError with a message fit for the page; the miner's own details stay in its logs.
 */

export class MinerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 240_000;

export async function callMiner<T>(path: string, body: unknown, accessToken: string): Promise<T> {
  const base = process.env.MINER_URL;
  if (!base) throw new MinerError(503, "The mining service isn't set up here (MINER_URL), so the BPMN model and conformance aren't available.");
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new MinerError(504, "The mining service took too long on this log.");
    throw new MinerError(503, "The mining service isn't reachable right now. Try again in a minute: it may be starting up.");
  }
  if (res.ok) return (await res.json()) as T;
  const detail = ((await res.json().catch(() => ({}))) as { detail?: unknown }).detail;
  if (res.status === 413) throw new MinerError(413, "This log is over the mining service's size limit.");
  if (res.status === 422 && typeof detail === "string") throw new MinerError(422, `The mining service couldn't use this log: ${detail}`);
  if (res.status === 401) throw new MinerError(502, "The mining service didn't accept your session. Sign in again.");
  throw new MinerError(502, `The mining service failed (${res.status}).`);
}
