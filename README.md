# Throughline

**Process discovery for operations teams.** Upload an event log exported from your ERP, ticketing or finance system and see how work *actually* flows: the happy path, every variant, where cases wait, which business rules are broken, and what it all costs, explained in plain language by Claude.

> Built as a portfolio project for a Forward Deployed Engineer role. The demo follows a fictional engagement with **Meridian Advisory**, a professional-services firm whose invoice approvals take too long. See [`docs/discovery-notes.md`](docs/discovery-notes.md).

| | |
|---|---|
| **Discovery** | Celonis-style process map (directly-follows graph) with frequency and waiting-time overlays, activity/path sliders, happy-path highlight, variant explorer |
| **Diagnosis** | Bottlenecks ranked by cost of delay: slow transitions, slow resources, rework loops |
| **Compliance** | Business rules a controller recognises: four-eyes, approval thresholds, SLAs, duplicate payments |
| **Advanced mining** | Inductive Miner → BPMN and token-replay conformance via a pm4py worker |
| **AI** | Grounded findings, an "ask your process" agent, and an opportunity memo with a go/no-go call |

Status: **Day 1 of 7**. Engine, synthetic data and database schema are done; the web app is next. See [Roadmap](#roadmap).

---

## Getting Started

### Prerequisites

- Node.js ≥ 20 (developed on 24)
- Docker Desktop, for the local Supabase stack
- Python 3.12 + [uv](https://docs.astral.sh/uv/), only for the pm4py worker in `src/miner`

### Install & test

```bash
npm install
npm test          # engine unit tests + ground-truth tests on synthetic data
npm run typecheck
```

### Generate the demo dataset

```bash
npm run datagen   # writes data/sample/meridian-invoices.csv (+ ground truth JSON)
```

Options: `npm run datagen -- --cases 20000 --seed 1`.

### Local database

```bash
npm run db:start  # starts Postgres, Auth, Storage in Docker and applies migrations
npm run db:test   # pgTAP row-level-security tests
```

---

## Architecture Overview

```
src/
  engine/    @throughline/engine: pure TypeScript process-mining engine (no I/O)
  datagen/   @throughline/datagen: synthetic event logs with injected, known problems
  web/       Next.js app: upload, process explorer, rules, AI panel        (Day 2+)
  miner/     Python FastAPI + pm4py worker: Inductive Miner, conformance   (in progress)
supabase/
  migrations/  schema, row-level security, storage buckets and policies
  tests/       pgTAP tests proving tenants cannot see each other's data
docs/          discovery notes, functional architecture, benefit sizing, ADRs, handover pack
data/sample/   generated demo log (third-party datasets are downloaded, never committed)
```

### How a log becomes insight

```
CSV / XLSX / XES ──► column mapping ──► buildLog() ──► dictionary-encoded EventLog
                                                         │
             ┌───────────────┬───────────────┬───────────┴───────┬─────────────────┐
             ▼               ▼               ▼                   ▼                 ▼
      buildProcessMap  computeVariants  analyzeBottlenecks  evaluateRules     pm4py worker
      (DFG + sliders)  (variant table)  (cost of delay,     (four-eyes, SLA,  (BPMN, token
                                         rework, resources)  duplicates…)      replay)
                                                         │
                                                         ▼
                                     metrics bundle with stable IDs ──► Claude
                                     (findings cite IDs; the server checks every citation)
```

### Engine design choices

- **Dictionary-encoded log.** Activities and resources are interned to integers, timestamps are epoch ms. The DFG hot loop uses dense typed arrays, not string-keyed maps. On 20k cases / 151k events: process map ≈ 230 ms, filters ≈ 10 ms, full bottleneck analysis ≈ 380 ms (Node 24, M-series). It runs in a Web Worker in the browser.
- **Activity sliders project the log** (hidden activities are bridged, not left as gaps), and path sliders always keep each node's strongest in/out edge. This matches how Disco and Celonis behave.
- **Every money figure is traceable** to a `CostModel` the user can see and edit: hourly rate, handling minutes per activity, cost of delay per case-day, and wait targets per transition.
- **Stable metric IDs** (`edge:Match to Engagement → Partner Approval`, `resource:Partner Approval@P. Moreau`, `rework:Match to Engagement`) let AI output cite numbers that the server can verify.
- **Tested against ground truth.** The synthetic generator records exactly which cases it broke. Tests assert the engine finds the slow approver, the rework loop and *exactly* the injected rule violations.

### Data & security

Multi-tenant from day one: every table carries a `workspace_id` and is protected by row-level security (owner / analyst / viewer). Storage objects live under `<workspace_id>/<dataset_id>/…` with matching policies. The Claude API key stays on the server.

---

## Roadmap

| Milestone | Scope | Status |
|---|---|---|
| M0 Foundation | Repo, CI, schema + RLS, synthetic data, engine, pm4py worker | ✅ |
| M1 Correct numbers | Labour / time / compliance cost model, business-hours waits, attribute root-cause analysis, engine-vs-pm4py cross-check | 🚧 |
| M2 Data in | Upload, column mapping, data-quality report, event loading | |
| M3 See the process | Process Explorer, Variant Explorer, cost views, rules, case drilldown | |
| M4 Proven on real data | BPI Challenge 2020 / 2019 validation | |
| M5 Decide | Grounded Claude findings, "ask your process" agent, opportunity memo | |
| M6 Ship | Deploy, e2e tests, FDE docs, demo video | |

See [docs/build-plan.md](docs/build-plan.md) for positioning against Celonis and similar tools.

## License

[MIT](LICENSE) © 2026 Sage Edwards

The pm4py worker (`src/miner`) depends on [pm4py](https://pm4py.fit.fraunhofer.de/), which is AGPL-3.0. Throughline's own code stays MIT, but a deployed worker carries AGPL obligations; see [src/miner/README.md](src/miner/README.md#licensing).
