# ADR 0005: Code decides whether Claude's text is shown

- **Status:** Accepted
- **Date:** 2026-11-02
- **Code:** `src/web/lib/ai/` (`metrics.ts`, `grounding.ts`, `outputs.ts`, `findings.ts`, `memo.ts`, `ask.ts`), the routes under `src/web/app/api/ai/[target]/`, `src/web/components/ai/`, tests in `src/web/test/grounding.test.ts` and `pipeline.test.ts`

## Context

M5 adds Claude-written findings, an Ask agent and the go / no-go memo. The reader is an ops or finance manager who
will repeat the figures to a client. A plausible but wrong figure (a sum the model did, a percentage of the wrong base,
an edge cost added to the rule it was allocated from) is worse than no figure. Asking the model to be careful is not a
control; checking its output is.

## Decision

1. **One bundle of figures.** The server runs the same `analyse()` as the explorer's worker (moved to
   `lib/analysis/analyse.ts`) and turns it into a metrics bundle keyed by the metric IDs in `CLAUDE.md`, plus `rule:id`,
   `capital:total` and `overview`. Each metric carries typed figures (money, count, hours, share, ratio), the explorer's
   formula string, and notes the model must respect (planned waits aren't delays, repeats aren't always rework,
   segments are correlations, edge costs are already inside rule totals).
2. **Inline citations.** Claude writes `[[metric id]]` in the sentence that uses a figure.
3. **The check, in code.** A text passes only if every cited ID exists and every number in a sentence matches a figure
   of a metric cited in that sentence (a sentence that cites nothing may use its paragraph's citations; a list item is its
   own paragraph), rounded to the digits written or cut off at them (`€13.5k` covers 13,450–13,600;
   `110 hours` covers 109.5–111, so "over 110 hours" for 110.5 passes; `13,520` may be rounded to the ten). Hours may be quoted as days or minutes and shares as percentages; nothing else
   is converted. Counts up to 10, years, dates, clock times and digits inside activity or resource names are exempt.
4. **Fail closed.** Findings and memo parts that fail are sent back once with the exact reasons and the failing
   sentence, then dropped. Ask answers get one rewrite. Failing text is never shown or stored; the page shows only how
   many items were rewritten or dropped and why.
5. **Money in the memo is computed, not written.** Opportunities name the metrics they reduce, only `rule:`, `rework:`,
   `labour:` or `capital:total` (ADR 0002: edge and resource costs are allocations of rule and capital money), never
   one metric twice or a step's rework next to its labour. Code computes annual cost × addressable share; the share is
   Claude's stated assumption and the reader can change it.
6. **Ask works through tools.** The dataset ID comes from the URL and the log is read under the user's RLS; the model
   only chooses filters and outcomes. Every metric a tool returns joins that answer's index, so answers are grounded in
   what the engine returned in that conversation. Under a filter a tool's IDs carry it (`edge:A → B | amount ≥ 10000`,
   with the filter's bounds as figures), so a figure must come from the scope it cites.
7. **Models and limits.** Sonnet 5.5 for findings and Ask, Opus 5.5 for the memo (build plan), with the API's server-side
   refusal fallback. Each request is one `ai_usage` row written as the user (new insert-only policy); 30 requests per user
   per hour. The sample needs a signed-in user too; its outputs are kept in memory because it has no dataset row.

## Live run (2026-11-02)

Meridian sample: five findings (one rewrite round), a "go" memo of €95k a year from three opportunities sized from
`labour:` and `rule:` metrics, and Ask answers that filtered on invoice amount. BPIC 2020 Domestic Declarations: five
findings and a cautious "go" memo of €17.8k a year that names the default 10-minute handling assumption. The first runs
found two over-strict rules (a figure cut off rather than rounded, citations once per paragraph) and one real gap (the
same ID under two filters), fixed as described above.

## Consequences

- Correct prose with a figure the check can't parse (a figure in an unusual format, a derived number) is dropped. That is
  the intended trade: precision over recall. Dropped counts are visible.
- The check verifies numbers, not reasoning. A finding can cite true figures and still draw a weak conclusion; the prompt's
  rules and the "validate on site" list are the mitigation, not the check.
- Text is shown only after the check, so Ask streams its tool calls, not its answer.
