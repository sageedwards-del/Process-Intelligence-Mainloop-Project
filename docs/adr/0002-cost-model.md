# ADR 0002: Cost model (labour, time, compliance; waiting priced only through its consequences)

- **Status:** Accepted
- **Date:** 2026-11-02
- **Code:** `CostModel` in `src/engine/src/bottlenecks.ts`, rule pricing in `src/engine/src/rules.ts`, settings parsing in `src/engine/src/costSettings.ts`, Meridian assumptions in `src/datagen/src/invoiceApproval.ts`

## Context

The product's promise is a cost-ranked answer a finance reader will accept: every figure shows its formula, and the
formula has to survive the question "where does that number come from?". A review on 2026-11-02 found that the first
version of the model had the right three-way split but four defects:

1. **Waiting was priced twice.** A flat €4 per case per day of waiting was charged on top of the time losses rules
   already price. On the Meridian sample, a late invoice paid both the per-day charge and the 2% missed discount for the
   same lateness. The €4 itself had no source.
2. **The whole wait counted as excess.** Without a configured target a transition's target was 0 hours, so normal
   processing time was priced as delay. Resources were already compared with the activity median; transitions weren't.
3. **No baseline cost to serve.** Labour counted only rework. A go/no-go on automating a step needs the hands-on cost of
   every execution, not just the repeats.
4. **Compliance was a worst case.** A duplicate payment cost 100% of the amount, as if none were ever recovered.

## How others do it

- **Time-driven activity-based costing (TDABC)**, Kaplan & Anderson (*HBR*, 2004; book 2007): cost of an activity =
  capacity cost rate (cost of capacity supplied ÷ practical capacity, in money per minute) × minutes per execution. Our
  labour formula is this, with a fully loaded hourly rate standing in for the capacity cost rate.
- **Cost of delay** (Reinertsen, *The Principles of Product Development Flow*, 2009): the cost of a queue is its delay ×
  a cost of delay that has to be quantified from what the delay actually loses. Reinertsen reports that intuitive
  estimates of it vary 50 to 1, which is the argument against a guessed flat per-day figure.
- **Cost-aware process mining** (Wynn, Low, ter Hofstede & Nauta, *J. Universal Computer Science* 20(3), 2014; Nauta's
  2011 thesis): merge management-accounting cost data with the event log for cost reporting and prediction. Same idea
  as ours: cost is an input from the business, attached to events, not inferred from timestamps alone.
- **Celonis** prices value through levers with real money behind them, e.g. improvement rate × cash discounts available
  in the year, or the value of duplicate payments prevented as freed working capital. Rework is counted (`CALC_REWORK`)
  and priced with a rate the customer supplies. We found no documented generic "cost per day of waiting".
- **SAP Signavio** costs processes in BPMN simulation (resource cost × activity duration, i.e. TDABC on a model) and,
  newer, a value-case agent working from configurable cost and effort parameters. We found no documented cost-per-case
  calculation in Process Intelligence.
- **Duplicate payments** are mostly recovered once found: public-sector audits report 86–98% (Orange County) and about
  96% recovered before audit plus 1.6% by it (Leeds City Council). These are single audits, not a benchmark.
- **Sanity check for invoice processing:** APQC's cross-industry median cost to process an AP invoice was about $5.80
  in 2018, with top performers near $2.05 and the bottom group near $10 (personnel, systems, overhead and vendors).

## Decision

Keep the three categories and the "every figure shows its formula" rule. Change the inputs:

- **Labour = executions × handling minutes × hourly rate ÷ 60 (TDABC).** Reported two ways: rework (repeats only, a
  loss) and baseline cost to serve (every execution, the ceiling on what automating a step could save). New metric ID
  `labour:Activity`.
- **Time is priced only through consequences.** `delayCostPerCaseDay` defaults to 0 and is documented as "any other
  per-day cost no rule prices", e.g. a contractual penalty. Time costs come from:
  - `time` rule impacts (a missed discount, a late fee), **allocated to the waits that caused them**: each violation's
    cost is split over its case's waits (for an SLA rule, the waits between its `from` and `to`) in proportion to each
    wait's excess over its target. Transitions and people then carry real money, and the allocated amounts sum exactly
    to the rule totals, so nothing is counted twice.
  - capital tied up (`amount × annual rate ÷ 365` per excess day), only where waiting delays money coming in.
- **Excess wait = wait beyond a target; the default target is the transition's median wait.** Only waiting beyond the
  usual counts, matching how people are already compared.
- **Compliance = expected loss:** `perViolation + share × amount × (1 − recoveryRate)`. `perViolation` is the effort to
  follow up or recover; `recoveryRate` is the share of the amount expected back.

### Meridian sample values (assumptions to check with the team)

| Input | Value | Basis |
|---|---|---|
| Hourly rate | €55 | Assumption: fully loaded finance staff hour |
| Handling minutes | 0.5–10 per step, ~25 per invoice on the main path | Assumption; see `MERIDIAN_COST_MODEL` |
| Flat delay cost | €0 | Payables: waiting costs Meridian only through missed discounts |
| Missed 2/10 discount | 2% of amount | The terms themselves |
| Duplicate payment | €40 + amount × (1 − 0.9) | Recovery rate within the 86–98% audits report, at the cautious end |
| Four-eyes break, missing director approval | €150 each | **Unsourced**: audit follow-up effort; replace with time × rate once measured |

Meridian's baseline is about €26 per invoice, above APQC's bottom group (~$10). That fits a small firm with manual
partner approvals, but it is the figure most worth checking on site.

## Consequences

- Delay costs on uploaded data are 0 until the workspace prices a consequence (a time rule or capital cost). The
  explorer shows "–" with a formula that says so, and still ranks waits by excess. That is honest, but less dramatic.
- The same euro can appear in two views (a rule's total and the waits it was allocated to). Views are never summed:
  the M5 memo must take totals from rules, rework, cost to serve and capital, never from edges plus resources.
- Allocation is attribution, not causation: a wait that ran long is assigned its share of the loss, even if another
  factor contributed. The UI says "shared out by excess wait".
- **Not done yet:** low / base / high ranges and an avoidable share per figure (planned with the M5 memo), per-role
  hourly rates, per-activity minutes in the settings form, and wait targets in the settings form.

## Sources

- R. S. Kaplan, S. R. Anderson, "Time-Driven Activity-Based Costing", *Harvard Business Review*, Nov 2004; summary: https://maaw.info/ArticleSummaries/ArtSumKaplanAnderson2004.htm
- D. G. Reinertsen, *The Principles of Product Development Flow*, Celeritas, 2009; overview: https://en.wikipedia.org/wiki/Cost_of_delay
- M. T. Wynn, W. Z. Low, A. H. M. ter Hofstede, W. Nauta, "A Framework for Cost-Aware Process Management: Cost Reporting and Cost Prediction", *J. UCS* 20(3): 406–430, 2014: https://www.jucs.org/jucs_20_3/a_framework_for_cost.html
- Celonis, value tracking (sign-in required): https://docs.celonis.com/en/setting-up-value-tracking.html; PQL `CALC_REWORK`: https://help.celonis.com/pql47/en/calc_rework
- SAP Signavio BPMN simulation: https://www.sap.com/suisse/products/technology-platform/signavio-solutions-bpmn-simulation-insights.html
- Orange County Auditor-Controller, duplicate payments (CAAT), Nov 2008: https://ocauditor.gov/wp-content/uploads/2017/08/2844-E-CAAT-November-2008.pdf
- Leeds City Council, duplicate payments report: https://democracy.leeds.gov.uk/documents/s50203/duplicate%20payments.pdf
- APQC accounts payable cost per invoice (2018), via CFO.com: https://www.cfo.com/news/metric-of-the-month-accounts-payable-cost/659393/
