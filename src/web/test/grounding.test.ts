import { beforeAll, describe, expect, test } from "vitest";
import { analyseForAi } from "@/lib/ai/bundle";
import { checkText, citedIds, indexMetrics, numbersIn, publicIssues, type MetricIndex } from "@/lib/ai/grounding";
import type { MetricBundle } from "@/lib/ai/metrics";
import { groundFinding, groundMemoText, groundOpportunity, sizeOpportunity, type Finding, type Opportunity } from "@/lib/ai/outputs";
import { meridianSample } from "@/lib/analysis/sample";

let bundle: MetricBundle;
let index: MetricIndex;

beforeAll(() => {
  const sample = meridianSample();
  bundle = analyseForAi(sample.log, sample.inputs).bundle;
  index = indexMetrics(bundle);
});

const PARTNER = "edge:Match to Engagement → Partner Approval";
const MOREAU = "resource:Partner Approval@P. Moreau";
const fig = (id: string, key: string) => bundle[id]!.figures[key]!.value;

describe("numbers in text", () => {
  test("reads currency, suffixes, percentages, ratios and rounding", () => {
    const [money, k, pct, ratio, rounded] = numbersIn("€13,520 and €13.5k, 11.6%, 4.8× and 233,000 hours");
    // 13,520 ends in a zero, so it may be rounded to the ten.
    expect(money).toMatchObject({ value: 13520, kind: "money", tolerance: 5 });
    expect(k).toMatchObject({ value: 13500, kind: "money", tolerance: 50 });
    expect(pct).toMatchObject({ value: 11.6, kind: "percent" });
    expect(ratio).toMatchObject({ value: 4.8, kind: "ratio" });
    // Trailing zeros are rounding: 233,000 stands for anything from 232,500 to 233,500.
    expect(rounded).toMatchObject({ value: 233000, kind: "plain", tolerance: 500 });
  });

  test("skips digits inside words such as P2P", () => {
    expect(numbersIn("a P2P process")).toEqual([]);
  });
});

describe("grounding check", () => {
  test("the Meridian figures pass when cited where they're used", () => {
    const text =
      `Invoices wait a median of ${fig(PARTNER, "medianWaitHours").toFixed(1)} hours for partner approval, ` +
      `and the excess costs €${Math.round(fig(PARTNER, "cost")).toLocaleString("en")} in missed discounts [[${PARTNER}]]. ` +
      `P. Moreau's queue is ${fig(MOREAU, "slowdown").toFixed(1)}× their peers' [[${MOREAU}]].`;
    expect(checkText(text, index, "body")).toEqual([]);
  });

  test("accepts rounding to the precision written, hours as days, shares as percentages", () => {
    const text =
      `The partner wait costs about €13.5k [[${PARTNER}]]. ` +
      `That's a median of ${(fig(PARTNER, "medianWaitHours") / 24).toFixed(1)} days [[${PARTNER}]]. ` +
      `Matching repeats in ${Math.round(fig("rework:Match to Engagement", "shareOfCases") * 100)}% of cases [[rework:Match to Engagement]].`;
    expect(checkText(text, index, "body")).toEqual([]);
  });

  test("accepts a figure cut off at its last digit, but not one pushed up", () => {
    const hours = fig(MOREAU, "medianWaitHours"); // 110.5
    expect(checkText(`Cases wait over ${Math.floor(hours)} hours [[${MOREAU}]].`, index, "x")).toEqual([]);
    expect(checkText(`Cases wait ${Math.floor(hours) + 2} hours [[${MOREAU}]].`, index, "x")).toHaveLength(1);
  });

  test("a citation right after the full stop still counts for that sentence", () => {
    expect(checkText(`Duplicates cost €29,759. [[rule:no-duplicates]]`, index, "body")).toEqual([]);
  });

  test("rejects a cited ID that isn't in the analysis", () => {
    const issues = checkText("Partner approval is slow [[edge:Partner Approval → Lunch]].", index, "body");
    expect(issues).toEqual([{ field: "body", message: "cites edge:Partner Approval → Lunch, which isn't in the analysis" }]);
  });

  test("rejects a figure that doesn't match its citation", () => {
    const issues = checkText(`The partner wait costs €21,000 [[${PARTNER}]].`, index, "body");
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain(`"€21,000" doesn't match any figure of ${PARTNER}`);
  });

  test("rejects a figure rounded more finely than it is right", () => {
    // €13,520 is right; €13,600 claims precision to the hundred and is off by 80.
    expect(checkText(`It costs €13,600 [[${PARTNER}]].`, index, "x")).toHaveLength(1);
  });

  test("rejects a figure cited to the wrong metric", () => {
    const issues = checkText(`Duplicates cost €13,520 [[rule:no-duplicates]].`, index, "body");
    expect(issues[0]!.message).toContain("doesn't match");
  });

  test("rejects a figure with no citation in its sentence or paragraph", () => {
    const issues = checkText(`The partner wait costs €13,520.\nIt is the costliest wait [[${PARTNER}]].`, index, "body");
    expect(issues).toMatchObject([{ field: "body", message: `"€13,520" has no citation in its sentence or paragraph` }]);
    // The sentence goes back to Claude with the rewrite request, but not to the page.
    expect(issues[0]!.sentence).toBe("The partner wait costs €13,520.");
    expect(publicIssues(issues)[0]).not.toHaveProperty("sentence");
  });

  test("a sentence without its own citation may use its paragraph's, but only for matching figures", () => {
    expect(checkText(`The partner wait costs €13,520. It is the costliest wait [[${PARTNER}]].`, index, "x")).toEqual([]);
    expect(checkText(`The partner wait costs €15,000. It is the costliest wait [[${PARTNER}]].`, index, "x")).toHaveLength(1);
    // A sentence that cites something is held to its own citations, not its neighbours'.
    expect(checkText(`Duplicates cost €13,520 [[rule:no-duplicates]]. The partner wait is costly [[${PARTNER}]].`, index, "x")).toHaveLength(1);
  });

  test("rejects arithmetic the model did itself, like adding two costs", () => {
    const sum = Math.round(fig(PARTNER, "cost") + fig(MOREAU, "cost"));
    const issues = checkText(`Together they cost €${sum.toLocaleString("en")} [[${PARTNER}]] [[${MOREAU}]].`, index, "body");
    expect(issues).toHaveLength(1);
  });

  test("rejects a percentage matched against a count", () => {
    expect(checkText(`Rework hits 739% of cases [[rework:Match to Engagement]].`, index, "x")).toHaveLength(1);
  });

  test("lets small counts, years and digits in names through", () => {
    const text = `In 2026, 3 steps stand out; the rule "Pay 2/10 invoices within 10 days" is broken often [[rule:early-payment-discount]].`;
    expect(checkText(text, index, "body")).toEqual([]);
  });

  test("dates and clock times need no citation", () => {
    expect(checkText("Case 4711 started on 2026-03-14 at 09:30 and was paid on 2 April.", index, "x")).toMatchObject([
      { field: "x", message: `"4711" has no citation in its sentence or paragraph` },
    ]);
  });

  test("an initial like P. Moreau doesn't end the sentence", () => {
    const text = `Cases approved by P. Moreau are ${fig("segment:partner=P. Moreau", "lift").toFixed(1)}× as likely to be slow [[segment:partner=P. Moreau]].`;
    expect(checkText(text, index, "body")).toEqual([]);
  });

  test("Ask's filter-scoped IDs: a figure must come from the scope it cites", () => {
    const scopedEdge = { ...bundle[PARTNER]!, id: `${PARTNER} | amount ≥ 10000`, figures: { medianWaitHours: { value: 22.3, unit: "hours" as const }, filter1Min: { value: 10000, unit: "number" as const } } };
    const scoped = indexMetrics(bundle, { [scopedEdge.id]: scopedEdge });
    expect(checkText(`Invoices of 10,000 or more wait 22.3 hours [[${PARTNER} | amount ≥ 10000]].`, scoped, "x")).toEqual([]);
    // 22.9 h is the unfiltered figure: right number, wrong scope.
    expect(checkText(`Invoices of 10,000 or more wait 22.9 hours [[${PARTNER} | amount ≥ 10000]].`, scoped, "x")).toHaveLength(1);
  });

  test("tolerates -> for → in an edge ID", () => {
    expect(citedIds("[[edge:Match to Engagement->Partner Approval]]")).toEqual([PARTNER]);
  });
});

const finding = (over: Partial<Finding> = {}): Finding => ({
  title: "Partner approval is the costliest wait",
  body: `It costs €13,520 in missed discounts [[${PARTNER}]].`,
  likelyCauses: "Partners approve in batches between client work; to be checked.",
  confidence: "high",
  checkNext: ["Ask the partners when they approve invoices."],
  ...over,
});

describe("findings", () => {
  test("a grounded finding passes", () => {
    expect(groundFinding(finding(), index)).toEqual([]);
  });

  test("a finding without a citation fails", () => {
    expect(groundFinding(finding({ body: "Partner approval is slow." }), index)).toEqual([{ field: "body", message: "cites no metric" }]);
  });

  test("a wrong figure anywhere in the finding fails it, including the title", () => {
    expect(groundFinding(finding({ title: "A €50k problem" }), index)[0]!.field).toBe("title");
    expect(groundFinding(finding({ checkNext: ["Confirm the 40% discount rate."] }), index)[0]!.field).toBe("checkNext[0]");
  });
});

const opportunity = (over: Partial<Opportunity> = {}): Opportunity => ({
  title: "Approve within the discount window",
  sizing: ["rule:early-payment-discount"],
  addressableShare: 0.6,
  shareRationale: "Most late approvals sit with one partner.",
  evidence: `The partner wait carries €13,520 of the losses [[${PARTNER}]].`,
  approach: "Delegate approval under a threshold.",
  risks: "Partners may resist delegation.",
  ...over,
});

describe("memo sizing", () => {
  test("sizes from the rule's annual cost × the addressable share", () => {
    const sized = sizeOpportunity(opportunity(), bundle, (n) => `€${Math.round(n)}`);
    expect(sized.annualSaving).toBeCloseTo(fig("rule:early-payment-discount", "annualCost") * 0.6, 6);
    expect(sized.formula).toMatch(/a year \(rule:early-payment-discount\) × 60% addressable$/);
  });

  test("a grounded opportunity passes", () => {
    expect(groundOpportunity(opportunity(), index, new Set())).toEqual([]);
  });

  test("refuses to size from an edge or a resource (ADR 0002)", () => {
    const issues = groundOpportunity(opportunity({ sizing: [PARTNER] }), index, new Set());
    expect(issues[0]!.message).toContain("can't size an opportunity");
  });

  test("refuses double counting: one metric twice, or rework inside labour", () => {
    const used = new Set<string>();
    expect(groundOpportunity(opportunity({ sizing: ["labour:Match to Engagement"] }), index, used)).toEqual([]);
    expect(groundOpportunity(opportunity({ sizing: ["rework:Match to Engagement"] }), index, used)[0]!.message).toContain("overlaps");
    expect(groundOpportunity(opportunity({ sizing: ["labour:Match to Engagement"] }), index, used)[0]!.message).toContain("already sizes");
  });

  test("refuses a share outside (0, 1] and an unknown metric", () => {
    expect(groundOpportunity(opportunity({ addressableShare: 1.5 }), index, new Set())[0]!.field).toBe("addressableShare");
    expect(groundOpportunity(opportunity({ sizing: ["rule:made-up"] }), index, new Set())[0]!.message).toContain("isn't in the analysis");
  });

  test("memo text with a made-up total fails", () => {
    const memo = {
      recommendation: "go" as const,
      headline: "Go: about €250k a year is at stake.",
      currentState: `Cost to serve is €26 per invoice [[overview]].`,
      opportunities: [],
      rationale: "Two fixes are cheap.",
      assumptions: [],
    };
    expect(groundMemoText(memo, index)).toMatchObject([{ field: "headline", message: `"€250k" has no citation in its sentence or paragraph` }]);
  });
});
