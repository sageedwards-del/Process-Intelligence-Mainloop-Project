# Plan: "Throughline": a process discovery app (portfolio project for the Mainloop FDE role)

## Context
Sage is applying for Mainloop's Forward Deployed Engineer role. The job: go on site, map how a business process really runs, find pain points, **size the cost**, write a functional architecture, build a prototype with coding agents, then hand it over or write a reasoned "no." Clients are professional-services firms with manual approvals, invoice cycles and reconciliations.

The project is a web app where a user signs in, uploads an event log, and gets:
- a Celonis-style process map,
- bottlenecks ranked by cost,
- business-rule violations,
- Claude-written findings, a Q&A agent, and an opportunity memo.

The repo also contains the FDE documents Mainloop asks for (functional architecture, benefit sizing, handover pack) and a visible Claude Code setup. The primary user is an ops or finance manager, not a process-mining analyst, so business impact comes first and algorithm depth second.

**Decisions made:** hybrid engine (TypeScript core + Python pm4py worker), Next.js full-stack, Supabase, Claude features = bottleneck findings + Q&A agent + opportunity memo, timeline about 1 week.
**Name:** "Throughline" is a placeholder and can be renamed. **License:** MIT, Sage Edwards, 2026.

## Status (keep this section current)
_Last updated: 2026-11-01_

**Done: Day 1** (committed and pushed, CI green)
- `src/engine`: log model, DFG, process map, variants, filters, bottlenecks, rules, summary/trend; 28 tests.
- `src/datagen`: Meridian invoice-approval generator + ground-truth tests (8). Sample in `data/sample/`.
- Supabase schema + RLS + storage policies; pgTAP RLS tests pass locally (11).
- Not yet done from the Day 1 row: **auth UI**. It moves to Day 2 together with the Next.js scaffold.

**In progress:** `src/miner` (pm4py worker), built in a separate session. Verify its pytest/Docker build, then commit it on its own.

**Next: Day 2.** Scaffold `src/web` (Next.js App Router, Tailwind, shadcn/ui) as a new npm workspace; Supabase auth (magic link); upload → column mapping → data-quality report → event loading + snapshot.

**Deviations from the original plan**
- npm workspaces instead of pnpm (pnpm isn't installed).
- Local Docker is Colima; Supabase analytics/realtime disabled.
- Engine perf on 20k cases / 151k events: process map ~230 ms, filter ~10 ms, full bottleneck analysis ~380 ms (above the 300 ms target; runs in a Web Worker, revisit if it feels slow).

## Repository layout (follows the `scaffold-builder` skill: README, .gitignore, LICENSE, all source in `src/`)
Folder `throughline/`, set up as an npm workspace:
```
throughline/
  README.md                 Getting Started + Architecture Overview, screenshots, live demo link
  LICENSE  .gitignore  package.json  pnpm-workspace.yaml  CLAUDE.md
  .claude/skills/           project skills (e.g. add-mining-metric, run-demo-seed)
  .github/workflows/ci.yml  lint, typecheck, vitest, pytest, playwright
  supabase/migrations/      SQL schema + RLS policies;  supabase/seed.sql
  docs/
    discovery-notes.md          fictional client "Meridian Advisory" invoice-approval engagement
    functional-architecture.md  actors, flows, rules, data, decision points (Mainloop's own format)
    benefit-sizing.md           cost model and formulas
    handover-pack.md            run, operate, extend, known limits
    adr/                        0001-hybrid-engine, 0002-supabase, 0003-claude-grounding
  src/
    engine/    pure TS package @throughline/engine (no I/O), Vitest
    web/       Next.js App Router app (TS, Tailwind, shadcn/ui)
    miner/     Python 3.12 FastAPI + pm4py worker (Dockerfile, pytest)
    datagen/   synthetic event-log generator with known injected problems
```

## Data model (Supabase Postgres, every table protected by RLS on workspace membership)
- `workspaces`, `workspace_members(user_id, role)`: multi-tenant from day one
- `datasets`: name, storage path of the raw file, `column_mapping jsonb`, status (uploaded → parsing → ready / error), summary stats
- `events(dataset_id, case_id, activity, ts timestamptz, resource, attrs jsonb)`, index `(dataset_id, case_id, ts)`, loaded in batches
- `cost_settings`: hourly rate per resource or role, plus currency
- `rules`: business-rule definitions as JSON
- `ai_outputs`: findings and memos, cached by `(dataset_id, filter_hash, kind)`
- Storage buckets: `raw-uploads`, plus `snapshots` holding a compact dictionary-encoded log per dataset (gzipped JSON) so the browser loads quickly
- Supabase Auth: email magic link, plus a seeded read-only demo account

## Mining engine: `src/engine` (TypeScript, pure functions, fully unit-tested)
- **Log model:** dictionary-encoded traces (activity and resource IDs → ints), timestamps in epoch ms
- **Directly-follows graph** with frequency and performance per edge (count, median, mean, p90 wait), plus start/end nodes
- **Celonis-style sliders:** top-k activities and paths by frequency, without leaving disconnected nodes. The map opens on the happy path.
- **Variants:** count, % of cases, median throughput time; sortable
- **Case metrics:** throughput-time distribution, rework (repeated activities, loops), steps per case
- **Filters:** time range, attribute equals/in, variant selection, throughput-time range, "case passes through activity X"
- **Bottleneck scoring:** total waiting hours per edge/activity = wait × frequency. Cost impact = hours × rate from `cost_settings`, ranked, and every number traceable to its inputs.
- **Rule engine (JSON rules):**
  - precedence (A before B, e.g. "goods receipt before payment")
  - segregation of duties (same resource on A and B)
  - conditional ("amount > 10k requires activity Second Approval")
  - SLA (max duration A→B)
  - duplicates (same vendor + amount + date)
  - Returns the violating cases.
- Runs in a **Web Worker** in the browser so filtering stays instant. The same package runs server-side for the AI tools.

## pm4py worker: `src/miner` (Python, FastAPI, Docker, deployed on Fly.io or Render)
- Verifies the Supabase JWT and reads the dataset through a signed Storage URL
- `POST /discover/inductive` → BPMN XML (+ process tree), shown in the UI with **bpmn-js**
- `POST /conformance/token-replay` takes a reference model, either an uploaded BPMN or one discovered from selected "happy" variants. Returns fitness per case and the conformance rate over time.
- `POST /import/xes` → normalized events (IEEE XES files; CSV/XLSX are parsed in TS)
- Pin the pm4py version at build time (check PyPI). Stretch goal: expose the worker to the agent through `pm4py-mcp`.

## Web app: `src/web` (Next.js)
1. **Upload:** CSV/XLSX (Papa Parse; SheetJS installed from cdn.sheetjs.com, not the outdated npm package) and XES (through the worker)
2. **Column mapping:** heuristic auto-detect plus a data-quality report (missing timestamps, unparseable dates, single-event cases)
3. **Process Explorer:** React Flow (`@xyflow/react`) with ELK.js layered layout. Edge width shows frequency, colour shows wait time, KPI toggle (frequency / median / p90 / cost), activity and path sliders, happy-path highlight.
4. **Variant Explorer:** table plus mini trace strips; selecting a variant filters the map
5. **Bottlenecks:** ranked cost-impact list, wait-time histogram per edge, throughput trend over time (charts built following the `dataviz` skill)
6. **Rules & Conformance:** rule builder, violations with case drilldown, pm4py conformance tab, BPMN tab
7. **Case drilldown:** timeline of one case's events
8. **AI panel:** Findings, Ask, and Memo tabs (below)

## Claude features (`@anthropic-ai/sdk`, server routes only, key never sent to the client)
Check the `claude-api` skill before writing this code (current model IDs, structured outputs, prompt caching, streaming). Default model Sonnet 5.5; Opus 5.5 for the memo.
- **Bottleneck findings:** the server computes a metrics bundle (top bottlenecks, variants, rule violations, cost settings) with a stable ID on each metric. Claude returns structured JSON findings: title, cited metric IDs, likely causes, confidence, what to check next. **Grounding check:** reject or flag any finding that cites a missing metric ID or a number that doesn't match. The prompt states that event logs show *where* cases wait, not *why*.
- **"Ask your process" agent:** a tool-use loop with tools `get_overview`, `get_process_map(filter)`, `list_variants`, `get_bottlenecks`, `compare_segments(attribute)`, `get_case`, `check_rule`, `run_conformance`. Streamed answers, tool calls shown in the UI for transparency, an iteration cap, and a per-user rate limit.
- **Opportunity memo:** the FDE deliverable. It covers:
  - current state
  - top 3 opportunities, each with annual savings (formula and editable assumptions shown)
  - fix or automation approach
  - risks
  - an explicit go/no-go recommendation, where "not worth it" is allowed
  - Export as Markdown and as a print-styled PDF.

## Demo data
- `src/datagen`: synthetic professional-services **invoice approval** log (about 5k cases) with known injected problems:
  - one partner causes approval delays
  - a price-change → re-invoice rework loop
  - segregation-of-duties violations
  - missed early-payment discounts
  - Tests assert that the engine finds every one of them.
- Import script for a **BPI Challenge 2019** subset (real SAP-style purchase-to-pay data, 4TU). **Check its license on the 4TU record before committing any data.** Otherwise download it at seed time.

## One-week schedule (with fallback options)
| Day | Work |
|---|---|
| 1 | Scaffold repo + CI; Supabase schema, RLS, auth; datagen; engine log model + DFG + variants, with tests (start with Case #1–3 from your notes) |
| 2 | Upload, column mapping, data-quality report, event loading, snapshot build |
| 3 | Process Explorer (React Flow + ELK, sliders, KPI toggle), Variant Explorer, filters in a Web Worker |
| 4 | Bottleneck scoring + cost settings, histograms and trends, rule engine + violations UI, case drilldown |
| 5 | Claude findings (with grounding check) and the Ask agent |
| 6 | pm4py worker (Inductive → BPMN, token replay, XES), opportunity memo, deploy to Vercel + Fly/Render + Supabase |
| 7 | FDE docs, Playwright e2e, README with screenshots and a 2-min demo video, polish |

**If behind schedule:** reduce the pm4py worker to Inductive → BPMN only; move segment comparison and the memo PDF to "next steps" in the handover pack.

## Verification
- `pnpm test`: engine unit tests. Hand-computed small logs; datagen ground truth (each injected problem is detected and ranked in the top 3); rule-engine cases.
- `pytest src/miner`: Inductive Miner returns valid BPMN for the synthetic log; token replay gives fitness 1.0 on happy-path cases and below 1 on rework cases.
- `pnpm e2e` (Playwright, against local Supabase via `supabase start`): sign in → upload synthetic CSV → map columns → map renders → variant filter changes edge counts → bottleneck list shows the injected partner delay → findings return, pass the grounding check, and their metric IDs resolve.
- RLS test: user B cannot read user A's dataset (SQL test in `supabase/tests`).
- Performance check: BPI 2019 subset (~20k cases) loads and filtering responds in under 300 ms in the browser.
- Manual pass on the deployed demo account in the in-app browser, including phone width.
