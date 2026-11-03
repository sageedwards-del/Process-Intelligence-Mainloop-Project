import { unitConversions, type Figure, type Metric, type MetricBundle } from "./metrics";

/**
 * The grounding check: code, not the model, decides whether Claude's text may
 * be shown. Text cites metrics inline as `[[metric id]]`. A text passes when
 *  - every cited ID exists in the analysis, and
 *  - every figure in a sentence matches a figure of a metric cited in that
 *    same sentence (or, if the sentence cites nothing, in its paragraph),
 *    rounded to the digits written or cut off at them.
 * Small counts (0–10), years, dates and clock times need no citation. Anything else fails, and
 * the caller drops or regenerates it; failing text is never shown.
 */

export interface GroundingIssue {
  field: string;
  message: string;
  /** The failing sentence, for the rewrite request to Claude only; never shown on the page. */
  sentence?: string;
}

/** Issues as the page may show them: without the failing text. */
export const publicIssues = (issues: GroundingIssue[]): GroundingIssue[] => issues.map(({ field, message }) => ({ field, message }));

/** Issues as the rewrite request quotes them. */
export const describeIssues = (issues: GroundingIssue[]): string =>
  issues.map((i) => `- ${i.field}: ${i.message}${i.sentence ? `, in: "${i.sentence}"` : ""}`).join("\n");

/** Every value an ID was seen with: a tool may report a metric for several filters. */
export type MetricIndex = Map<string, Metric[]>;

export function indexMetrics(...bundles: MetricBundle[]): MetricIndex {
  const index: MetricIndex = new Map();
  for (const bundle of bundles) {
    for (const m of Object.values(bundle)) index.set(m.id, [...(index.get(m.id) ?? []), m]);
  }
  return index;
}

const CITATION = /\[\[([^\]]+)\]\]/g;

/** Tolerates `->` for `→` and stray spaces around it, nothing else. */
export function normaliseId(raw: string): string {
  return raw.trim().replace(/\s*(?:->|→)\s*/g, " → ").replace(/\s+/g, " ");
}

/** The metric IDs cited in a text, normalised, in order of first use. */
export function citedIds(text: string): string[] {
  return [...new Set([...text.matchAll(CITATION)].map((m) => normaliseId(m[1]!)))];
}

interface NumberToken {
  raw: string;
  value: number;
  /** Half a unit of the last digit written, in the value's own scale. */
  tolerance: number;
  kind: "money" | "percent" | "ratio" | "plain";
}

const NUMBER =
  /(?<![\p{L}\d.,])([€$£])?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?:\s?(bn|[kKmM])(?![\p{L}]))?(?:\s?(%|×|x(?![\p{L}])|percent|EUR|USD|GBP|CHF|euros?|dollars?|pounds?))?/gu;
const SCALE: Record<string, number> = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, bn: 1e9 };

export function numbersIn(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const [, cur, num, suf, post] = m;
    const digits = num!.replace(/,/g, "");
    const decimals = digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0;
    const scale = suf ? SCALE[suf]! : 1;
    let unit = 10 ** -decimals;
    // "11,900" or "12,000" may be a rounded figure: its trailing zeros are rounding, not precision.
    if (!decimals && !suf && Number(digits) >= 1000) unit = 10 ** (digits.length - digits.replace(/0+$/, "").length);
    const kind =
      cur || (post && /^(EUR|USD|GBP|CHF|euros?|dollars?|pounds?)$/.test(post))
        ? "money"
        : post === "%" || post === "percent"
          ? "percent"
          : post === "×" || post === "x"
            ? "ratio"
            : "plain";
    out.push({ raw: m[0].trim(), value: Number(digits) * scale, tolerance: (unit / 2) * scale, kind });
  }
  return out;
}

/** Small counts ("3 steps") and years need no citation. */
const exempt = (t: NumberToken) =>
  t.kind === "plain" && Number.isInteger(t.value) && !t.raw.includes(".") && (t.value <= 10 || (t.value >= 1900 && t.value <= 2100));

function matches(t: NumberToken, f: Figure): boolean {
  if (t.kind === "money" && f.unit !== "money" && f.unit !== "number") return false;
  if (t.kind === "percent" && f.unit !== "share") return false;
  if (t.kind === "ratio" && f.unit !== "ratio") return false;
  if (t.kind === "plain" && f.unit === "share") return false;
  if (t.kind !== "money" && t.kind !== "plain" && f.unit === "number") return false;
  // Rounded to the nearest last digit written (€13.5k for 13,519), or cut off at it ("110 hours" for 110.5): never above the true value by more than rounding.
  const close = (v: number) => {
    const diff = Math.abs(v) - Math.abs(t.value);
    const eps = 1e-9 * Math.abs(v);
    return Math.abs(diff) <= t.tolerance + eps || (diff >= 0 && diff < 2 * t.tolerance - eps);
  };
  return unitConversions[f.unit].some((c) => close(f.value * c));
}

const MONTHS = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";

/** Citations become placeholders so splitting never cuts inside one; names lose their digits. */
function prepare(text: string, names: string[]): { masked: string; ids: string[] } {
  const ids: string[] = [];
  let masked = text.replace(CITATION, (_, id: string) => `\u0000${ids.push(normaliseId(id)) - 1}\u0000`);
  for (const name of names) if (/\d/.test(name)) masked = masked.split(name).join("§");
  // Dates and clock times say when, not how much: "2026-03-14", "14 March", "Mar 14", "09:30".
  masked = masked
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g, "§")
    .replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS})|(?:${MONTHS}) \\d{1,2}(?:st|nd|rd|th)?\\b`, "g"), "§")
    .replace(/\b\d{1,2}:\d{2}\b/g, "§");
  return { masked, ids };
}

/** Sentence ends, but not after an initial ("P. Moreau") or "e.g.", "approx.", "vs.". */
const SENTENCE_END = /(?<=(?<!\b(?:[A-Z]|e\.g|i\.e|approx|vs|ca|no|incl))[.!?])\s+/;

/** Checks one text; `field` names it in the issues. */
export function checkText(text: string, index: MetricIndex, field: string): GroundingIssue[] {
  const issues: GroundingIssue[] = [];
  const names = [...new Set([...index.values()].flatMap((ms) => ms.flatMap((m) => m.names)))].sort((a, b) => b.length - a.length);
  const { masked, ids } = prepare(text, names);
  for (const id of new Set(ids)) if (!index.has(id)) issues.push({ field, message: `cites ${id}, which isn't in the analysis` });

  // Paragraphs are lines (a list item is its own); a line of nothing but citations belongs to the line above.
  const paragraphs: { sentences: string[]; cites: number[] }[] = [];
  for (const line of masked.split(/\n+/).filter((l) => l.trim())) {
    const cites = [...line.matchAll(/\u0000(\d+)\u0000/g)].map((m) => Number(m[1]));
    if (!line.replace(/\u0000\d+\u0000/g, "").trim() && paragraphs.length) paragraphs.at(-1)!.cites.push(...cites);
    else paragraphs.push({ sentences: line.split(SENTENCE_END).filter((x) => x.trim()), cites });
  }

  for (const { sentences, cites: paragraphCites } of paragraphs) {
    // A citation that opens a sentence belongs to the sentence before it ("… €11.9k. [[edge:…]]").
    const cited: number[][] = sentences.map(() => []);
    sentences.forEach((s, i) => {
      const lead = s.match(/^(\s*\u0000\d+\u0000)+/);
      for (const m of s.matchAll(/\u0000(\d+)\u0000/g)) {
        cited[i]!.push(Number(m[1]));
        if (lead && m.index! < lead[0].length && i > 0) cited[i - 1]!.push(Number(m[1]));
      }
    });

    sentences.forEach((s, i) => {
      const plain = s.replace(/\u0000\d+\u0000/g, " ");
      const sentence = s.replace(/\u0000(\d+)\u0000/g, (_, n: string) => `[[${ids[Number(n)]}]]`).replace(/§/g, "…").trim().slice(0, 300);
      // A sentence without a citation of its own may lean on the citations of its paragraph.
      const scope = cited[i]!.length ? cited[i]! : paragraphCites;
      const metrics = scope.flatMap((c) => index.get(ids[c]!) ?? []);
      for (const t of numbersIn(plain)) {
        if (exempt(t)) continue;
        if (!scope.length) {
          issues.push({ field, message: `"${t.raw}" has no citation in its sentence or paragraph`, sentence });
        } else if (!metrics.some((m) => Object.values(m.figures).some((f) => matches(t, f)))) {
          const where = [...new Set(scope.map((c) => ids[c]!))].join(", ");
          issues.push({ field, message: `"${t.raw}" doesn't match any figure of ${where}`, sentence });
        }
      }
    });
  }
  return issues;
}

/** Checks several texts (a finding's title, body, causes…), keyed by field name. */
export function checkFields(fields: Record<string, string | string[] | undefined>, index: MetricIndex): GroundingIssue[] {
  return Object.entries(fields).flatMap(([field, value]) =>
    value === undefined ? [] : (Array.isArray(value) ? value : [value]).flatMap((v, i) => checkText(v, index, Array.isArray(value) ? `${field}[${i}]` : field)),
  );
}
