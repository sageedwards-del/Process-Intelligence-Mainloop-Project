import { beforeAll, describe, expect, test, vi } from "vitest";
import type { Finding, Memo, Opportunity } from "@/lib/ai/outputs";
import type { Loaded, Target } from "@/lib/ai/target";

/**
 * The findings and memo pipelines with a scripted Claude: what fails the
 * grounding check is sent back once with the reasons, then dropped, and
 * never reaches the stored output.
 */

const replies: unknown[] = [];
const prompts: unknown[][] = [];
const saved: { kind: string; output: unknown }[] = [];

vi.mock("@/lib/ai/claude", () => ({
  MODELS: { findings: "test-model", ask: "test-model", memo: "test-model" },
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
const { generateFindings } = await import("@/lib/ai/findings");
const { generateMemo } = await import("@/lib/ai/memo");

let target: Target;
let loaded: Loaded;
beforeAll(() => {
  const { log, inputs } = meridianSample();
  loaded = { log, inputs, analysed: analyseForAi(log, inputs) };
  target = { name: "Meridian", costNote: "test", load: async () => loaded } as unknown as Target;
});

const PARTNER = "edge:Match to Engagement → Partner Approval";
const good = (title: string, body: string): Finding => ({ title, body, likelyCauses: "To check on site.", confidence: "medium", checkNext: [] });

describe("findings pipeline", () => {
  test("regenerates failing findings once, then drops what still fails", async () => {
    replies.push(
      {
        findings: [
          good("Partner approval is the costliest wait", `It costs €13,520 in missed discounts [[${PARTNER}]].`),
          good("Duplicates", "Duplicate payments cost €99,999 [[rule:no-duplicates]]."), // wrong figure
          good("Made up", "Lunch breaks cost €5k [[edge:Lunch → Nap]]."), // unknown metric
        ],
      },
      {
        findings: [
          good("Duplicate payments", "Duplicate payments cost €29,759 [[rule:no-duplicates]]."),
          good("Still made up", "A wait costs €1,234 [[rule:four-eyes]]."), // still wrong
        ],
      },
    );
    const out = await generateFindings(target);
    expect(out.findings.map((f) => f.title)).toEqual(["Partner approval is the costliest wait", "Duplicate payments"]);
    expect(out.attempts).toBe(2);
    expect(out.dropped).toHaveLength(1);
    // The wrong figure is never in what's shown, only in the check's own record of what it rejected.
    expect(JSON.stringify(out.findings)).not.toContain("99,999");
    expect(out.rewritten.map((i) => i.message)).toContain(`"€99,999" doesn't match any figure of rule:no-duplicates`);
    // The retry told Claude exactly what failed.
    const retry = JSON.stringify(prompts.at(-1));
    expect(retry).toContain("€99,999");
    expect(retry).toContain("edge:Lunch → Nap");
    expect(Object.keys(out.metrics).sort()).toEqual([PARTNER, "rule:no-duplicates"]);
    expect(saved.at(-1)?.kind).toBe("findings");
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
