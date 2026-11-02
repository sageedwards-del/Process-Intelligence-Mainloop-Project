# ADR 0003: Classifying waits before calling them delays

- **Status:** Accepted
- **Date:** 2026-11-02
- **Code:** `src/engine/src/waits.ts` (`detectWaitContext`, `classifyWaits`, `discoverWorkCalendar`, `parseAnalysisSettings`), its use in `src/engine/src/bottlenecks.ts`, the explorer's "How waits are classified" panel, and `datasets.analysis_settings`

## Context

The M4 validation (`docs/validation.md`) showed three ways raw waiting time misleads:

1. **Normal waits were priced as excess.** On BPIC 2020 Domestic, "submitted → approved by administration" ranked
   second: 55% of those approvals happen within a minute, and most of the remaining wait is nights and weekends. With
   the median as the target, half of every wait counted as excess by definition.
2. **Planned dates looked like bottlenecks.** In the permit log, "permit approved → start trip" was the largest wait.
   All 7,065 trip starts are at local midnight: they are dates typed in, not moments work happened.
3. **Batch runs looked like queues or duplicates.** Payment runs and nightly postings put many cases at one instant.

## Research basis

- Lashkevich, Milani, Chapela-Campa, Suvorau, Dumas, "Why am I Waiting? Data-Driven Analysis of Waiting Times in
  Business Processes", CAiSE 2023 (arXiv 2212.01392); the Kronos tool. Each transition's waiting time is split into
  non-overlapping causes in a fixed order of precedence: batching, resource contention, prioritization, resource
  unavailability (outside working hours), extraneous. It needs start and end timestamps and resources.
- Calendars from logs: Martin et al., "Retrieving the resource availability calendars of a process from an event
  log", *Information Systems* 2020; López-Pintado & Dumas, probabilistic resource calendars, 2023.
- Batching as the same activity, same resource, different cases, same moment: Martin et al.; BAMA (*Information
  Systems*, 2020), with the caution that such groups can be spurious without causal knowledge.
- Extraneous delays modelled as timers (SIMOD-style simulation work).

## Decision

Most uploads have one timestamp per event, so we adapt Kronos rather than run it. **Detect once per log**
(`detectWaitContext`), then label every wait (`classifyWaits`) with one kind, in this order:

1. **Scheduled (planned date).** A step with at least 20 events, 95% of them on whole seconds and at no more than two
   times of day, whose usual time is within an hour of *local* midnight. Skipped when the whole log is date-only
   (80% of events at two times of day), where every step would look like one. People can mark or unmark steps.
2. **Batch.** The same step by the same resource for 3 or more cases at the same instant; steps done in runs 80% of
   the time (20+ events) count as batches in their small runs too; resources named like systems (SYSTEM, batch_01…),
   working 80%+ in runs, or marked as systems. Reported as their own lever: runs, runs per week, cases per run.
3. **Instant.** Followed within 60 seconds: automatic. Reported as "% automatic", never excess.
4. **Human.** Split into *queue* (working hours from a calendar learned from when people act: hours holding 2%+ of
   human events, weekdays holding 5%+, offset chosen so the day centres on 13:00 local) and *off-hours*.

Then:

- **Excess** is queue time beyond the transition's **75th percentile of human queue waits** (configurable 50/75/90),
  or beyond a configured target. Off-hours, batch, instant and planned time are never excess.
- **Stuck cases:** each wait counts toward the excess ranking only up to the transition's 95th percentile (20+ human
  waits); the remainder is reported as stuck time and a count, so a few forgotten cases can't outrank a step that is
  slow every day. Money allocation still uses the full time.
- **People** are measured against their peers' 75th percentile, each wait counted up to the person's own 95th.
- **Money:** capital and per-day costs use calendar time beyond the transition's calendar 75th percentile (cash is
  tied up overnight too); time-rule losses are allocated by queue excess, else batch waits, never planned waits.
- **Filtering** reuses the full log's context, so a batch of 50 filtered to one vendor is still a batch.
- **With lifecycle starts,** a wait ends at the start, and processing time is reported separately.

Corrections are stored per dataset in `datasets.analysis_settings` (members read, editors write) and parsed with
`parseAnalysisSettings`.

## Consequences

- On BPIC 2020 Domestic, administration approval stays second, but now for a real reason: 1 in 5 human approvals
  waits more than a working day against a usual 15 minutes. Off-hours (150k h) no longer counts; 55% are flagged
  automatic; 184 stuck approvals are set apart.
- On the permit log, trip starts and ends are detected as planned dates; their waits are listed, never priced.
- Payment runs show up as a batch lever ("Payment Handled: 1.8 runs a week, 50 cases a run").
- **Limits:** one calendar per log (a multinational's SAP log learns a 20-hour day; per-resource calendars would fix
  this); resource contention and prioritization can't be told apart without start times; detection thresholds are
  heuristics, so the panel shows its evidence and lets people correct it.
