# Handover pack

For whoever runs, operates or extends the Process Discovery Engine (codename Throughline) after its author. Read with
`ARCHITECTURE.md` (the parts and data flow), `docs/deployment-plan.md` (hosts, env vars, cost) and `CLAUDE.md`
(commands and conventions).

## 1. What it is

A web app that turns an event-log export (CSV, Excel or XES) into a process map, priced bottlenecks, rule violations,
a BPMN model with conformance, and AI-written insights and a go / no-go memo whose figures are checked by code. Two
public demos need no account: `/sample` (BPI Challenge 2020, real data) and `/sample/meridian` (synthetic, with known
answers).

## 2. Run it locally

Prerequisites: Node ≥ 22.12, Docker (Colima on macOS: `colima start --cpu 4 --memory 8`), Python 3.12 and `uv` for the
miner.

```bash
npm install
npm run db:start                                   # local Supabase; Mailpit at http://127.0.0.1:54324
cp src/web/.env.example src/web/.env.local         # local values; add ANTHROPIC_API_KEY for live AI
npm run dev                                        # http://localhost:3000
```

The miner (needed for XES upload and the BPMN/conformance views on uploaded datasets):

```bash
cd src/miner
SUPABASE_URL=http://127.0.0.1:54321 ALLOW_HTTP_URLS=1 EVENTS_URL_ALLOWED_HOSTS=127.0.0.1 \
  uv run uvicorn --factory throughline_miner.main:create_app --port 8010
```

and set `MINER_URL=http://127.0.0.1:8010` in `src/web/.env.local`.

## 3. Test it

| Command | What |
|---|---|
| `npm test` | Engine, datagen ground truth, web (grounding, pipelines, usage limits, snapshot, miner contract) |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint across workspaces |
| `npm run build -w @throughline/web` | Production build |
| `npm run db:test` | pgTAP: row-level security, AI usage limits |
| `npm run e2e` | Playwright against local Supabase (and the miner if it's up): sign-in via Mailpit, CSV upload, map, filter, partner delay, XES via Storage, BPMN and conformance, demo insights, headers, phone width |
| `cd src/miner && uv run pytest -q && uv run ruff check . && uv run mypy --strict throughline_miner` | Miner |

CI (`.github/workflows/ci.yml`) runs all of these on every push and PR, plus a Docker build of the miner.

## 4. Operate it

**Routine**
- Watch AI spend: the `ai_usage` table (tokens per request) and the Anthropic Console. Limits: 30 requests per user per
  hour, `AI_DAILY_LIMIT` (default 300) per 24 h site-wide, and the Console's monthly spend limit as the backstop.
- Supabase Free pauses a project after 7 days without activity; un-pause it from the dashboard.
- Fly.io stops the miner when idle; the first request after a stop waits a few seconds for it to start (the page says
  "it may be starting up" if that request fails).

**Deploying a change**
- Web: merge to `main`; Vercel deploys. Previews per PR.
- Database: if the PR adds a migration, run `supabase db push` (linked to the hosted project) before promoting the web
  deploy. Never edit an applied migration.
- Miner: `cd src/miner && fly deploy`.

**Rollback**
- Web: Vercel → Deployments → Instant Rollback.
- Miner: `fly releases`, then `fly deploy --image <previous>`.
- Database: migrations are additive; undo with a new migration. Data loss: restore the nightly dump (below).

**Backups and restore**
- Postgres: the `backup` workflow dumps roles, schema and data nightly as a 30-day workflow artifact
  (`docs/deployment-plan.md`). Restore into a fresh project or local Supabase:

  ```bash
  gh run download <run-id> -n db-backup
  gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" db-backup.tar.gz.gpg | tar xzf -
  psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -f roles.sql -f schema.sql -f data.sql
  ```
- Storage (raw files, snapshots) isn't backed up on the Free plan: users keep their source files and can re-upload.

**Incidents**

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-in emails don't arrive | SMTP credentials or DNS (SPF/DKIM) | Supabase Auth → SMTP settings; Resend dashboard logs |
| "The demo's AI budget for today is used up" | `AI_DAILY_LIMIT` reached | Wait for the window, or raise the variable |
| AI returns 503 | Usage couldn't be counted (database down) | Check Supabase status; fails closed by design |
| XES upload: "mining service isn't reachable" | Miner stopped or crashed | `fly status`, `fly logs`; restart with `fly machine restart` |
| Miner refuses to start | `ENVIRONMENT=production` without `EVENTS_URL_ALLOWED_HOSTS`, or with `AUTH_DISABLED`/`ALLOW_HTTP_URLS` | Fix `fly.toml` `[env]` |
| Upload refused at 50 MB | The one upload limit | Supabase Pro raises it; change all four layers together (`docs/deployment-plan.md`) |

## 5. Extend it

- **A new metric:** compute it in `src/web/lib/analysis/analyse.ts` (never in the worker or a route) so the explorer
  and the AI see the same figure; give it a metric ID that follows the existing formats; add it to
  `lib/ai/metrics.ts`; test it in the grounding suite.
- **A new rule type:** `src/engine/src/rules.ts` with a formula string from the `CostModel`; tests in
  `src/engine/test/bottlenecks-rules.test.ts`.
- **Anything priced:** read ADRs 0002 and 0003 first.
- **A new miner endpoint:** `src/miner/throughline_miner/main.py` + schema in `schemas.py`; call it from server code via
  `src/web/lib/miner/client.ts`; keep browser ↔ Vercel bodies under 4.5 MB (large data goes through Storage by signed
  URL).
- **A new table:** `workspace_id` and RLS ("members read, editors write"), plus a pgTAP test.
- **Regenerate demo outputs:** AI: `ALLOW_DEMO_REGENERATION=1` in development, sign in, press Generate. Miner:
  `scripts/build-miner-demos.mts` (header has the commands).

## 6. Known limits

- One upload limit of 50 MB (Supabase Free); Excel and CSV are parsed on the browser's main thread.
- Insights and memo are always for the whole dataset, not a filtered view; no memo PDF yet.
- Conformance's reference is "the most common paths", not a model the client supplies (the miner accepts BPMN; there's
  no upload for it yet).
- BPMN and conformance results for uploaded datasets aren't cached; each run calls the miner.
- No rule builder UI; per-activity handling minutes and wait targets aren't in the settings form.
- Costs rest on the workspace's cost settings; uploaded logs use defaults until someone sets them.
- pm4py is AGPL-3.0: the deployed miner's source must stay offered (the footer Source link; ADR 0004). A closed-source
  fork needs a commercial pm4py licence or the pm4py endpoints replaced.
- Public demo data (BPIC 2020) is CC BY-NC 4.0: non-commercial use only.

## 7. Decisions

ADRs in `docs/adr/`: 0001 hybrid engine, 0002 cost model, 0003 wait classification, 0004 pm4py licence, 0005
grounding. Validation evidence: `docs/validation.md`. Positioning: `docs/market-comparison.md`.
