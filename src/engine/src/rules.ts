import type { CostModel, RuleImpact } from "./bottlenecks.ts";
import { HOUR_MS } from "./stats.ts";
import { NO_RESOURCE, type AttrValue, type Case, type EventLog } from "./types.ts";

export type ConditionOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in";

/** A condition on a case attribute, e.g. `{ attribute: "amount", op: "gt", value: 10000 }`. */
export interface Condition {
  attribute: string;
  op: ConditionOp;
  value: AttrValue | AttrValue[];
}

interface RuleBase {
  id: string;
  name: string;
  description?: string;
  /** Only cases matching every condition are checked. */
  where?: Condition[];
}

/**
 * Business rules a finance or ops team recognises. Activities are referenced
 * by name.
 *
 * - precedence:  `after` must never happen before `before` (e.g. pay only after approval);
 *                with a list, any one of them counts (approval by a supervisor or a director)
 * - segregation: the same person must not perform both activities (four-eyes)
 * - requires:    matching cases must contain the activity (e.g. amount > 10k needs director approval)
 * - sla:         `from` → `to` must take at most `maxHours`
 * - duplicate:   no two cases may share the same values for `keys`
 */
export type Rule = RuleBase &
  (
    | { type: "precedence"; before: string | readonly string[]; after: string }
    | { type: "segregation"; activities: [string, string] }
    | { type: "requires"; activity: string }
    | { type: "sla"; from: string; to: string; maxHours: number }
    | { type: "duplicate"; keys: string[] }
  );

export interface Violation {
  caseId: string;
  detail: string;
  /** Money at stake for this violation, from `CostModel.ruleImpacts`. 0 if the rule has no impact. */
  cost: number;
}

export interface RuleResult {
  id: string;
  name: string;
  type: Rule["type"];
  /** Cases the rule applied to (after `where`). */
  casesChecked: number;
  violations: Violation[];
  /** violations / casesChecked, 0..1. */
  violationRate: number;
  /** Σ violation costs. */
  cost: number;
  /** The impact assumption behind `cost`, so the UI can show the formula. */
  impact: RuleImpact | null;
}

export function evaluateRules(log: EventLog, rules: readonly Rule[], cost?: CostModel): RuleResult[] {
  return rules.map((rule) => evaluateRule(log, rule, cost));
}

export function evaluateRule(log: EventLog, rule: Rule, cost?: CostModel): RuleResult {
  const cases = log.cases.filter((c) => matchesAll(c, rule.where));
  const found = rule.type === "duplicate" ? duplicateViolations(cases, rule.keys) : perCase(log, rule, cases);
  const impact = cost?.ruleImpacts?.[rule.id] ?? null;
  const byId = new Map(cases.map((c) => [c.id, c]));
  const violations = found.map((v) => ({ ...v, cost: impact ? violationCost(impact, byId.get(v.caseId)!) : 0 }));
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type,
    casesChecked: cases.length,
    violations,
    violationRate: cases.length ? violations.length / cases.length : 0,
    cost: violations.reduce((sum, v) => sum + v.cost, 0),
    impact,
  };
}

/** Expected loss: fixed cost plus the share of the amount that isn't recovered. */
function violationCost(impact: RuleImpact, c: Case): number {
  let total = impact.perViolation ?? 0;
  if (impact.share) {
    const v = c.attrs[impact.share.attribute];
    if (typeof v === "number") total += v * impact.share.fraction * (1 - (impact.recoveryRate ?? 0));
  }
  return total;
}

type Found = Omit<Violation, "cost">;

function perCase(log: EventLog, rule: Rule, cases: Case[]): Found[] {
  const id = (name: string) => log.activities.indexOf(name);
  const out: Found[] = [];

  for (const c of cases) {
    const firstIndex = (a: number, from = 0) => {
      for (let i = from; i < c.events.length; i++) if (c.events[i]!.a === a) return i;
      return -1;
    };
    switch (rule.type) {
      case "precedence": {
        const iAfter = firstIndex(id(rule.after));
        if (iAfter < 0) break;
        const before = typeof rule.before === "string" ? [rule.before] : rule.before;
        const iBefore = Math.min(...before.map((b) => firstIndex(id(b))).filter((i) => i >= 0));
        if (!(iBefore < iAfter)) {
          const names = before.map((b) => `"${b}"`).join(" or ");
          out.push({ caseId: c.id, detail: `"${rule.after}" happened without ${names} before it` });
        }
        break;
      }
      case "segregation": {
        const [a, b] = rule.activities.map(id) as [number, number];
        const doersA = new Set(c.events.filter((e) => e.a === a && e.r !== NO_RESOURCE).map((e) => e.r));
        const shared = c.events.find((e) => e.a === b && doersA.has(e.r));
        if (shared) {
          out.push({
            caseId: c.id,
            detail: `${log.resources[shared.r]} performed both "${rule.activities[0]}" and "${rule.activities[1]}"`,
          });
        }
        break;
      }
      case "requires": {
        if (firstIndex(id(rule.activity)) < 0) out.push({ caseId: c.id, detail: `missing "${rule.activity}"` });
        break;
      }
      case "sla": {
        const iFrom = firstIndex(id(rule.from));
        if (iFrom < 0) break;
        const iTo = firstIndex(id(rule.to), iFrom + 1);
        if (iTo < 0) break; // still open: not a violation yet
        const hours = (c.events[iTo]!.t - c.events[iFrom]!.t) / HOUR_MS;
        if (hours > rule.maxHours) {
          out.push({
            caseId: c.id,
            detail: `"${rule.from}" → "${rule.to}" took ${hours.toFixed(1)} h (limit ${rule.maxHours} h)`,
          });
        }
        break;
      }
    }
  }
  return out;
}

function duplicateViolations(cases: Case[], keys: string[]): Found[] {
  const groups = new Map<string, Case[]>();
  for (const c of cases) {
    const values = keys.map((k) => c.attrs[k]);
    if (values.some((v) => v === undefined || v === null || v === "")) continue;
    const k = JSON.stringify(values);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(c);
  }
  const out: Found[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((x, y) => (x.events[0]?.t ?? 0) - (y.events[0]?.t ?? 0));
    const original = g[0]!;
    for (const dup of g.slice(1)) {
      out.push({ caseId: dup.id, detail: `same ${keys.join(" + ")} as case ${original.id}` });
    }
  }
  return out;
}

function matchesAll(c: Case, conditions: Condition[] | undefined): boolean {
  return !conditions || conditions.every((cond) => matches(c.attrs[cond.attribute], cond));
}

function matches(v: AttrValue | undefined, cond: Condition): boolean {
  if (v === undefined) return false;
  const target = cond.value;
  switch (cond.op) {
    case "eq":
      return v === target;
    case "neq":
      return v !== target;
    case "in":
      return Array.isArray(target) && target.includes(v);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof v !== "number" || typeof target !== "number") return false;
      if (cond.op === "gt") return v > target;
      if (cond.op === "gte") return v >= target;
      if (cond.op === "lt") return v < target;
      return v <= target;
    }
  }
}
