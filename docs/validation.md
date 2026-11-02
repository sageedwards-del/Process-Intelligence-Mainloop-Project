# Validation on real data (M4)

_Run on 2026-11-02 against public BPI Challenge logs. Reproduce with the commands at the end._

**Question:** does Throughline find what independent analysts found in real event logs, from a raw export, quickly?
**Answer:** yes for the process findings. On BPIC 2020 Domestic Declarations it reproduces the published case, event and
resubmission counts exactly, finds the same two declarations paid without approval and the same bottlenecks, and agrees
with the published reasons cases run slow. On a BPIC 2019 purchase-to-pay subset (319k events) it finds the same two
bottleneck stages and matching throughput. Getting there exposed five engine defects, now fixed (below). Cost figures
are **not** validated: no public log carries handling times, payment terms or loss data, so every euro on these logs
rests on the cost settings, which is stated next to each figure.

## Data

| Log | Source | Process | Cases / events | Licence |
|---|---|---|---|---|
| BPIC 2020 Domestic Declarations | Eindhoven University of Technology travel expenses, 2017–18 | Declare → administration → budget owner → supervisor → payment | 10,500 / 56,437 | CC BY-NC 4.0 (not redistributed) |
| BPIC 2020 Request for Payment | same | Payment requests outside travel | 6,886 / 36,796 | CC BY-NC 4.0 |
| BPIC 2020 Prepaid Travel Cost | same | Prepayments, with the permit steps | 2,099 / 18,246 | CC BY-NC 4.0 |
| BPIC 2020 Travel Permits | same | Permit, trip, declarations and payments per trip | 7,065 / 86,581 | CC BY-NC 4.0 |
| BPIC 2019, 3-way match after GR | Dutch coatings and paints multinational, SAP, 2018 | Purchase-to-pay per PO item | 15,182 / 319,233 | CC BY 4.0 |

Files come from 4TU.ResearchData or, when 4TU is unreachable, a GitHub mirror; either way they are checked against the
MD5 4TU publishes (`src/miner/scripts/bpic.py`). They are converted from XES with pm4py and never committed.

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
| Travel Permits | 7,065 | 1,478 (14%) | 71.7 | 1.6 s | 746 trips started before any permit was submitted, 1,329 before final approval (our finding, not cross-checked). 541 duplicate events flagged on upload. |

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

## Limitations found, not fixed

- **Automatic steps distort median targets.** "Submitted → approved by administration" has a median under a minute
  because many approvals are automatic ([P] notes 696 within 5 seconds), so every human approval counts as excess and
  the transition ranks second by excess wait. A per-transition wait target fixes it; settings don't expose targets yet.
- **Scheduled waits are not delays.** In the permit log, "permit approved → start trip" is the largest wait, but it is
  the time until a planned trip, not a queue. The engine can't tell a booked date from a backlog; the analyst has to.
- **Directly-follows waits are not end-to-end milestones.** [B]'s and BPIC 2019 reports measure milestone pairs (goods
  receipt → invoice) across intervening steps; our map measures adjacent steps. SLA rules cover milestone pairs, but
  only as pass/fail.
- **A repeated step isn't always rework.** In purchase-to-pay, several goods receipts or invoices per item are partial
  deliveries and instalments: "Record Goods Receipt" repeats on 28% of items. The rework list counts repeats; reading
  it needs the domain, which the AI findings (M5) should be told.
- **Same-second repeats look like double exports.** BPIC 2019's 177,882 "duplicate events" are mostly distinct
  service-entry and goods-receipt events recorded in batches. Without an event id column the quality check can't tell
  them apart; its wording says "may be".
- **Storage limits on deploy.** The 87 MB upload worked locally. Hosted Supabase plans cap uploads globally; check the
  limit at deploy (M6) or the page's 100 MB promise breaks.
- **Root causes are correlations.** Every finding above is "correlated with", as the UI says. Budget owners may get the
  harder declarations.
- **No cost data.** All euro figures on these logs come from the default cost settings (€55/h, 10 min per step) and
  carry no validation weight. Rework is priced; waits show "–" because no time rule or capital cost is set.

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
| Data quality | 25 events dated far outside 2018 (back to 2001), flagged (fix 5); 177,882 events repeat an activity at the same second; 363,930 placeholder cells (`NONE` user) | Outlier timestamps and same-second events are known features of this log | Agrees |

**Through the app:** the 87 MB file parsed and passed the quality report in the browser in about 8 s, saved in about
5 s (raw file plus a 1.5 MB snapshot), and the explorer was ready about 7 s after opening. The engine alone takes 6.8 s
(`validate-bpic.ts`: parse 1.1 s, ingest and quality report 2.4 s, build 1.9 s, bottlenecks 0.4 s, root causes 0.4 s)
and peaks at about 830 MB of memory in Node, which is about the practical ceiling for one upload in a browser tab.

## Reproduce

```bash
cd src/miner && uv run python scripts/bpic.py all          # download (MD5-checked) and convert into data/external/bpic/
cd ../web && npx tsx scripts/validate-bpic.ts              # every configured log; or name some, e.g. bpic2020-domestic
```

The 2019 subset is one item category of `bpic2019.csv`, made with:

```bash
python3 -c "import csv; r=csv.reader(open('data/external/bpic/bpic2019.csv')); h=next(r); k=h.index('Item Category'); w=csv.writer(open('data/external/bpic/bpic2019-3way-after.csv','w',newline='')); w.writerow(h); [w.writerow(x) for x in r if x[k]=='3-way match, invoice after GR']"
```

Results are written to `data/external/bpic/results/<log>.json` (gitignored).
