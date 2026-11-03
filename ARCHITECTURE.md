# Architecture

How Throughline ("Process Discovery Engine *for Mainloop*") is put together. What's built and what's next lives in
[`docs/build-plan.md`](docs/build-plan.md) (Status section); the reasons behind the big choices are in
[`docs/adr/`](docs/adr). This file describes the system as it is through M6 (deployment-ready; hosting in [`docs/deployment-plan.md`](docs/deployment-plan.md)).

## The four parts

| Part | Where | Runs | Job |
|---|---|---|---|
| Engine | `src/engine` (`@throughline/engine`) | Browser Web Worker and Node server | Pure TS process mining: ingest, log model, DFG and process map, variants, filters, waits, bottlenecks, cost, rules, root causes |
| Web app | `src/web` (`@throughline/web`) | Next.js 16 (App Router, Turbopack, `cacheComponents`) | Sign-in, upload, explorer, settings, Claude routes |
| Miner | `src/miner` (`throughline_miner`) | Python 3.12, FastAPI, pm4py 2.7.23.11 | Inductive Miner → BPMN, token-replay conformance, XES import |
| Database | `supabase/` | Supabase Postgres, Auth, Storage | Workspaces, datasets, settings, rules, AI outputs; RLS on everything |

`src/datagen` (`@throughline/datagen`) generates the Meridian invoice-approval sample with injected problems and the
ground truth the tests check against. It is a build-time tool, not part of the running system.

```
Browser ───────────────────────────────────────────────┐
  Uploader (CSV: Papa Parse, XLSX: read-excel-file)     │
  Explorer UI ◄──► explorer.worker.ts (engine)          │  supabase-js under RLS
  AI panel                                              │
        │ fetch                                         ▼
Next.js server                                     Supabase
  proxy.ts (session refresh, /app gate)              Postgres (RLS) · Auth (magic link) · Storage
  Server Components / Server Actions                   raw-uploads/<ws>/<id>/source.*
  /api/import/xes ──► Miner /import/xes/url ◄──signed URLs──► Storage
  /api/miner/[target]/{model,conformance} ──► Miner     snapshots/<ws>/<id>/log.json.gz
  /api/ai/[target]/{insights,ask,memo} ──► Claude API
        └── lib/analysis/analyse.ts (engine, same figures as the worker)
```

## Engine (`src/engine`)

- **No I/O, no DOM, no Node APIs.** Every function is pure and returns new objects; nothing mutates an `EventLog` or
  caller input. This is what lets one package run in the worker and on the server.
- **Log model** (`log.ts`, `types.ts`): activities and resources are interned to integers, timestamps are epoch ms.
  Lifecycle start/suspend/resume/complete/abort are paired (`pairLifecycle`), giving per-event start (`s`) and processing
  time (`p`); aborted work is kept on `Case.aborted`.
- **Ingest** (`ingest.ts`, `tables.ts`): `guessMapping`, timestamp-format detection (flags ambiguous day/month),
  `ingestTable` → events plus a data-quality report; `tableFromGrid` / `tableFromRecords` for Excel and XES input.
- **Discovery** (`dfg.ts`, `processMap.ts`, `variants.ts`): DFG with per-edge wait statistics on dense typed arrays
  (`computeDfgWithDurations`); activity/path sliders project the log rather than leaving gaps.
- **Filters** (`filters.ts`): `CaseFilter` (time range, attribute, passes/skips activity, variant, explicit cases,
  slow cases).
- **Waits and cost** (`waits.ts`, `calendar.ts`, `bottlenecks.ts`, `costSettings.ts`): waits are classified as queue,
  off-hours, batch, planned date or automatic (ADR 0003). Only working-hours queue time beyond the 75th percentile of human
  waits counts as excess. Money comes only from `CostModel` (ADR 0002): labour (rework and cost to serve, TDABC), time
  (rule consequences allocated over the case's waits, optional working capital) and compliance (rule impacts × recovery).
- **Rules** (`rules.ts`): precedence, segregation of duties, conditional, SLA, duplicates and flags, each priced with a
  formula string.
- **Root causes** (`rootCause.ts`): segments ranked by excess outcome cases with n, lift, z and small-sample flags.
  Correlation, never causation.

Tests run in Vitest (`src/engine/test`); `src/datagen/test/groundTruth.test.ts` asserts every injected Meridian problem
is found; `src/miner/tests/test_engine_parity.py` checks the engine's DFG against pm4py on the sample fixtures.

## Web app (`src/web`)

Read `src/web/AGENTS.md` before writing Next code: this Next.js differs from older versions (`proxy.ts` instead of
middleware, `cacheComponents`, `LayoutProps`).

| Route | What |
|---|---|
| `/` | Landing page. Hero map is the real Meridian map (engine + ELK, cached in `lib/heroMap.ts`); validation scorecard from `app/validation.ts` |
| `/engineering` | What's built, next and planned, and the data-flow diagram (`#data-flow`, `components/engineering/DataFlow.tsx`); copy in `app/engineering/content.ts` |
| `/sample` | Demo on real data: BPIC 2020 Domestic Declarations, a committed snapshot in `public/demo/` (built by `scripts/build-demo.ts`; config in `lib/analysis/demos.ts`) |
| `/sample/meridian` | Demo on the synthetic Meridian sample, generated in the worker |
| `/login`, `/auth/callback` | Magic-link sign-in (`signInWithOtp`, PKCE code → session cookie) |
| `/app` | The user's workspace and datasets |
| `/app/upload` | CSV / XLSX parsed in the browser; XES stored first, then imported by the miner via `/api/import/xes` |
| `/app/datasets/[id]` | Explorer on a stored snapshot (1-hour signed URL); RLS denial → 404 |
| `/app/settings` | Workspace cost settings (owners and analysts edit, viewers read) |
| `/api/import/xes` | Takes `{ datasetId }` for an XES file already in `raw-uploads`; signs a download URL for it and an upload URL for `xes.json.gz`, and has the miner import one into the other (`POST /import/xes/url`). Only small JSON passes through (Vercel caps function bodies at 4.5 MB) |
| `/api/miner/[target]/{model,conformance}` | A dataset's BPMN model (Inductive Miner infrequent, noise 0.2) or token-replay conformance against the most common variants covering half the cases (at most three). Reads the snapshot as the user, sends contract events to the miner, trims the result (`lib/miner/contract.ts`). The demos' results are committed JSON (`lib/miner/demo-outputs/`, built by `scripts/build-miner-demos.mts`) |
| `/robots.txt`, `/sitemap.xml` | Public pages only; `/app`, `/login`, `/auth`, `/api` are noindex (`X-Robots-Tag`); `SITE_NOINDEX=1` hides everything |
| `/api/ai/[target]/{insights,ask,memo}` | Claude routes; `target` is a dataset id or a demo (`bpic2020`, `meridian`; `sample` = Meridian). A demo's insights and memo are committed JSON in `lib/ai/demo-outputs/` (generated once, re-grounded by `test/demoOutputs.test.ts`), readable without sign-in and never regenerated in production; Ask on a demo needs sign-in |

**Upload path.** The browser maps columns, shows the quality report, then writes as the user under RLS: a `datasets`
row → raw file to `raw-uploads/<ws>/<id>/source.{csv,xlsx,xes,xes.gz}` → gzipped snapshot `{ version, log }` to
`snapshots/<ws>/<id>/log.json.gz` (`lib/snapshot.ts`, version 2; decoding stops at 256 MB decompressed) → stats and status `ready`.
For XES the row (status `uploaded`) and raw file come first, the miner writes the imported events to
`raw-uploads/<ws>/<id>/xes.json.gz`, and the browser reads them back; an abandoned XES upload deletes its row and files.
One upload limit, 50 MB, holds across the page (`lib/uploadLimit.ts`), the buckets, hosted Supabase and the miner.

**Security headers** (`next.config.ts`): CSP without nonces (nonces would force every page to render per request and
drop the `cacheComponents` static shells, so inline scripts stay allowed; connections are limited to this origin and
Supabase), `frame-ancestors 'none'`, nosniff, Referrer-Policy, HSTS, Permissions-Policy. The `events` table exists
but isn't filled; the snapshot is what everything reads.

**Explorer.** `lib/explorer/explorer.worker.ts` loads and decodes the snapshot and runs `detectWaitContext` once on the
whole log (learned calendar, planned-date steps, batch runs, system resources). It keeps the base and filtered logs; on
every filter change it re-runs `analyse()` (summary, variants, priced bottlenecks with wait classification, rules,
slowest cases). The map is a separate `view` message, sent on filter or slider changes: `buildProcessMap`, then ELK
(layered, top to bottom, orthogonal routes). Messages are typed in `lib/explorer/protocol.ts`. The
map is our own SVG (`components/explorer/ProcessMapView.tsx`), not React Flow. Every money figure carries a formula
string built from the `CostModel`.

**Shared analysis.** `lib/analysis/analyse.ts` is the one place the explorer's figures are computed, so the worker and the
Claude routes see identical numbers and formulas.

## Claude (`src/web/lib/ai/`, ADR 0005)

Server-side only; the key is `ANTHROPIC_API_KEY` and never reaches the client bundle.

1. `metrics.ts` turns an `Analysis` into a bundle keyed by metric ID (`edge:A → B`, `resource:Activity@Name`,
   `rework:Activity`, `labour:Activity`, `segment:…`, `batch:Activity@Resource`, `rule:id`, `capital:total`,
   `overview`; Ask's tools add `variant:N` and `case:ID`). Each metric has typed figures, its formula and caveat notes.
2. Claude cites `[[metric id]]` inline. `grounding.ts` checks every ID exists and every number in the sentence (or its
   paragraph, if the sentence cites nothing) matches a cited figure at the precision written.
3. Fail closed: failing text goes back once with the reasons, then is dropped. Nothing unchecked is shown or stored.
4. Insights (a process summary plus 3–5 recommended actions, each with evidence, expected impact, first steps and what to verify) and Ask use Sonnet 5.5; the memo uses Opus 5.5. The memo's money is sized in code as annual cost ×
   addressable share, only from `rule:`, `rework:`, `labour:` and `capital:total`.
5. Ask (`ask.ts`) is a tool loop over the engine (`get_overview`, `get_bottlenecks`, `check_rules`,
   `find_root_causes`, `get_case`); IDs under a filter carry it (`edge:A → B | amount ≥ 10000`).
6. Outputs are cached in `ai_outputs`, keyed by a hash of snapshot + cost settings + rules + wait settings. Sample
   outputs live in server memory.
7. Cost control (`claude.ts`, migration `20261105000000`): before the first model call each request reserves its
   `ai_usage` row through `reserve_ai_request()`, a SECURITY DEFINER function that takes one advisory lock, counts and
   inserts, so parallel requests can't all slip under a limit and a request killed at `maxDuration` still counts.
   Limits: 30 requests per user per hour, and `AI_DAILY_LIMIT` (default 300) per 24 hours across all users, since
   magic-link sign-up gives every new email a fresh hourly limit. Over a limit the row is stored as `refused` (not
   counted) and the route returns 429. At the end `finish_ai_request()` fills in the token counts; users have no UPDATE
   on `ai_usage`, so they can't move rows out of the window. If usage can't be counted, Claude isn't called (503).
   The Anthropic Console spend limit is the backstop (set by hand; see `docs/build-plan.md`).

Metric IDs are a contract between `metrics.ts`, the prompts and `grounding.ts`; don't change their format casually.

## Miner (`src/miner`)

FastAPI app built by `create_app()` in `throughline_miner/main.py`. Endpoints: `GET /health`,
`POST /discover/inductive`, `POST /conformance/token-replay`, `POST /import/xes`, `POST /import/xes/url` (fetch an XES
by signed URL, PUT the gzipped import to a signed upload URL). It verifies the Supabase JWT (JWKS via
`SUPABASE_URL`, or `SUPABASE_JWT_SECRET` for HS256; `AUTH_DISABLED=1` only for local work), takes events inline or by
an allow-listed signed `events_url`, and enforces `MAX_EVENTS` (250k), `MAX_PAYLOAD_BYTES` (50 MB, the one upload
limit) and `MAX_XES_UNCOMPRESSED_BYTES` (512 MB). `ENVIRONMENT=production` refuses to start with `AUTH_DISABLED`,
`ALLOW_HTTP_URLS` or an empty `EVENTS_URL_ALLOWED_HOSTS`. Only Next.js server code calls it, so it needs no CORS.
The web app uses `/import/xes/url`, `/discover/inductive` and `/conformance/token-replay`.

**Licence.** pm4py is AGPL-3.0 (ADR 0004, Accepted): a public miner must offer its source to users. Throughline's own
code is MIT.

## Database (`supabase/`)

Tables: `workspaces`, `workspace_members(role: owner | analyst | viewer)`, `datasets`, `events` (unused so far),
`cost_models` (one default per workspace, optional per dataset), `rules`, `saved_views`, `ai_outputs`, `ai_usage`
(insert-only for users; reserved and finished through definer functions, see Claude above).
Every table has `workspace_id` and RLS: members read, editors (owner, analyst) write, via `is_workspace_member()` and
`can_edit_workspace()`. Storage objects sit under `<workspace_id>/<dataset_id>/…` with matching policies. A signup
trigger creates each user's workspace. pgTAP tests in `supabase/tests/` (`npm run db:test`). Never edit an applied
migration; add a new one.

## Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web | Publishable key (safe in the browser; RLS does the protecting) |
| `NEXT_PUBLIC_SITE_URL` | web | Base for magic-link redirects |
| `MINER_URL` | web, server only | Unset → XES upload says the service isn't available |
| `ANTHROPIC_API_KEY` | web, server only | Unset → the AI panel says the AI isn't set up. Never `NEXT_PUBLIC_` |
| `ALLOW_DEMO_REGENERATION` | web, development only | `1` lets a signed-in user regenerate the demos' committed insights and memo (written to `lib/ai/demo-outputs/`); ignored in production |
| `VERCEL_GIT_COMMIT_SHA` | web (set by Vercel) | The footer's Source link points at this commit (`lib/site.ts`), which is also the miner's AGPL source offer; `main` when unset |
| `AI_DAILY_LIMIT` | web, server only | AI requests per 24 hours across all users (default 300); over it, every AI route returns 429 until the window moves |
| `SITE_NOINDEX` | web | `1` keeps the whole site out of search engines (robots.txt disallows all, `X-Robots-Tag` on every page) |
| `VERCEL_URL` | web (set by Vercel) | `metadataBase` and the sitemap fall back to it on previews when `NEXT_PUBLIC_SITE_URL` is unset |
| `SUPABASE_URL` / `SUPABASE_JWT_SECRET` | miner | JWT verification |
| `MAX_PAYLOAD_BYTES`, `MAX_EVENTS`, `MAX_XES_UNCOMPRESSED_BYTES`, `EVENTS_URL_ALLOWED_HOSTS` | miner | Limits and the host allowlist for every signed URL it fetches or writes |
| `ENVIRONMENT` | miner | `production` refuses unsafe settings at startup |
| `ALLOW_HTTP_URLS` | miner, local only | `1` accepts http storage URLs (local Supabase is http on 127.0.0.1) |
| `SOURCE_URL` | miner | Reported by `/health`; the AGPL source offer (ADR 0004) |

Local values: `src/web/.env.example`. Hosted values, secrets and who sets them: `docs/deployment-plan.md`.

## Backups

Postgres: `.github/workflows/backup.yml` dumps roles, schema and data nightly, GPG-encrypted, as a 30-day workflow
artifact (secrets `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE`). Restore: `docs/handover-pack.md`. Storage isn't backed up on
the Free plan; users keep their source files.

## Decisions

| ADR | Decision |
|---|---|
| [0001](docs/adr/0001-hybrid-mining-engine.md) | Hybrid engine: interactive mining in TS, heavy algorithms in pm4py |
| [0002](docs/adr/0002-cost-model.md) | Cost model: waiting is priced only through its consequences |
| [0003](docs/adr/0003-waiting-time-classification.md) | Wait classification: only queue time counts as excess |
| [0004](docs/adr/0004-pm4py-licence.md) | pm4py is AGPL-3.0: accept it for the miner, offer the source (Accepted) |
| [0005](docs/adr/0005-claude-grounding.md) | Code decides whether Claude's text is shown |
