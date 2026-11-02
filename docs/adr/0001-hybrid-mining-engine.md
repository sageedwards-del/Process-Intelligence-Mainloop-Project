# ADR 0001: Hybrid mining engine (TypeScript core + pm4py worker)

- **Status:** Accepted
- **Date:** 2026-10-31

## Context

Users need two kinds of analysis:

1. **Interactive exploration:** dragging activity/path sliders, clicking a variant, applying filters. Each interaction recomputes the process map, so it must respond in well under a second, ideally a few hundred ms, without a server round trip.
2. **Formal analysis:** discovering a sound process model (Inductive Miner → BPMN), conformance checking against a reference model (token replay / alignments), and importing IEEE XES logs. These algorithms are complex, and a mature, widely used open-source implementation already exists: pm4py.

Building everything in Python would make every slider movement a network call. Building everything in TypeScript would mean re-implementing (and validating) Inductive Miner and alignments, which is weeks of work and a correctness risk.

## Decision

- A **pure TypeScript engine** (`src/engine`) covers everything interactive: log model, directly-follows graph, variants, filters, performance, bottleneck scoring and business-rule checks. It runs in a browser Web Worker and in Next.js server routes (the AI tools call the same functions).
- A **Python pm4py worker** (`src/miner`, FastAPI, deployed separately) covers Inductive Miner → BPMN, token-replay conformance and XES import. It is called from Next.js server routes with the user's Supabase JWT.

## Consequences

- Interactions stay instant, and the business-facing numbers (bottlenecks, rule violations, costs) come from code we own and test against ground truth.
- We reuse a proven library for the hard algorithms instead of rebuilding it ("check the portfolio before building").
- Two runtimes and two deploys. We mitigate this with a shared event contract (`case_id, activity, timestamp, resource, …attributes`), a CI job per runtime, and a worker that is optional: the app degrades gracefully, hiding the BPMN and conformance tabs, when the worker is unavailable.
- ~~pm4py is GPL-3.0. Running it as a separate network service keeps the main app's MIT license clean. Revisit this if the worker is ever distributed with the app.~~ pm4py has been AGPL-3.0 since 2.7.12 (November 2024), and its network clause applies to the deployed worker; see ADR 0004.
