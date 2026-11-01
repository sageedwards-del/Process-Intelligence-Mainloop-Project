import { DEFAULT_COST_MODEL, type CostModel, type RuleImpact } from "./bottlenecks.ts";
import type { Rule } from "./rules.ts";

/**
 * The cost assumptions a person edits in the app: the few inputs every
 * currency figure is derived from. Stored as JSON, so it is parsed, never trusted.
 */
export interface CostSettings {
  currency: string;
  hourlyRate: number;
  delayCostPerCaseDay: number;
  defaultHandlingMinutes: number;
  capitalCost?: { attribute: string; annualRate: number };
}

export const CURRENCIES = ["EUR", "USD", "GBP", "CHF"] as const;

export const DEFAULT_COST_SETTINGS: CostSettings = {
  currency: DEFAULT_COST_MODEL.currency,
  hourlyRate: DEFAULT_COST_MODEL.hourlyRate,
  delayCostPerCaseDay: DEFAULT_COST_MODEL.delayCostPerCaseDay,
  defaultHandlingMinutes: DEFAULT_COST_MODEL.defaultHandlingMinutes,
};

export type ParsedSettings = { ok: true; settings: CostSettings } | { ok: false; errors: string[] };

/** Validate settings from a form or a database row. Missing fields fall back to the defaults. */
export function parseCostSettings(input: unknown): ParsedSettings {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const errors: string[] = [];
  const num = (key: string, label: string, fallback: number, max: number): number => {
    const raw = src[key];
    if (raw === undefined || raw === null || raw === "") return fallback;
    const v = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(v) || v < 0 || v > max) {
      errors.push(`${label} must be a number between 0 and ${max.toLocaleString("en")}.`);
      return fallback;
    }
    return v;
  };

  const currency = typeof src.currency === "string" && src.currency !== "" ? src.currency : DEFAULT_COST_MODEL.currency;
  if (!(CURRENCIES as readonly string[]).includes(currency)) errors.push(`Currency must be one of ${CURRENCIES.join(", ")}.`);

  const settings: CostSettings = {
    currency,
    hourlyRate: num("hourlyRate", "Hourly rate", DEFAULT_COST_MODEL.hourlyRate, 10_000),
    delayCostPerCaseDay: num("delayCostPerCaseDay", "Delay cost per case-day", DEFAULT_COST_MODEL.delayCostPerCaseDay, 1_000_000),
    defaultHandlingMinutes: num("defaultHandlingMinutes", "Handling minutes", DEFAULT_COST_MODEL.defaultHandlingMinutes, 24 * 60),
  };

  const cc = src.capitalCost as Record<string, unknown> | null | undefined;
  const attribute = typeof cc?.attribute === "string" ? cc.attribute.trim() : "";
  if (attribute) {
    const rate = typeof cc?.annualRate === "number" ? cc.annualRate : Number(cc?.annualRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) errors.push("Annual cost of capital must be between 0% and 100%.");
    else settings.capitalCost = { attribute, annualRate: rate };
  }
  return errors.length ? { ok: false, errors } : { ok: true, settings };
}

/** The engine cost model for these settings, with each rule's impact (if any) keyed by rule id. */
export function costModelFromSettings(settings: CostSettings, rules: readonly RuleWithImpact[] = []): CostModel {
  const ruleImpacts: Record<string, RuleImpact> = {};
  for (const r of rules) if (r.impact) ruleImpacts[r.id] = r.impact;
  return {
    currency: settings.currency,
    hourlyRate: settings.hourlyRate,
    handlingMinutes: {},
    defaultHandlingMinutes: settings.defaultHandlingMinutes,
    delayCostPerCaseDay: settings.delayCostPerCaseDay,
    ...(settings.capitalCost && { capitalCost: settings.capitalCost }),
    ...(Object.keys(ruleImpacts).length > 0 && { ruleImpacts }),
  };
}

/** A rule as stored, optionally carrying what one violation costs. */
export type RuleWithImpact = Rule & { impact?: RuleImpact };

const RULE_FIELDS: Record<Rule["type"], (r: Record<string, unknown>) => boolean> = {
  precedence: (r) => isName(r.before) && isName(r.after),
  segregation: (r) => Array.isArray(r.activities) && r.activities.length === 2 && r.activities.every(isName),
  requires: (r) => isName(r.activity),
  sla: (r) => isName(r.from) && isName(r.to) && typeof r.maxHours === "number" && r.maxHours >= 0,
  duplicate: (r) => Array.isArray(r.keys) && r.keys.length > 0 && r.keys.every(isName),
};

/** Parse a stored rule definition; null if it isn't a rule the engine can evaluate. */
export function parseRule(input: unknown, fallbackId?: string): RuleWithImpact | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const check = RULE_FIELDS[r.type as Rule["type"]];
  if (!check || !isName(r.name) || !check(r)) return null;
  const id = isName(r.id) ? r.id : fallbackId;
  if (!id) return null;
  if (r.where !== undefined && !Array.isArray(r.where)) return null;
  const { impact: rawImpact, ...rule } = r;
  const impact = parseImpact(rawImpact);
  return { ...(rule as unknown as Rule), id, ...(impact ? { impact } : {}) };
}

function parseImpact(input: unknown): RuleImpact | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  if (i.category !== "time" && i.category !== "compliance") return undefined;
  const impact: RuleImpact = { category: i.category };
  if (typeof i.perViolation === "number" && i.perViolation >= 0) impact.perViolation = i.perViolation;
  const share = i.share as Record<string, unknown> | undefined;
  if (share && isName(share.attribute) && typeof share.fraction === "number" && share.fraction >= 0) {
    impact.share = { attribute: share.attribute, fraction: share.fraction };
  }
  return impact.perViolation === undefined && !impact.share ? undefined : impact;
}

const isName = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
