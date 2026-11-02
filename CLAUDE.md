# Throughline: notes for Claude Code

Process-discovery web app. npm workspaces monorepo; all source in `src/`.

**Read `docs/build-plan.md` first.** It holds the full plan, positioning, the milestones, and a Status section saying what's done and what's next. Update that Status section when you finish a chunk of work.

## Layout
- `src/engine`: pure TS process-mining engine. **No I/O, no DOM, no Node APIs**; it must run in a browser Web Worker and on the server.
- `src/datagen`: synthetic logs with injected problems + ground truth. Changing injection logic means updating `test/groundTruth.test.ts`.
- `src/miner`: Python FastAPI + pm4py worker. Own toolchain (uv, ruff, pytest).
- `src/web`: Next.js 16 app (App Router, Turbopack, Tailwind 4, `cacheComponents`). **Read `src/web/AGENTS.md` and the bundled docs in `node_modules/next/dist/docs/` before writing Next code**; APIs differ from older versions.
- `supabase/migrations`: never edit an applied migration; add a new one.

## Commands
- `npm test`, `npm run typecheck`, `npm run lint`: run all before calling a change done.
- `npm run dev`: the web app on :3000 (first `cp src/web/.env.example src/web/.env.local`; sign-in emails land in local Mailpit at http://127.0.0.1:54324) (`npm run build -w @throughline/web` for a production build).
- `npm run datagen`: regenerate `data/sample/`.
- `npm run db:start` / `npm run db:test`: local Supabase + pgTAP RLS tests (needs Docker).

## Local environment
- Docker runs via **Colima** (`colima start --cpu 4 --memory 8`), not Docker Desktop. Supabase `analytics` and `realtime` are disabled in `supabase/config.toml`: analytics needs the Docker Desktop socket path, and neither is used.
- GitHub auth goes through the `gh` CLI (`gh auth setup-git`); use `gh` for PRs and CI status.
- Package manager is **npm** workspaces (pnpm isn't installed).

## Conventions
- Engine functions are pure and return new objects; never mutate an `EventLog` or caller input.
- Relative imports in TS packages use the `.ts` extension (`./dfg.ts`): Turbopack can't map `.js` to `.ts`, and `.ts` also works in Vitest, tsx and Node's type stripping.
- Design: light and editorial throughout (dot grid, near-black type). Colours are tokens in `src/web/app/globals.css` (`--map-*` for the process map); teal = action, indigo gradient = emphasis and Claude-written output, monospace for figures and metric IDs.
- Site copy must only claim what's built: the Engineering page (`src/web/app/engineering/content.ts`) marks each capability done / next / planned.
- Activities are referenced **by name** in anything serialized (filters, rules, metric IDs); ids are internal.
- Every currency figure must derive from `CostModel` so the UI can show its formula. Waiting is priced only through its consequences (time rules, capital); see `docs/adr/0002-cost-model.md` before changing how anything is priced.
- Metric IDs (`edge:A → B`, `resource:Activity@Name`, `rework:Activity`, `labour:Activity`, `segment:attribute=value`, `segment:passes:Activity=yes|no`) are a contract with the AI grounding check. Don't change their format casually.
- Hot loops: prefer typed arrays and numeric keys over string-keyed Maps (see `computeDfgWithDurations`).
- Every table has `workspace_id` + RLS. New tables follow the "members read, editors write" pattern in the core migration.
- Claude API calls happen server-side only. Check the `claude-api` skill for current model IDs before touching AI code.
