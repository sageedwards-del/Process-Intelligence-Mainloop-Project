# Throughline: notes for Claude Code

Process-discovery web app. npm workspaces monorepo; all source in `src/`.

## Layout
- `src/engine`: pure TS process-mining engine. **No I/O, no DOM, no Node APIs**; it must run in a browser Web Worker and on the server.
- `src/datagen`: synthetic logs with injected problems + ground truth. Changing injection logic means updating `test/groundTruth.test.ts`.
- `src/miner`: Python FastAPI + pm4py worker. Own toolchain (uv, ruff, pytest).
- `supabase/migrations`: never edit an applied migration; add a new one.

## Commands
- `npm test`, `npm run typecheck`: run both before calling a change done.
- `npm run datagen`: regenerate `data/sample/`.
- `npm run db:start` / `npm run db:test`: local Supabase + pgTAP RLS tests (needs Docker).

## Conventions
- Engine functions are pure and return new objects; never mutate an `EventLog` or caller input.
- Activities are referenced **by name** in anything serialized (filters, rules, metric IDs); ids are internal.
- Every currency figure must derive from `CostModel` so the UI can show its formula.
- Metric IDs (`edge:A → B`, `resource:Activity@Name`, `rework:Activity`) are a contract with the AI grounding check. Don't change their format casually.
- Hot loops: prefer typed arrays and numeric keys over string-keyed Maps (see `computeDfgWithDurations`).
- Every table has `workspace_id` + RLS. New tables follow the "members read, editors write" pattern in the core migration.
- Claude API calls happen server-side only. Check the `claude-api` skill for current model IDs before touching AI code.
