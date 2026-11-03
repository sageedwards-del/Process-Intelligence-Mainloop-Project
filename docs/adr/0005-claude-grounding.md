# ADR 0005: Code decides whether Claude's text is shown

- **Status:** Accepted
- **Date:** 2026-11-02
- **Code:** `src/web/lib/ai/` (`metrics.ts`, `grounding.ts`, `outputs.ts`, `insights.ts` (was `findings.ts`), `memo.ts`, `ask.ts`), the routes under `src/web/app/api/ai/[target]/`, `src/web/components/ai/`, tests in `src/web/test/grounding.test.ts` and `pipeline.test.ts`

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
   *Amended 2026-11-02, before deploy:* the row was written in a `finally` after the call, so parallel requests all
   passed the check and a request killed at `maxDuration` was never counted, and magic-link sign-up gave every new email
   a fresh limit. Now the row is reserved before the first model call by `reserve_ai_request()` (SECURITY DEFINER, one
   advisory lock around count + insert, so two requests at the limit can't both pass), and a site-wide cap,
   `AI_DAILY_LIMIT` (default 300 per 24 hours), sits on top. Token counts are filled in afterwards by
   `finish_ai_request()`; users still can't update or delete usage rows. Counting fails closed. An advisory lock was
   chosen over insert-then-count from the app because the count and insert then run in one round trip and one
   transaction; it serialises reservations site-wide, which is negligible at demo volume. The last line of defence is
   a monthly spend limit set in the Anthropic Console, which is outside the code and must be set by hand.

## Live run (2026-11-02)

Meridian sample: five findings (one rewrite round), a "go" memo of €95k a year from three opportunities sized from
`labour:` and `rule:` metrics, and Ask answers that filtered on invoice amount. BPIC 2020 Domestic Declarations: five
findings and a cautious "go" memo of €17.8k a year that names the default 10-minute handling assumption. The first runs
found two over-strict rules (a figure cut off rather than rounded, citations once per paragraph) and one real gap (the
same ID under two filters), fixed as described above.

## Amendment (2026-11-02): findings became insights

Findings (an issue, its causes and what to check) were replaced by **insights**: a two-to-three-sentence summary of
how the process runs, then three to five recommended actions, each with its evidence, expected impact, first steps and
what to verify on site. The product pages call this "AI-powered insights" and no longer name the model; this ADR, the
code and the Engineering page still do. The grounding rules are unchanged: every text field of an action and the
summary goes through `checkFields`; an action's evidence and the summary must cite at least one metric; failures are
sent back once and then dropped (a failed summary is dropped on its own, its actions still shown). Impact may state money
only from a cited metric that carries a cost, and the prompt forbids estimating savings otherwise. Stored as
`ai_outputs.kind = 'insights'` (migration `20261104000000`); old `findings` rows are no longer read. First live runs:
BPIC 2020 Domestic, a grounded summary and four actions on the first attempt (one dropped), each impact either citing
a cost metric or saying no saving is estimated.

## Consequences

- Correct prose with a figure the check can't parse (a figure in an unusual format, a derived number) is dropped. That is
  the intended trade: precision over recall. Dropped counts are visible.
- The check verifies numbers, not reasoning. A finding can cite true figures and still draw a weak conclusion; the prompt's
  rules and the "validate on site" list are the mitigation, not the check.
- Text is shown only after the check, so Ask streams its tool calls, not its answer.
