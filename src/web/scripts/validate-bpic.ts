/**
 * Runs converted BPI Challenge logs through the same pipeline as the upload
 * page (Papa Parse → guessMapping → ingestTable) and the explorer's engine
 * calls, timing each stage. Results feed docs/validation.md.
 *
 *   npm run bpic:download -w @throughline/miner   (or uv run python scripts/bpic.py all in src/miner)
 *   npx tsx scripts/validate-bpic.ts [log-name ...]   (from src/web)
 *
 * Prints a readable report and writes JSON to data/external/bpic/results/ (gitignored).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_COST_MODEL,
  analyzeBottlenecks,
  analyzeRootCauses,
  buildLog,
  computeVariants,
  evaluateRules,
  guessMapping,
  ingestTable,
  slowCasesFilter,
  summarize,
  type ColumnMapping,
  type EventLog,
  type Rule,
} from "@throughline/engine";
import Papa from "papaparse";

const DIR = resolve(import.meta.dirname, "../../../data/external/bpic");
const DAY = 86_400_000;
const HOUR = 3_600_000;

interface LogConfig {
  file: string;
  /** Column to use as the resource instead of the guess (BPIC 2020 anonymises people; roles remain). */
  resource?: string;
  /** Override the guessed case id column. */
  caseId?: string;
  rules: Rule[];
  /** Activities whose repeats count as resubmissions / rework of interest. */
  focus?: string[];
}

const SUBMIT = "Declaration SUBMITTED by EMPLOYEE";
const FINAL = "Declaration FINAL_APPROVED by SUPERVISOR";
const PAID = "Payment Handled";

const LOGS: Record<string, LogConfig> = {
  "bpic2020-domestic": {
    file: "bpic2020-domestic.csv",
    resource: "org:role",
    focus: [SUBMIT],
    rules: [
      { id: "approved-before-payment", name: "Final approval before payment", type: "precedence", before: FINAL, after: PAID },
      { id: "no-duplicate-declarations", name: "No declaration number used twice", type: "duplicate", keys: ["DeclarationNumber"] },
    ],
  },
  "bpic2020-request-for-payment": {
    file: "bpic2020-request-for-payment.csv",
    resource: "org:role",
    focus: ["Request For Payment SUBMITTED by EMPLOYEE"],
    rules: [
      {
        id: "approved-before-payment",
        name: "Final approval before payment",
        type: "precedence",
        before: ["SUPERVISOR", "DIRECTOR", "BUDGET OWNER"].map((r) => `Request For Payment FINAL_APPROVED by ${r}`),
        after: PAID,
      },
      { id: "no-duplicate-rfp", name: "No request number used twice", type: "duplicate", keys: ["RfpNumber"] },
    ],
  },
  "bpic2020-prepaid-travel-cost": {
    file: "bpic2020-prepaid-travel-cost.csv",
    resource: "org:role",
    rules: [],
  },
  "bpic2020-permit": {
    file: "bpic2020-permit.csv",
    resource: "org:role",
    focus: ["Permit SUBMITTED by EMPLOYEE", "Declaration SUBMITTED by EMPLOYEE"],
    rules: [
      { id: "permit-submitted-before-trip", name: "Permit submitted before the trip starts", type: "precedence", before: "Permit SUBMITTED by EMPLOYEE", after: "Start trip" },
      {
        id: "permit-approved-before-trip",
        name: "Permit finally approved before the trip starts",
        type: "precedence",
        before: ["Permit FINAL_APPROVED by SUPERVISOR", "Permit FINAL_APPROVED by DIRECTOR"],
        after: "Start trip",
      },
    ],
  },
  // The whole 2019 log is 441 MB as CSV, over the upload limit; this is one item category, extracted the way a
  // user would filter their export (see docs/validation.md).
  "bpic2019-3way-after": {
    file: "bpic2019-3way-after.csv",
    focus: ["Change Price", "Record Invoice Receipt"],
    rules: [
      { id: "gr-before-clear", name: "Goods receipt before the invoice is cleared", type: "precedence", before: "Record Goods Receipt", after: "Clear Invoice" },
      { id: "invoice-before-clear", name: "Invoice receipt before the invoice is cleared", type: "precedence", before: "Record Invoice Receipt", after: "Clear Invoice" },
    ],
  },
};

type Timings = Record<string, number>;

function time<T>(t: Timings, label: string, f: () => T): T {
  const start = performance.now();
  const out = f();
  t[label] = Math.round(performance.now() - start);
  return out;
}

function run(name: string, cfg: LogConfig) {
  const t: Timings = {};
  const text = time(t, "read file", () => readFileSync(resolve(DIR, cfg.file), "utf8"));
  const parsed = time(t, "parse CSV", () => Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }));
  const [headers, ...rows] = parsed.data;
  const table = { headers: headers!.map((h) => h.trim()), rows };
  const guessed = time(t, "guess mapping", () => guessMapping(table));
  const mapping: ColumnMapping = {
    ...guessed,
    ...(cfg.caseId && { caseId: cfg.caseId }),
    ...(cfg.resource && { resource: cfg.resource, attributes: guessed.attributes.filter((a) => a !== cfg.resource) }),
  };
  const ingested = time(t, "ingest + quality report", () => ingestTable(table, mapping));
  const log: EventLog = time(t, "build log", () => buildLog(ingested.events));

  const summary = time(t, "summary", () => summarize(log));
  const variants = time(t, "variants", () => computeVariants(log));
  const bottlenecks = time(t, "bottlenecks", () => analyzeBottlenecks(log, DEFAULT_COST_MODEL, { rules: cfg.rules }));
  const rules = time(t, "rules", () => evaluateRules(log, cfg.rules, DEFAULT_COST_MODEL));
  const slow = slowCasesFilter(log, 0.9);
  // Same options as the explorer: who did the main steps, and whether a case passes through optional ones.
  const share = (a: string) => log.cases.filter((c) => c.events.some((e) => log.activities[e.a] === a)).length / log.cases.length;
  const roots = time(t, "root causes (slowest 10%)", () =>
    analyzeRootCauses(log, [slow], {
      resourceActivities: variants[0]?.activities.slice(0, 6),
      passesThrough: log.activities.filter((a) => share(a) >= 0.05 && share(a) <= 0.95),
    }),
  );

  const caseCount = log.cases.length;
  const activityCount = (a: string) => log.cases.reduce((n, c) => n + c.events.filter((e) => log.activities[e.a] === a).length, 0);
  const casesWith = (a: string) => log.cases.filter((c) => c.events.some((e) => log.activities[e.a] === a)).length;
  const focus = (cfg.focus ?? []).map((a) => {
    const total = activityCount(a);
    const cases = casesWith(a);
    const repeatCases = log.cases.filter((c) => c.events.filter((e) => log.activities[e.a] === a).length > 1).length;
    return { activity: a, executions: total, cases, repeats: total - cases, repeatCases };
  });

  const result = {
    name,
    file: cfg.file,
    mapping: { guessed: { caseId: guessed.caseId, activity: guessed.activity, timestamp: guessed.timestamp, resource: guessed.resource, timestampFormat: guessed.timestampFormat }, used: { caseId: mapping.caseId, resource: mapping.resource } },
    quality: { ...ingested.report, issues: ingested.report.issues.map((i) => ({ id: i.id, severity: i.severity, title: i.title, count: i.count })) },
    summary: {
      cases: caseCount,
      events: summary.eventCount,
      activities: summary.activityCount,
      variants: variants.length,
      topVariantShare: variants[0]?.share ?? 0,
      top5VariantShare: variants.slice(0, 5).reduce((s, v) => s + v.share, 0),
      medianDays: summary.throughput.median / DAY,
      meanDays: summary.throughput.mean / DAY,
      paidShare: casesWith(PAID) / caseCount,
    },
    topVariants: variants.slice(0, 3).map((v) => ({ share: v.share, count: v.count, steps: v.activities.length, medianDays: v.throughput.median / DAY, path: v.key })),
    edgesByExcess: [...bottlenecks.edges].sort((x, y) => y.excessWaitHours - x.excessWaitHours).slice(0, 5).map((e) => ({ id: e.id, frequency: e.frequency, medianHours: e.wait.median / HOUR, totalWaitDays: e.totalWaitHours / 24, excessDays: e.excessWaitHours / 24 })),
    edgesByTotalWait: [...bottlenecks.edges].sort((x, y) => y.totalWaitHours - x.totalWaitHours).slice(0, 5).map((e) => ({ id: e.id, frequency: e.frequency, medianHours: e.wait.median / HOUR, totalWaitYears: e.totalWaitHours / 24 / 365 })),
    resources: bottlenecks.resources.slice(0, 5).map((r) => ({ id: r.id, slowdown: r.slowdown, executions: r.executions, medianHours: r.medianWaitHours, peerHours: r.activityMedianWaitHours })),
    rework: bottlenecks.rework.slice(0, 5).map((r) => ({ id: r.id, repeats: r.repeatExecutions, casesAffected: r.casesAffected, share: r.shareOfCases })),
    focus,
    rules: rules.map((r) => ({ id: r.id, checked: r.casesChecked, violations: r.violations.length, rate: r.violationRate, examples: r.violations.slice(0, 3).map((v) => `${v.caseId}: ${v.detail}`) })),
    rootCauses: { outcome: `slowest 10% (≥ ${((slow.kind === "throughput" ? (slow.minMs ?? 0) : 0) / DAY).toFixed(1)} days)`, factors: roots.factors.filter((f) => f.significant).slice(0, 6).map((f) => ({ id: f.id, cases: f.cases, rate: f.rate, restRate: f.restRate, lift: f.lift })) },
    costToServe: { perCase: bottlenecks.costToServe.perCase, note: "DEFAULT_COST_MODEL: 10 min per step at €55/h, an assumption" },
    timingsMs: t,
  };

  mkdirSync(resolve(DIR, "results"), { recursive: true });
  writeFileSync(resolve(DIR, "results", `${name}.json`), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
}

const names = process.argv.slice(2);
for (const name of names.length ? names : Object.keys(LOGS)) {
  const cfg = LOGS[name];
  if (!cfg) throw new Error(`Unknown log "${name}". Known: ${Object.keys(LOGS).join(", ")}`);
  run(name, cfg);
}
