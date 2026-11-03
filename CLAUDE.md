# Throughline: notes for Claude Code

Process-discovery web app. npm workspaces monorepo; all source in `src/`.

**Read `docs/build-plan.md` first.** It holds the full plan, positioning, the milestones, and a Status section saying what's done and what's next. Update that Status section when you finish a chunk of work.

Then, as the task needs: `ARCHITECTURE.md` (the four parts, data flow, routes, Claude pipeline, env vars, ADR index) and `DESIGN.md` (tokens, type, layout, map, phone width, copy). Keep both in step when you change what they describe.

## Layout
- `src/engine`: pure TS process-mining engine. **No I/O, no DOM, no Node APIs**; it must run in a browser Web Worker and on the server.
- `src/datagen`: synthetic logs with injected problems + ground truth. Changing injection logic means updating `test/groundTruth.test.ts`.
- `src/miner`: Python FastAPI + pm4py worker. Own toolchain (uv, ruff, pytest). pm4py is AGPL-3.0 (ADR 0004): a public miner needs a user-visible source link. Called only from Next server code; large files reach it through Storage signed URLs, never through a Next route (Vercel's 4.5 MB body limit). Locally: `SUPABASE_URL=http://127.0.0.1:54321 ALLOW_HTTP_URLS=1 EVENTS_URL_ALLOWED_HOSTS=127.0.0.1 uv run uvicorn --factory throughline_miner.main:create_app --port 8010` and `MINER_URL=http://127.0.0.1:8010`.
- `src/web`: Next.js 16 app (App Router, Turbopack, Tailwind 4, `cacheComponents`). **Read `src/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next code**; APIs differ from older versions.
- `supabase/migrations`: never edit an applied migration; add a new one.

## Commands
- `npm test`, `npm run typecheck`, `npm run lint`: run all before calling a change done (`npm test` includes the web package's grounding tests).
- `npm run dev`: the web app on :3000 (first `cp src/web/.env.example src/web/.env.local`; sign-in emails land in local Mailpit at http://127.0.0.1:54324) (`npm run build -w @throughline/web` for a production build).
- `npm run datagen`: regenerate `data/sample/`.
- `npm run db:start` / `npm run db:test`: local Supabase + pgTAP RLS tests (needs Docker).
- `npm run e2e`: Playwright against local Supabase (reuses a dev server on :3000, drives the installed Chrome; the XES/BPMN test skips without a miner on `MINER_URL`).
- Deploying: `docs/deployment-plan.md`; operating and extending: `docs/handover-pack.md`.

## Local environment
- Docker runs via **Colima** (`colima start --cpu 4 --memory 8`), not Docker Desktop. Supabase `analytics` and `realtime` are disabled in `supabase/config.toml`: analytics needs the Docker Desktop socket path, and neither is used.
- GitHub auth goes through the `gh` CLI (`gh auth setup-git`); use `gh` for PRs and CI status.
- Package manager is **npm** workspaces (pnpm isn't installed). Node ≥ 22.12 (Vitest 5).

## Conventions
- Engine functions are pure and return new objects; never mutate an `EventLog` or caller input.
- Relative imports in TS packages use the `.ts` extension (`./dfg.ts`): Turbopack can't map `.js` to `.ts`, and `.ts` also works in Vitest, tsx and Node's type stripping.
- Design: follow `DESIGN.md`. Light and editorial throughout (dot grid, near-black type). Colours are tokens in `src/web/app/globals.css` (`--map-*` for the process map); teal = action, indigo gradient = emphasis and Claude-written output, monospace for figures and metric IDs. UI work isn't done until it's checked in the browser at desktop and 375 px with no horizontal scroll.
- Figures shown in the explorer and given to Claude both come from `src/web/lib/analysis/analyse.ts`; compute new ones there, not in the worker or a route.
- Site copy must only claim what's built: the Engineering page (`src/web/app/engineering/content.ts`) marks each capability done / next / planned.
- One upload limit (50 MB) in four places: `src/web/lib/uploadLimit.ts`, the bucket migration, hosted Supabase, the miner's `MAX_PAYLOAD_BYTES`. Change them together.
- Browser ↔ Next route bodies must stay under 4.5 MB (Vercel); move big data through Storage signed URLs.
- Activities are referenced **by name** in anything serialized (filters, rules, metric IDs); ids are internal.
- Every currency figure must derive from `CostModel` so the UI can show its formula. Waiting is priced only through its consequences (time rules, capital), and only queue time counts as excess (not nights, automatic steps, batch runs or planned dates); see `docs/adr/0002-cost-model.md` and `docs/adr/0003-waiting-time-classification.md` before changing how anything is priced or how waits are classified.
- Metric IDs (`edge:A → B`, `resource:Activity@Name`, `rework:Activity`, `labour:Activity`, `segment:attribute=value`, `segment:passes:Activity=yes|no`, `batch:Activity@Resource`, plus `rule:id`, `capital:total` and `overview`; Ask's tools also return `variant:N` and `case:ID`) are a contract with the AI grounding check (`src/web/lib/ai/grounding.ts`, ADR 0005). Don't change their format casually.
- Hot loops: prefer typed arrays and numeric keys over string-keyed Maps (see `computeDfgWithDurations`).
- Every table has `workspace_id` + RLS. New tables follow the "members read, editors write" pattern in the core migration.
- Claude API calls happen server-side only (`src/web/lib/ai/`, key in `ANTHROPIC_API_KEY`). Every AI request calls `reserve()` before its first model call and `recordUsage()` in a `finally` (per-user hourly limit plus the site-wide `AI_DAILY_LIMIT`, enforced in the database; users can't update `ai_usage`). Check the `claude-api` skill for current model IDs before touching AI code. Nothing Claude writes is shown until the grounding check passes; the memo's money is sized in code, only from `rule:`, `rework:`, `labour:` and `capital:total` metrics.
