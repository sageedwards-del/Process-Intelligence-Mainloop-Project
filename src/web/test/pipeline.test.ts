import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Action, Memo, Opportunity } from "@/lib/ai/outputs";
import type { Loaded, Target } from "@/lib/ai/target";

/**
 * The insights and memo pipelines with a scripted Claude: what fails the
 * grounding check is sent back once with the reasons, then dropped, and
 * never reaches the stored output.
 */

const replies: unknown[] = [];
const prompts: unknown[][] = [];
const saved: { kind: string; output: unknown }[] = [];

vi.mock("@/lib/ai/claude", () => ({
  MODELS: { insights: "test-model", ask: "test-model", memo: "test-model" },
  tally: (model: string) => ({ model, input: 0, output: 0 }),
  checkRateLimit: async () => {},
  recordUsage: async () => {},
  structured: async (opts: { messages: unknown[] }) => {
    prompts.push([...opts.messages]);
    return { value: replies.shift(), message: { content: [{ type: "text", text: "{}" }] } };
  },
}));
vi.mock("@/lib/ai/store", () => ({
  writeOutput: async (_: unknown, kind: string, row: { output: unknown }) => {
    saved.push({ kind, output: row.output });
    return "now";
  },
}));

const { analyseForAi } = await import("@/lib/ai/bundle");
const { meridianSample } = await import("@/lib/analysis/sample");
const { generateInsights } = await import("@/lib/ai/insights");
const { generateMemo } = await import("@/lib/ai/memo");

let target: Target;
let loaded: Loaded;
beforeAll(() => {
  const { log, inputs } = meridianSample();
  loaded = { log, inputs, analysed: analyseForAi(log, inputs) };
  target = { name: "Meridian", costNote: "test", load: async () => loaded } as unknown as Target;
});

const PARTNER = "edge:Match to Engagement → Partner Approval";
const act = (action: string, evidence: string): Action => ({
  action,
  evidence,
  impact: "Fewer missed discounts.",
  firstSteps: ["Ask the partners when they approve invoices."],
  verify: [],
  confidence: "medium",
});
const SUMMARY = "Most invoices follow the usual route, and partner approval is where they wait [[overview]].";

describe("insights pipeline", () => {
  test("regenerates failing actions once, then drops what still fails", async () => {
    replies.push(
      {
        summary: SUMMARY,
        actions: [
          act("Delegate partner approvals under a threshold", `The partner wait carries €13,520 in missed discounts [[${PARTNER}]].`),
          act("Block duplicates", "Duplicate payments cost €99,999 [[rule:no-duplicates]]."), // wrong figure
          act("Made up", "Lunch breaks cost €5k [[edge:Lunch → Nap]]."), // unknown metric
        ],
      },
      {
        summary: SUMMARY,
        actions: [
          act("Block duplicate payments at entry", "Duplicate payments cost €29,759 [[rule:no-duplicates]]."),
          act("Still made up", "A wait costs €1,234 [[rule:four-eyes]]."), // still wrong
        ],
      },
    );
    const out = await generateInsights(target);
    expect(out.summary).toBe(SUMMARY);
    expect(out.actions.map((a) => a.action)).toEqual(["Delegate partner approvals under a threshold", "Block duplicate payments at entry"]);
    expect(out.attempts).toBe(2);
    expect(out.dropped).toHaveLength(1);
    // The wrong figure is never in what's shown, only in the check's own record of what it rejected.
    expect(JSON.stringify(out.actions)).not.toContain("99,999");
    expect(out.rewritten.map((i) => i.message)).toContain(`"€99,999" doesn't match any figure of rule:no-duplicates`);
    // The retry told Claude exactly what failed.
    const retry = JSON.stringify(prompts.at(-1));
    expect(retry).toContain("€99,999");
    expect(retry).toContain("edge:Lunch → Nap");
    expect(Object.keys(out.metrics).sort()).toEqual(["overview", PARTNER, "rule:no-duplicates"].sort());
    expect(saved.at(-1)?.kind).toBe("insights");
  });

  test("a summary that fails twice is dropped; its actions are still shown", async () => {
    const bad = "There are 99,999 invoices [[overview]].";
    const actions = [
      act("Delegate partner approvals under a threshold", `The partner wait carries €13,520 in missed discounts [[${PARTNER}]].`),
      act("Block duplicate payments at entry", "Duplicate payments cost €29,759 [[rule:no-duplicates]]."),
      act("Separate registering from approving", "The four-eyes rule is broken [[rule:four-eyes]]."),
    ];
    replies.push({ summary: bad, actions }, { summary: bad, actions: [] });
    const out = await generateInsights(target);
    expect(out.summary).toBeNull();
    expect(out.actions).toHaveLength(3);
    expect(out.dropped.flatMap((d) => d.issues.map((i) => i.field))).toContain("summary");
    expect(JSON.stringify(out)).not.toContain("99,999 invoices");
  });
});

const opp = (over: Partial<Opportunity>): Opportunity => ({
  title: "Approve within the discount window",
  sizing: ["rule:early-payment-discount"],
  addressableShare: 0.5,
  shareRationale: "One partner holds most late approvals.",
  evidence: `The partner wait carries €13,520 of the losses [[${PARTNER}]].`,
  approach: "Delegate approvals under a threshold.",
  risks: "Delegation needs sign-off.",
  ...over,
});
const memo = (over: Partial<Memo>): Memo => ({
  recommendation: "go",
  headline: "Go: missed discounts are the largest avoidable cost.",
  currentState: "Cost to serve is €26 per invoice [[overview]].",
  opportunities: [opp({})],
  rationale: "The fix is cheap.",
  assumptions: ["The early-payment discount terms apply to all vendors."],
  ...over,
});

describe("memo pipeline", () => {
  test("sizes opportunities in code and drops one sized from an edge", async () => {
    replies.push(memo({ opportunities: [opp({}), opp({ title: "Speed up the partner", sizing: [PARTNER] })] }));
    const out = await generateMemo(target);
    expect(out.opportunities.map((o) => o.title)).toEqual(["Approve within the discount window"]);
    expect(out.dropped[0]!.issues[0]!.message).toContain("can't size an opportunity");
    const annual = loaded.analysed.bundle["rule:early-payment-discount"]!.figures.annualCost!.value;
    expect(out.total).toBeCloseTo(annual * 0.5, 6);
    expect(out.opportunities[0]!.formula).toContain("× 50% addressable");
  });

  test("regenerates a memo whose headline makes up a total, and refuses one that fails twice", async () => {
    replies.push(memo({ headline: "Go: €250k a year is at stake." }), memo({}));
    expect((await generateMemo(target)).headline).toBe("Go: missed discounts are the largest avoidable cost.");

    replies.push(memo({ headline: "Go: €250k a year." }), memo({ headline: "Go: €250k a year, really." }));
    await expect(generateMemo(target)).rejects.toThrow("didn't pass the grounding check");
  });
});
