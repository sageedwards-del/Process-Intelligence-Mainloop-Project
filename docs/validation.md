# Validation on real data (M4)

_Run on 2026-11-02 against public BPI Challenge logs, then re-run after the limitation fixes the same day (ADR 0003,
lifecycle support, cost validation). Reproduce with the commands at the end._

**Question:** does Throughline find what independent analysts found in real event logs, from a raw export, quickly?
**Answer:** yes for the process findings. On BPIC 2020 Domestic Declarations it reproduces the published case, event and
resubmission counts exactly, finds the same two declarations paid without approval and the same bottlenecks, and agrees
with the published reasons cases run slow. On a BPIC 2019 purchase-to-pay subset (319k events) it finds the same two
bottleneck stages and matching throughput. Getting there exposed five engine defects, now fixed (below), and four
limitations, now addressed (waits are classified before they count as delays; batches are told from duplicates).
**Cost** is validated where public data allows: handling minutes measured from lifecycle data match a published BPIC
2017 figure, and recorded penalty money in BPIC 2018 reconciles to the cent. A client's real loss rates (what a day of
delay or a control failure costs them) can't be validated on public data; that needs a pilot (see the data request).

## Data

| Log | Source | Process | Cases / events | Licence |
|---|---|---|---|---|
| BPIC 2020 Domestic Declarations | Eindhoven University of Technology travel expenses, 2017–18 | Declare → administration → budget owner → supervisor → payment | 10,500 / 56,437 | CC BY-NC 4.0 (not redistributed) |
| BPIC 2020 Request for Payment | same | Payment requests outside travel | 6,886 / 36,796 | CC BY-NC 4.0 |
| BPIC 2020 Prepaid Travel Cost | same | Prepayments, with the permit steps | 2,099 / 18,246 | CC BY-NC 4.0 |
| BPIC 2020 Travel Permits | same | Permit, trip, declarations and payments per trip | 7,065 / 86,581 | CC BY-NC 4.0 |
| BPIC 2019, 3-way match after GR | Dutch coatings and paints multinational, SAP, 2018 | Purchase-to-pay per PO item | 15,182 / 319,233 | CC BY 4.0 |
| BPIC 2017, work items | Dutch financial institute, loan applications, 2016 | `W_` work items with start / suspend / resume / complete / abort | 768,823 lifecycle events | 4TU terms of use |
| BPIC 2018 (whole log; department d4 in the app) | German EU agricultural direct payments, 2015–17 | Applications with applied, paid and penalty amounts | 43,809 / 2,514,266 (d4: 5,744 / 393,265) | CC0 |

Files come from 4TU.ResearchData or, when 4TU is unreachable, a GitHub mirror; either way they are checked against the
MD5 4TU publishes (`src/miner/scripts/bpic.py`; 4TU was down for the 2017/2018 downloads, and its MD5s were taken
from figshare, 4TU's storage backend). They are converted from XES with pm4py, except BPIC 2018 (1.9 GB of XES), which
is streamed one case at a time in constant memory (191 MB). Nothing is committed.

## Method

`src/web/scripts/validate-bpic.ts` runs each converted CSV through the same code the product uses: Papa Parse with the
upload page's options, `guessMapping`, `ingestTable` (and its data-quality report), `buildLog`, then the explorer's engine
calls: summary, variants, `analyzeBottlenecks`, `evaluateRules`, and `analyzeRootCauses` on the slowest 10% of cases
with the explorer's segment options. The only human choices were the ones a user makes on the upload page (the resource
column: `org:role`, because BPIC 2020 anonymises people) and the rules, written as a finance controller would state them.

Published figures come from two BPIC 2020 reports:
- **[P]** P. Pfeiffer et al. (DFKI / Saarland University), "Business Process Intelligence Challenge 2020: Analysis and evaluation of a travel process", ICPM 2020.
- **[B]** D. Bano et al. (HPI Potsdam), "Multi-perspective Analysis of Approval Processes based on Multiple Event Logs", ICPM 2020.

## Results: BPIC 2020 Domestic Declarations

| Check | Throughline | Published | Verdict |
|---|---|---|---|
| Cases / events / activities | 10,500 / 56,437 / 17 | 10,500 / 56,437 / 17 [P] | Exact |
| Declarations resubmitted | 1,166 resubmissions in 1,019 cases (rework on "Declaration SUBMITTED by EMPLOYEE", 9.7% of cases) | 1,166 in 1,019 cases [P] | Exact |
| Paid without final approval | 2 cases: declarations 90815 and 95149 (rule "final approval before payment") | The same two declarations [P] | Exact |
| Duplicate declarations | 0 (rule "no declaration number used twice") | No double payments [P] | Agrees (after fix 1) |
| Who rejects | Administration 64%, Supervisor 20% of rejections (952 and 293 of 1,481, excluding employee withdrawals) | 64% and about 20% [B] | Agrees |
| Paid | 95.7% of cases reach Payment Handled | 95.6% [P] | Agrees |
| Bottlenecks | Largest total waits: Request Payment → Payment Handled (median 3.2 days) and final approval → Request Payment (median 27 h) | The same two transitions [B]; payment steps have the longest medians [P] | Same ranking; our total waits are about 3× [B]'s (98 and 87 vs 32 and 25.5 case-years), see below |
| Why cases run slow (slowest 10%, ≥ 20.1 days) | Rejected and resubmitted by the employee: 25% vs 8% (lift 2.5). Budget owner involved: 15% vs 8% (lift 1.5). Amount over €87: 14% vs 9% (lift 1.4). All significant (|z| ≥ 3) | Budget owner involvement lengthens the wait for final approval [B]; amount correlates with throughput time [P]; resubmissions are the main correction loop [P] | Agrees (after fixes 2 and 4) |
| Never finally approved | 430 cases | 365 [P], 419 [B] | Definitions differ (see below) |
| Median throughput | 7.3 days (mean 11.5) | Mean approval time about 8 days, payment 3.5 days [P] | Consistent; not the same measure |

**Where the numbers differ, and why.**
- *Total waiting on the two payment transitions.* We sum every directly-follows wait over all 10,000-odd cases; [B]
  reports a "total duration" of 25.5 and 32 years with a cycle-time definition it doesn't fully specify. The ranking
  agrees; the magnitudes are not comparable.
- *Never approved.* We count cases with no "FINAL_APPROVED" event (430). [P] counts cases never approved at any stage
  (365); [B] gets 419 with its own rule. All three are defensible; they answer slightly different questions.

**Time from raw file to top three findings.** Through the app, on a laptop with the dev server: the 9.6 MB CSV was
parsed, mapped and quality-checked in the browser in about 5 s; saving took a few seconds; the explorer was ready about
14 s after opening the dataset (including first-visit compilation in dev mode). The engine itself takes about 1 s
end to end (`validate-bpic.ts` timings: parse 90 ms, ingest and quality report 300 ms, bottlenecks 150 ms, root
causes 140 ms). The human steps (choosing the resource column, reading the map, running a root-cause analysis) took
minutes, well inside M4's 30-minute target. The top three findings a manager sees:
1. Payment is the slowest stage: after final approval, a declaration waits a median 27 h for the payment request and
   another 3.2 days to be paid, the two largest total waits in the process.
2. One declaration in ten is rejected and resubmitted (1,166 resubmissions), and those cases are 2.5× as likely to be
   among the slowest.
3. Budget-owner approval, needed on about a quarter of declarations, makes a case 1.5× as likely to be slow.

## Results: other BPIC 2020 logs

No published figures were cross-checked for these; they show the pipeline holds on wider and messier logs.

| Log | Cases | Variants (top share) | Median days | Engine time | Notable findings |
|---|---|---|---|---|---|
| Request for Payment | 6,886 | 89 (44%) | 8.2 | 0.6 s | Every payment has a final approval once director and budget-owner approvals count (fix 3). Resubmission (690 in 611 cases) and budget-owner involvement (lift 1.6) again explain slow cases. |
| Prepaid Travel Cost | 2,099 | 202 (27%) | 24.0 | 0.4 s | Large requested budgets (≥ €2,460) and director approval: lift 1.9 each. |
| Travel Permits | 7,065 | 1,478 (14%) | 71.7 | 1.6 s | 746 trips started before any permit was submitted, 1,329 before final approval (our finding, not cross-checked). Trip start and end detected as planned dates. The 541 "duplicates" of the first run were distinct events: with the event id now kept, none remain. |

## Engine defects found and fixed

1. **Placeholder values counted as real.** `UNKNOWN` in `DeclarationNumber` made 451 declarations look like duplicates of
   each other. `ingestTable` now reads UNKNOWN, UNDEFINED, N/A, NULL, NONE, NaN, "-" and "?" as missing and the
   data-quality report lists what it blanked (here 21,374 cells, mostly the `UNDEFINED` role on system steps).
2. **Long decimals read as text.** Values like `26.85120450862128` (17 characters) were kept as text by a guard meant for
   long numeric IDs, so `Amount` was never analysed as a number. Decimals are now numbers at any length; only long
   integers stay text.
3. **Precedence rules allowed one approver.** "Final approval before payment" flagged 41 requests that a director, not a
   supervisor, approved. A precedence rule's `before` can now list alternatives (any one counts).
4. **Root causes couldn't see the path.** Only attributes and "who did step X" were examined, so on a log with
   anonymised people nothing useful surfaced. Root causes now also segment by whether a case passes through each
   optional step (`segment:passes:Activity=yes|no`, in 5–95% of cases), which is how the rejection and budget-owner
   findings appear. Duplicate "who did X" rows are hidden when one role always does X.
5. **Mistyped dates went unflagged.** BPIC 2019 has events dated 2001 in a 2018 export; the upload page reported a
   19-year time span without comment. The quality report now flags events more than a year outside the central 98% of
   timestamps (25 here, none in the 2020 logs).

## Limitations found in M4, and what was done

**Fixed** (ADR 0003, `src/engine/src/waits.ts`):

| Limitation | Before | After |
|---|---|---|
| Normal waits priced as excess | Excess = wait beyond the median, nights and automatic approvals included. Domestic "submitted → approved by administration": 9,477 case-days of excess, ranked second | Excess = working-hours queue time beyond the 75th percentile of human waits; 55% flagged automatic; 150k off-hours hours not counted; 184 stuck approvals set apart. Still second (32,916 working hours of excess), now for a real reason: 1 in 5 human approvals waits over a working day against a usual 15 minutes. The published top bottleneck (final approval → payment request) stays first |
| Planned dates as bottlenecks | Permit "permit approved → start trip" was the largest wait | Start trip and End trip detected as planned dates (100% of 7,065 timestamps at local midnight); their waits listed as "time until planned dates", never priced |
| Batches as duplicates | 177,882 "duplicate events" (2019), 541 (permits) | Duplicates by event id when there is one (permits: 0; the converter now keeps it); otherwise "rows identical in every column", an info note. Batch runs reported as their own lever (Domestic: Payment Handled 1.8 runs a week, ~50 per run) |
| No cost data | Every euro rested on assumptions | See "Cost validation" below |

**Remaining:**

- **Directly-follows waits are not end-to-end milestones.** [B]'s and BPIC 2019 reports measure milestone pairs (goods
  receipt → invoice) across intervening steps; our map measures adjacent steps. SLA rules cover milestone pairs, but
  only as pass/fail.
- **One calendar per log.** The 2019 log (a multinational's SAP system) learns a 20-hour working day, so off-hours
  barely register there; per-resource calendars would fix it.
- **Date-only steps are all treated as planned.** BPIC 2018's "mail income" and "mail valid" are receipt dates, not
  appointments; treating them as planned is conservative (never priced), and the panel lets people unmark them.
- **A repeated step isn't always rework.** In purchase-to-pay, several goods receipts or invoices per item are partial
  deliveries and instalments: "Record Goods Receipt" repeats on 28% of items. The rework list counts repeats; reading
  it needs the domain, which the AI findings (M5) should be told.
- **Storage limits on deploy.** The 87 MB upload worked locally. Hosted Supabase plans cap uploads globally; check the
  limit at deploy (M6) or the page's 100 MB promise breaks.
- **Root causes are correlations.** Every finding above is "correlated with", as the UI says. Budget owners may get the
  harder declarations.

## Results: BPIC 2019, 3-way match with invoice after goods receipt

The whole log is 251,734 PO items and 1.6M events, 441 MB as CSV, over the 100 MB upload limit. We took one item
category, as a user would filter their SAP export: *3-way match, invoice after GR*, 15,182 items and 319,233 events
(87 MB). Compared with **[A]** A. Augusto, V. Leno, D. Reissner (University of Melbourne), "BPI Challenge 2019
Report: a Purchase-to-Pay Process Analysis", where this category is data flow DF1.

| Check | Throughline | Published | Verdict |
|---|---|---|---|
| Items / activities | 15,182 / 38 | 15,129 after their outlier filter / up to 38 unique activities [A] | Agrees |
| Throughput | Median 63.4 days end to end (mean 75.0) | Goods receipt → cleared invoice median 63.2 days; filtered DF1 average 66.6 days [A] | Agrees |
| Bottlenecks | Largest total waits: Invoice Receipt → Clear Invoice (median 21 days) and Goods Receipt → Invoice Receipt (median 19 days) | The same two stages: GR → IR median 20.8 days, IR → clearing median 27.8 days [A] | Same ranking; our medians are lower because we measure adjacent steps and [A] pairs milestones across intervening events |
| Rework | Change Price on 1,093 items (7.2%) | Change Price, Change Quantity and four others are the rework activities [A] | Consistent |
| Controls | 1 item cleared without a goods receipt, 9 without an invoice receipt | Not reported | Our finding |
| Why items run slow (slowest 10%, ≥ 134 days) | Invoice receipt recorded by `batch_01`: all 387 such items are slow (lift 10; the same user is 28× slower than peers on that step). Subcontracting items: lift 5. Net worth over €2,310: lift 2. Payment block removed: lift 2 | [A] doesn't segment slow items | Our finding; the batch user is worth asking about |
| Data quality | 25 events dated far outside 2018 (back to 2001), flagged (fix 5); 129,861 rows identical in every column (an info note: the source has no event id, so items recorded together can't be told from copies); 17,869 batch runs (e.g. 419 invoices cleared at once); 363,930 placeholder cells (`NONE` user) | Outlier timestamps and same-second events are known features of this log | Agrees |

**Through the app:** the 87 MB file parsed and passed the quality report in the browser in about 8 s, saved in about
5 s (raw file plus a 1.5 MB snapshot), and the explorer was ready about 7 s after opening. The engine alone takes 6.8 s
(`validate-bpic.ts`: parse 1.1 s, ingest and quality report 2.4 s, build 1.9 s, bottlenecks 0.4 s, root causes 0.4 s)
and peaks at about 830 MB of memory in Node, which is about the practical ceiling for one upload in a browser tab.

## Cost validation

What can be validated on public data, and what can't:

| Part of the cost model | Validated against | Result |
|---|---|---|
| Measuring handling time (labour) | Meridian generated with injected hands-on minutes (`generateInvoiceLog({ lifecycle: true })`) | Measured medians recover the injected minutes within 5% (`groundTruth.test.ts`) |
| Measuring handling time on real data | BPIC 2017 work items; F. Berger, "Mining Event Log Data to Improve a Loan Application Process", BPIC 2017 report | W_Validate application: 18.0 min per case (5–95% trimmed mean) vs Berger's 17.5, the same 21,870 cases and the same 1.6 min lower cut-off. The engine's per-item trimmed means equal an independent Python computation for all six work-item types (e.g. 19.0, 12.1, 9.0 min) |
| The default labour assumption | BPIC 2017, measured vs the 10-minute default | The default understates labour 2.4× (€384k vs €937k at €55/h): it misses 85,224 aborted work items (agents' calls that ended without "complete") and underrates validation. Measured minutes now replace the default when a log has them; aborted work counts as labour; each item counted up to its activity's 95th percentile, because items left open by mistake (Berger's 1,126-minute example) would otherwise read as hours |
| Pricing from recorded amounts | BPIC 2018 department d4: penalties applied by the department (`penalty_amount0`) | Engine total €896,250.45 over 2,252 penalised cases, equal to the independent Python total to the cent |
| A time-rule loss allocated to waits | BPIC 2018 late payments (challenge definition, as made precise by Brils et al.) | 443 late cases in d4, equal to Python; the allocated amount sums exactly to the rule total; the largest share (25%) lands on Payment application steps, which Brils et al. name the bottleneck, with control, parcel and reference-alignment documents taking most of the rest: partial agreement |
| Late payments by department | Brils, van den Elsen, de Priester, Slooff, "Analysis and Prediction of Undesired Outcomes", BPIC 2018 (whole log) | d4 is over-represented among late cases: 13.1% of all, 19.0% of late (published 15.6% and 21.4%); 4e and 6b under-represented in both. Same pattern, levels up to 2.5 points apart (their case set may differ) |
| Cost per invoice | APQC (2018: median about $5.80, top performers about $2.05) and Ardent Partners (2025: average $9.40, best-in-class $2.78) | Meridian's assumed €26 per invoice is above every benchmark range, consistent with manual partner approvals at a small firm, but the figure most likely to be challenged. No public P2P log has touch times to check it |

**Not validated, and can't be on public data:** what a day of delay, a late payment or a control failure actually costs
a given client (BPIC 2018 records penalties to farmers, not the department's own cost of lateness, so its late-payment
rule is priced at a nominal €1 a case to test where money lands, not how much). That takes a pilot. The data request
for one:

1. Fully loaded hourly cost by role (finance clerk, approver, controller), or salary bands and overhead rate.
2. Payment terms by vendor and the early-payment discounts actually taken vs offered over the period.
3. Late fees and interest paid, by invoice if possible.
4. Duplicate payments found and the amount recovered, by year.
5. Audit or compliance follow-up time per control failure (hours, roles).
6. An export with lifecycle start events, or a few days of time-tracking for the main steps, to replace assumed minutes.

## Reproduce

```bash
cd src/miner && uv run python scripts/bpic.py all          # download (MD5-checked) and convert into data/external/bpic/
cd ../web && npx tsx scripts/validate-bpic.ts              # every configured log; or name some, e.g. bpic2020-domestic
```

`bpic.py convert --only bpic2018` streams the 2018 log, writes department d4 to `bpic2018-d4.csv` and whole-log
department figures to `results/bpic2018-full-stats.json`. The BPIC 2017 work-item file keeps the `W_` rows of
`bpic2017.csv` (`case_id, activity, timestamp, resource, lifecycle`).

The 2019 subset is one item category of `bpic2019.csv`, made with:

```bash
python3 -c "import csv; r=csv.reader(open('data/external/bpic/bpic2019.csv')); h=next(r); k=h.index('Item Category'); w=csv.writer(open('data/external/bpic/bpic2019-3way-after.csv','w',newline='')); w.writerow(h); [w.writerow(x) for x in r if x[k]=='3-way match, invoice after GR']"
```

Results are written to `data/external/bpic/results/<log>.json` (gitignored).
