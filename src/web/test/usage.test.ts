import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Loaded, Target } from "@/lib/ai/target";

/**
 * AI cost control: each request reserves its ai_usage row before calling
 * Claude, the per-user and site-wide limits are decided by the database's
 * reserve_ai_request under one lock, and the row gets its token counts at the
 * end, even when the call fails. The Supabase client is a fake that keeps rows
 * in memory and serialises reservations the way the advisory lock does
 * (supabase/migrations/20261105000000_ai_usage_reservations.sql; the SQL
 * itself is covered by supabase/tests/ai.test.sql).
 */

interface Row {
  id: number;
  user_id: string;
  status: "reserved" | "done" | "refused";
  input_tokens: number;
  output_tokens: number;
}

interface ReserveArgs {
  p_workspace_id: string;
  p_feature: string;
  p_model: string;
  p_hourly_limit: number;
  p_daily_limit: number;
}

function fakeDb() {
  const rows: Row[] = [];
  const calls: { name: string; args: unknown }[] = [];
  let lock = Promise.resolve();
  let failReserve = false;

  async function reserve(user: string, args: ReserveArgs) {
    const counted = rows.filter((r) => r.status !== "refused");
    const hourly = counted.filter((r) => r.user_id === user).length;
    const hit = hourly >= args.p_hourly_limit ? "hourly" : counted.length >= args.p_daily_limit ? "daily" : null;
    // A real round trip between the count and the insert, inside the lock.
    await new Promise((r) => setTimeout(r, 5));
    const row: Row = { id: rows.length + 1, user_id: user, status: hit ? "refused" : "reserved", input_tokens: 0, output_tokens: 0 };
    rows.push(row);
    return { id: row.id, status: row.status, limit_hit: hit };
  }

  function client(user: string) {
    return {
      rpc(name: string, args: Record<string, unknown>) {
        calls.push({ name, args });
        const run = async (): Promise<{ data: unknown; error: unknown }> => {
          if (name === "reserve_ai_request") {
            if (failReserve) return { data: null, error: { message: "function does not exist" } };
            const turn = lock.then(() => reserve(user, args as unknown as ReserveArgs));
            lock = turn.then(() => undefined);
            return { data: await turn, error: null };
          }
          if (name === "finish_ai_request") {
            const row = rows.find((r) => r.id === args.p_id && r.user_id === user && r.status === "reserved");
            if (row) Object.assign(row, { status: "done", input_tokens: args.p_input_tokens, output_tokens: args.p_output_tokens });
            return { data: null, error: null };
          }
          return { data: null, error: { message: `unknown function ${name}` } };
        };
        const p = run();
        return Object.assign(p, { single: () => p });
      },
    };
  }

  return {
    rows,
    calls,
    client,
    seed(user: string, n: number) {
      for (let i = 0; i < n; i++) rows.push({ id: rows.length + 1, user_id: user, status: "done", input_tokens: 1, output_tokens: 1 });
    },
    failReserves() {
      failReserve = true;
    },
  };
}

const replies: unknown[] = [];
let failNextCall = false;
let modelCalls = 0;

vi.mock("@/lib/ai/claude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/claude")>();
  return {
    ...actual,
    structured: async (opts: { usage: { input: number; output: number } }) => {
      modelCalls++;
      opts.usage.input += 1200;
      opts.usage.output += 340;
      if (failNextCall) {
        failNextCall = false;
        throw new Error("connection reset");
      }
      return { value: replies.shift(), message: { content: [{ type: "text", text: "{}" }] } };
    },
  };
});
vi.mock("@/lib/ai/store", () => ({ writeOutput: async () => "now" }));

const { reserve, recordUsage, dailyLimit } = await import("@/lib/ai/claude");
const { analyseForAi } = await import("@/lib/ai/bundle");
const { meridianSample } = await import("@/lib/analysis/sample");
const { generateInsights } = await import("@/lib/ai/insights");

let loaded: Loaded;
beforeAll(() => {
  const { log, inputs } = meridianSample();
  loaded = { log, inputs, analysed: analyseForAi(log, inputs) };
});

let db: ReturnType<typeof fakeDb>;
const targetFor = (user: string) =>
  ({ supabase: db.client(user), userId: user, workspaceId: `ws-${user}`, datasetId: null, name: "Meridian", costNote: "test", load: async () => loaded }) as unknown as Target;

beforeEach(() => {
  db = fakeDb();
  replies.length = 0;
  modelCalls = 0;
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("AI_DAILY_LIMIT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("reserving a request", () => {
  test("two requests racing at the hourly limit: exactly one passes", async () => {
    db.seed("alice", 29);
    const results = await Promise.allSettled([reserve(targetFor("alice"), "ask"), reserve(targetFor("alice"), "memo")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ status: 429 });
    expect(refused.reason.message).toContain("30 AI requests in the last hour");
    expect(db.rows.filter((r) => r.user_id === "alice" && r.status !== "refused")).toHaveLength(30);
  });

  test("many parallel requests from a fresh user never get past the limit", async () => {
    const results = await Promise.allSettled(Array.from({ length: 40 }, () => reserve(targetFor("mallory"), "ask")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(30);
    expect(db.rows.filter((r) => r.status === "refused")).toHaveLength(10);
  });

  test("the site-wide daily cap refuses everyone once it's reached, with its own message", async () => {
    vi.stubEnv("AI_DAILY_LIMIT", "5");
    db.seed("alice", 3);
    db.seed("bob", 2);
    await expect(reserve(targetFor("carol"), "insights")).rejects.toMatchObject({
      status: 429,
      message: "The demo's AI budget for today is used up; try again tomorrow.",
    });
    expect(db.calls[0].args).toMatchObject({ p_daily_limit: 5, p_hourly_limit: 30, p_feature: "insights", p_workspace_id: "ws-carol" });
  });

  test("AI_DAILY_LIMIT defaults to 300 and ignores values that aren't positive whole numbers", () => {
    expect(dailyLimit()).toBe(300);
    for (const bad of ["abc", "0", "-4", "2.5"]) {
      vi.stubEnv("AI_DAILY_LIMIT", bad);
      expect(dailyLimit()).toBe(300);
    }
    vi.stubEnv("AI_DAILY_LIMIT", "1000");
    expect(dailyLimit()).toBe(1000);
  });

  test("fails closed when usage can't be counted", async () => {
    db.failReserves();
    await expect(reserve(targetFor("alice"), "ask")).rejects.toMatchObject({ status: 503 });
  });

  test("refuses before touching the database when Claude isn't set up", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    await expect(reserve(targetFor("alice"), "ask")).rejects.toMatchObject({ status: 503 });
    expect(db.calls).toHaveLength(0);
  });

  test("recordUsage fills in the reserved row's tokens", async () => {
    const id = await reserve(targetFor("alice"), "ask");
    await recordUsage(targetFor("alice"), id, { model: "m", input: 10, output: 20 });
    expect(db.rows.find((r) => r.id === id)).toMatchObject({ status: "done", input_tokens: 10, output_tokens: 20 });
  });
});

describe("a pipeline's usage row", () => {
  const act = (action: string) => ({
    action,
    evidence: "The partner wait carries €13,520 in missed discounts [[edge:Match to Engagement → Partner Approval]].",
    impact: "Fewer missed discounts.",
    firstSteps: ["Ask the partners when they approve invoices."],
    verify: [],
    confidence: "medium",
  });
  const reply = { summary: "Partner approval is where invoices wait [[overview]].", actions: [act("First"), act("Second"), act("Third")] };

  test("is reserved before Claude is called and updated with the tokens after", async () => {
    replies.push(reply);
    await generateInsights(targetFor("alice"));
    expect(db.calls.map((c) => c.name)).toEqual(["reserve_ai_request", "finish_ai_request"]);
    expect(db.rows).toEqual([{ id: 1, user_id: "alice", status: "done", input_tokens: 1200, output_tokens: 340 }]);
  });

  test("is still updated when the call fails", async () => {
    failNextCall = true;
    await expect(generateInsights(targetFor("alice"))).rejects.toThrow("connection reset");
    expect(db.rows).toEqual([{ id: 1, user_id: "alice", status: "done", input_tokens: 1200, output_tokens: 340 }]);
  });

  test("a refused request never reaches Claude", async () => {
    db.seed("alice", 30);
    await expect(generateInsights(targetFor("alice"))).rejects.toMatchObject({ status: 429 });
    expect(modelCalls).toBe(0);
    expect(db.calls.map((c) => c.name)).toEqual(["reserve_ai_request"]);
  });
});
