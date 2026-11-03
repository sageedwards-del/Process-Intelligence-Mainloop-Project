# Deployment plan

_Status: **Approved** by the owner on 2026-11-03, with these choices: the free `process-discovery-engine.vercel.app`
address (no custom domain for now), Gmail as the sign-in email sender, public pages indexed, ADR 0004 option B
accepted, and the repository renamed to `sageedwards-del/process-discovery-engine`. Accounts, secrets and passwords are
created and entered by the owner._

Throughline ("Process Discovery Engine") has three deployable parts and one external API:

| Part | Host | Why |
|---|---|---|
| Web (`src/web`, Next.js 16) | **Vercel**, Hobby plan, project root `src/web` | First-party Next.js host; preview deploy per PR; `VERCEL_GIT_COMMIT_SHA` feeds the footer's Source link (ADR 0004) |
| Miner (`src/miner`, FastAPI + pm4py) | **Fly.io**, one `shared-cpu-1x` machine, 2 GB, auto-stop | Docker as-is (`Dockerfile`, `fly.toml`); billed only while running; Render's free tier has 512 MB and sleeps for ~1 min on wake, too small for pm4py |
| Database, Auth, Storage | **Supabase** hosted project, Free plan | Same stack as local (`supabase/`); migrations applied with the CLI |
| Claude | Anthropic API | Server-side only (`src/web/lib/ai/`) |

Region: everything in **US East** (Vercel `iad1`, Fly `iad`, Supabase `us-east-1`) so the web ↔ database ↔ miner hops
stay short. If the audience is mostly in Europe, move all three to Frankfurt together.

## Environments

| Environment | Web | Miner | Database |
|---|---|---|---|
| Local | `npm run dev` on :3000 (worktrees use :3001, `.claude/launch.json`) | `uv run uvicorn …` on :8000 | `npm run db:start` (Docker via Colima), Mailpit on :54324 |
| CI | `next build` only | `uv sync`, ruff, pytest, `docker build` | Supabase CLI in Docker: migrations + pgTAP (`npm run db:test`) |
| Preview | Vercel preview per PR, **pointing at the production Supabase project and miner** (see below) | — | — |
| Production | Vercel production (`main`) | Fly app `throughline-miner` | Supabase project `throughline` |

No separate staging database: a portfolio demo with one maintainer doesn't justify a second Supabase project, and the
Free plan allows two projects in total. Preview deploys share production data, so magic-link redirects allow
`https://*-<vercel-team>.vercel.app/**` and previews run with `AI_DAILY_LIMIT` shared with production (the limit is
enforced in the database, so they can't exceed it together). If a second person starts working on it, add a staging
Supabase project and point previews at it.

## Infrastructure as code

| What | Where |
|---|---|
| Database schema, RLS, storage buckets and their size limits, SQL functions | `supabase/migrations/*.sql` (never edit an applied one) |
| Local Supabase settings (auth URLs, storage limit) | `supabase/config.toml` |
| Hosted Supabase auth settings (Site URL, redirect URLs, SMTP, rate limits) | Set in the Supabase dashboard (Authentication → URL Configuration, SMTP Settings, Rate Limits) to the values in the Supabase table below, which is their record. `supabase config push` would also push the local-only settings in `config.toml`, so it isn't used. The SMTP password is typed in by the owner and never stored in the repo |
| Miner image and runtime | `src/miner/Dockerfile`, `src/miner/fly.toml` (committed; created from `fly.toml.example`) |
| Web build and headers | `src/web/next.config.ts`; Vercel project settings: root directory `src/web`, framework Next.js, Node 22 |
| CI | `.github/workflows/ci.yml` |

Vercel's project settings (root directory, env vars) are set once through the CLI (`vercel link`, `vercel env add`)
and listed below; Vercel has no config file for env vars. `vercel.json` isn't needed.

## CI/CD

- **CI** (GitHub Actions, every push to `main` and every PR): typecheck, lint, unit tests, web build; miner ruff,
  pytest and Docker build; pgTAP against a CLI-started Supabase; Playwright e2e against local Supabase. Branch
  protection on `main` requires the CI jobs to pass.
- **Web CD:** Vercel's GitHub integration. PRs get preview deploys; merging to `main` deploys production.
- **Miner CD:** manual `fly deploy` from `src/miner` after a miner change is merged (it changes rarely). Optional later:
  a `deploy-miner` workflow on changes under `src/miner/**` with a `FLY_API_TOKEN` deploy token.
- **Database migrations:** `supabase link --project-ref <ref>` once, then `supabase db push` by hand after merging a PR
  that adds a migration, **before** the web deploy that needs it is promoted. Migrations are additive, so the old web
  build keeps working against the new schema. Later: a `db-push` workflow gated on a GitHub environment approval.

## Secrets and environment variables

Secrets live only in the host's secret store (Vercel env vars, Fly secrets, Supabase dashboard). `.env.local` is
gitignored; `src/web/.env.example` documents every web variable with local values.

### Web (Vercel)

| Variable | Scope | Value | Secret? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production, Preview | `https://<ref>.supabase.co` | No |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Production, Preview | `sb_publishable_…` from the project | No (RLS protects data) |
| `NEXT_PUBLIC_SITE_URL` | Production | `https://process-discovery-engine.vercel.app` (canonical origin; magic-link redirects, `metadataBase`, sitemap) | No |
| `NEXT_PUBLIC_SITE_URL` | Preview | unset: falls back to `https://$VERCEL_URL` | No |
| `MINER_URL` | Production, Preview | `https://throughline-miner.fly.dev` | No |
| `ANTHROPIC_API_KEY` | Production, Preview | a key from a dedicated Console workspace | **Yes**, server only, never `NEXT_PUBLIC_` |
| `AI_DAILY_LIMIT` | Production, Preview | `300` | No |
| `ALLOW_DEMO_REGENERATION` | — | never set in hosted environments (ignored in production builds anyway) | — |
| `VERCEL_GIT_COMMIT_SHA` | set by Vercel | the footer's Source link and the AGPL source offer | — |

### Miner (Fly.io)

| Variable | Where | Value |
|---|---|---|
| `SUPABASE_URL` | `fly.toml [env]` | `https://<ref>.supabase.co` (JWKS verification + issuer pinning) |
| `EVENTS_URL_ALLOWED_HOSTS` | `fly.toml [env]` | `<ref>.supabase.co`. Required in production: the miner refuses to start with `ENVIRONMENT=production` and no allowlist |
| `ENVIRONMENT` | `fly.toml [env]` | `production` |
| `MAX_PAYLOAD_BYTES` | `fly.toml [env]` | `52428800` (50 MB, the one upload limit; see below) |
| `MAX_EVENTS` | `fly.toml [env]` | `250000` |
| `MAX_XES_UNCOMPRESSED_BYTES` | `fly.toml [env]` | `536870912` (512 MB) |
| `SOURCE_URL` | `fly.toml [env]` | `https://github.com/<owner>/<repo>` (AGPL §13, ADR 0004) |
| `SUPABASE_JWT_SECRET` | `fly secrets set` | only if the project still issues HS256 tokens; new projects use asymmetric keys and don't need it |

### Supabase (dashboard / `config push`)

| Setting | Value |
|---|---|
| Auth → Site URL | `https://process-discovery-engine.vercel.app` |
| Auth → Redirect URLs | `https://process-discovery-engine.vercel.app/**` and `https://*-sge12.vercel.app/**` (previews). Use `/**`, not `/auth/callback`: the site returns to `/auth/callback?next=…`, and an exact entry doesn't match the query string, so Supabase falls back to the Site URL. Local: `http://localhost:3000/**` (in `supabase/config.toml`) |
| Auth → SMTP | Custom SMTP through Gmail: host `smtp.gmail.com`, port 465, username = the sending Gmail address, password = a Google app password (needs 2-step verification), sender name "Process Discovery Engine". Supabase's built-in mailer only delivers to project team members and a few emails an hour, so it can't serve visitors. If the account's Google password changes, its app passwords stop working: make a new one |
| Auth → Rate limits | emails per hour 30, well under Gmail's ~500 a day, so a bot can't use up the allowance |
| Storage → Global file size limit | 50 MB (Free plan maximum) |
| SMTP password | The Gmail app password, typed by the owner into Supabase → Authentication → SMTP Settings; never in the repo or a shell history |
| Auth → Emails → Templates | **Magic Link** and **Confirm signup**: paste the HTML from `supabase/templates/magic_link.html` and `confirmation.html` (subjects "Your sign-in link" and "Confirm your email"). Their link goes to `{{ .SiteURL }}/auth/confirm?token_hash=…&type=email`, which works in any browser or device; Supabase's default template uses a PKCE link that only works in the browser that asked for it. Local Supabase reads the same files via `supabase/config.toml` |

## The one upload limit: 50 MB

| Layer | Before | After |
|---|---|---|
| Upload page (`lib/uploadLimit.ts`) | 100 MB | **50 MB** |
| Buckets `raw-uploads`, `snapshots` | 100 MB | **50 MB** (new migration) |
| Hosted Supabase global limit | — | 50 MB (Free plan cap) |
| Local `supabase/config.toml` | 50 MiB | 50 MiB |
| Miner `MAX_PAYLOAD_BYTES` | 50 MB default (docs said run at 100 MB) | **50 MB** |
| Vercel function body | 4.5 MB | not on the data path any more (files go browser → Storage; the miner fetches by signed URL and writes results back to Storage) |

Moving to Supabase Pro ($25/month) would allow raising all of these together; one constant per layer, listed above.

**Miner sizing.** The largest XES at the limit is a 50 MB `.xes.gz`, up to 512 MB uncompressed. Parsing XML in pm4py
uses several times the file size, and a 50 MB CSV of ~400k events is above `MAX_EVENTS` anyway. A 2 GB machine with
one worker (`WEB_CONCURRENCY=1`, `hard_limit = 2` concurrent requests) covers the 50 MB case measured locally; the
fly.toml check fails on OOM and Fly restarts the machine.

## Security

- Security headers in `next.config.ts`: CSP (self, Supabase URL for `connect-src`, `blob:` for the worker,
  `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  HSTS (`max-age=63072000; includeSubDomains; preload`), `Permissions-Policy` off for camera/mic/geolocation.
- `decodeSnapshot` caps decompressed size (zip-bomb guard).
- Miner refuses unlisted `events_url` hosts in production.
- `robots.txt` and `sitemap.xml`; `noindex` on `/app/**` and `/login`.
- Anthropic: a dedicated Console workspace with a **monthly spend limit (set by the owner)**, plus the code's
  30-per-user-hour and `AI_DAILY_LIMIT` caps.

## Backups and restore

| Store | Backup | Retention | Restore |
|---|---|---|---|
| Postgres (Supabase Free) | Supabase takes daily backups but the Free plan doesn't let you download or restore them. So: a GitHub Actions workflow `backup.yml` runs `supabase db dump` (roles, schema, data) nightly and uploads the files as an encrypted workflow artifact | 30 days (artifact retention) | `psql` the dump into a fresh project; tested once against local Supabase and written down in `docs/handover-pack.md` |
| Storage (raw uploads, snapshots) | Not backed up on Free. Users keep their source files; a snapshot can be rebuilt by re-uploading. Stated on the upload page and in the handover pack | — | Re-upload |
| Demo data | In git (`src/web/public/demo/`, `lib/ai/demo-outputs/`) | git history | Redeploy |
| Miner | Stateless | — | `fly deploy` |

The backup workflow (`.github/workflows/backup.yml`) needs two GitHub Actions secrets set by the owner:
`SUPABASE_DB_URL` (the session-pooler connection string) and `BACKUP_PASSPHRASE` (the dump is GPG-encrypted, because
artifacts on a public repository can be downloaded by any signed-in GitHub user). Without them it does nothing. On Pro, switch to Supabase's own daily backups (7 days) and drop the artifact.

## Monitoring and logging

- Vercel: runtime logs and the built-in observability tab (Hobby retention: 1 hour of logs; enough to debug a demo).
- Fly: `fly logs`, the `/health` check, machine restarts on failure.
- Supabase: dashboard logs (auth, storage, Postgres) and usage against Free limits (500 MB database, 1 GB storage,
  50k MAU, 5 GB egress).
- AI spend: `ai_usage` table (tokens per request) and the Anthropic Console usage page.
- Uptime: a free external check (e.g. UptimeRobot) on `/` and the miner's `/health`, emailing the owner. Optional.

## Rollback

- Web: Vercel "Instant Rollback" to the previous production deploy (or `vercel rollback`).
- Miner: `fly releases` then `fly deploy --image <previous image>`.
- Database: migrations are additive and the web code tolerates the previous schema, so a web rollback doesn't need a
  database rollback. A bad migration gets a new migration that undoes it; a destroyed table is restored from the
  nightly dump.

## Expected cost (per month)

| Item | Cost |
|---|---|
| Vercel Hobby | $0 (non-commercial use only; a portfolio qualifies) |
| Supabase Free | $0 (projects pause after 7 days with no activity; un-pause from the dashboard, or upgrade to Pro at $25) |
| Fly.io, 2 GB shared machine with auto-stop | ~$0.50–3 (≈ $0.0153/hour while running, rootfs ~$0.15 while stopped); ~$11 if it never stopped |
| Gmail (sign-in email sender) | $0 (about 500 emails a day from a personal account) |
| Domain | $0: `process-discovery-engine.vercel.app`. A domain (~$10–12/year at Cloudflare Registrar, e.g. `processdiscovery.dev`) can be added later as a settings change; it would also allow a branded sender (e.g. Resend) |
| Anthropic API | capped by `AI_DAILY_LIMIT` = 300 requests/day; measured ~$0.07 per insights run or question, $0.27 per memo. Worst case ≈ $20/day if every request were a memo, which is why the Console spend limit matters. Suggested Console limit: $25/month |
| **Total** | **≈ $1–5/month plus Claude usage** |

## Launch checklist

1. Owner: create the Supabase project, Fly.io account (card required), Vercel project, a Gmail app password
   (2-step verification on), and the Anthropic Console workspace with a spend limit.
2. `supabase link` + `supabase db push`; check all migrations applied (`supabase migration list`).
3. Set auth URLs and SMTP; send a test magic link.
4. `fly launch --no-deploy --copy-config`, `fly deploy`; `curl /health` shows `source_url`.
5. Vercel env vars; deploy.
6. Smoke test on the deployed site at desktop and 375 px: home, `/sample`, `/sample/meridian`, sign in, upload the
   Meridian CSV and an `.xes.gz`, explorer, BPMN and conformance tabs, insights, Ask.
7. Turn on the backup workflow; run it once by hand and restore the dump locally.
8. Update `docs/build-plan.md` Status and the Engineering page.
