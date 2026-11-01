# Throughline miner

The Python worker behind Throughline's heavier process-mining features. It wraps
[pm4py](https://pm4py.fit.fraunhofer.de/) 2.7.23.11 in a small FastAPI service:

| Endpoint | What it does |
| --- | --- |
| `GET /health` | Liveness probe (no auth). Reports service and pm4py versions. |
| `POST /discover/inductive` | Inductive Miner → BPMN 2.0 XML (with diagram layout, ready for bpmn-js), process tree and log stats. |
| `POST /conformance/token-replay` | Token-based replay against a reference model. Gives per-case fitness, the overall conformance rate, and the rate per ISO week of case start. |
| `POST /import/xes` | Upload `.xes` / `.xes.gz` and get the events back in Throughline's event contract. |

The TypeScript engine (`src/engine`) handles everything interactive (DFG, variants,
bottlenecks, rules) in the browser. The Next.js server calls this worker only for the
algorithms above, passing the signed-in user's Supabase access token.

OpenAPI docs are served at `/docs` (Swagger UI) and `/openapi.json` while the service is running.

---

## Event contract

The same contract as the TypeScript side, as CSV columns or JSON fields:

| Field | Required | Notes |
| --- | --- | --- |
| `case_id` | yes | string |
| `activity` | yes | string |
| `timestamp` | yes | ISO 8601 **with a UTC offset**: `2026-03-02T09:00:00+00:00`, `…Z` or `…-05:00`. Naive timestamps get a 422 that lists the offending lines. |
| `resource` | no | string |
| *anything else* | no | Kept as case/event attributes. JSON values must be scalars. |

Inside the service these map to pm4py's keys `case:concept:name`, `concept:name`,
`time:timestamp` and `org:resource`. Events are sorted by case and then timestamp (stable,
so ties keep input order). Timestamps are converted to UTC; responses use ISO 8601 with
`Z`.

---

## Calling it from Next.js

Call the worker from **server code only** (route handlers or server actions). The browser
never talks to it directly, so it needs no CORS. Forward the user's access token, and pass
large logs by signed URL instead of inlining them.

```ts
// lib/miner.ts (server-only)
import "server-only";

const MINER_URL = process.env.MINER_URL!; // e.g. https://throughline-miner.fly.dev

export async function callMiner<T>(path: string, accessToken: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${MINER_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...init.headers },
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  if (!res.ok) {
    // Errors are { detail: string } for 4xx/5xx, or FastAPI's validation list for 422.
    const body = await res.json().catch(() => ({}));
    throw new MinerError(res.status, body.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class MinerError extends Error {
  constructor(public status: number, public detail: unknown) {
    super(`miner ${status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
}
```

Get the token and a short-lived signed URL with the server Supabase client. Raw uploads
live in the private `raw-uploads` bucket under `<workspace_id>/<dataset_id>/…`, and storage
RLS already limits signing to workspace members:

```ts
const supabase = await createClient(); // @supabase/ssr server client
const { data: { session } } = await supabase.auth.getSession();
// getUser() first if you need a verified user for your own checks; the miner verifies the JWT itself.
const { data: signed, error } = await supabase.storage
  .from("raw-uploads")
  .createSignedUrl(`${workspaceId}/${datasetId}/events.csv`, 60); // 60s is plenty
```

### `POST /discover/inductive`

```ts
const result = await callMiner<DiscoverResponse>("/discover/inductive", session.access_token, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ events_url: signed.signedUrl, noise_threshold: 0.2 }),
  // or: body: JSON.stringify({ events: [{ case_id, activity, timestamp, resource }, …] })
});

// Render it:
const viewer = new BpmnViewer({ container: "#canvas" }); // bpmn-js
await viewer.importXML(result.bpmn_xml);
viewer.get("canvas").zoom("fit-viewport");
```

Request: exactly one of `events_url` or `events`, plus `noise_threshold` (0–1, default 0).
At 0 the Inductive Miner keeps every behaviour, so the model has perfect fitness. Higher
values (IMf) drop infrequent paths. 0.2 is a good default for a readable model.

Response:

```jsonc
{
  "bpmn_xml": "<?xml …><bpmn:definitions …>…<bpmndi:BPMNDiagram>…",  // includes DI layout
  "process_tree": {
    "notation": "->( 'Receive Invoice', *( 'Check Invoice', ->( 'Price Change', 'Re-invoice' ) ), 'Approve', 'Pay' )",
    "root": { "type": "sequence", "children": [ { "type": "activity", "label": "Receive Invoice", "children": [] }, … ] }
  },
  "stats": {
    "num_cases": 7, "num_events": 40, "num_activities": 6, "num_variants": 3,
    "first_timestamp": "…", "last_timestamp": "…",
    "activities": { "Check Invoice": 11, … },
    "start_activities": { "Receive Invoice": 7 }, "end_activities": { "Pay": 7 },
    "noise_threshold": 0.2, "duration_ms": 41
  }
}
```

Tree node `type` is one of `activity`, `silent`, `sequence`, `xor`, `parallel`, `loop`,
`or`, `interleaving` or `partial_order`.

### `POST /conformance/token-replay`

Pass the events in either form, plus **one** reference:

- `happy_variants`: the intended activity sequences, e.g. picked by the user from the
  variant list. The worker discovers a reference model (Inductive Miner, no filtering)
  from the cases that follow exactly one of those sequences.
- `bpmn_xml`: a BPMN 2.0 model, e.g. a `bpmn_xml` from discovery that the user has saved
  as the target process.

```ts
const conf = await callMiner<ConformanceResponse>("/conformance/token-replay", session.access_token, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    events_url: signed.signedUrl,
    happy_variants: [["Receive Invoice", "Check Invoice", "Approve", "Pay"]],
  }),
});
```

```jsonc
{
  "num_cases": 7, "num_fit_cases": 4,
  "conformance_rate": 0.571,   // share of cases with fitness 1.0
  "average_fitness": 0.91,     // mean per-case fitness
  "log_fitness": 0.90,         // pm4py's token-based log fitness
  "cases": [
    { "case_id": "INV-1003", "fitness": 0.833, "is_fit": false,
      "case_start": "2026-03-04T10:00:00Z", "iso_week": "2026-W10",
      "missing_tokens": 1, "consumed_tokens": 6, "remaining_tokens": 1, "produced_tokens": 6,
      "deviating_activities": ["Price Change", "Re-invoice"] },
    …
  ],
  "weekly": [
    { "iso_week": "2026-W10", "week_start": "2026-03-02", "num_cases": 3, "num_fit_cases": 2,
      "conformance_rate": 0.667, "average_fitness": 0.944 },
    …
  ],
  "reference": {
    "source": "happy_variants",
    "bpmn_xml": "…",                // the discovered reference, so the UI can show it
    "matched_cases": 4,
    "unmatched_variants": []         // happy variants that no case follows
  },
  "duration_ms": 12
}
```

Weeks are ISO weeks **in UTC** of each case's first event, oldest first.
`deviating_activities` lists activities the model does not have, plus activities that
fired without being enabled. If no case matches any happy variant, the response is a 422.

### `POST /import/xes`

Multipart upload. Gzip is detected by content, not by file name. Forward the user's file
from a route handler:

```ts
export async function POST(req: Request) {
  const form = await req.formData();                  // field "file" from the browser
  const upstream = new FormData();
  upstream.append("file", form.get("file") as File);
  const imported = await callMiner<ImportResponse>("/import/xes?lifecycle=complete", session.access_token, {
    method: "POST",
    body: upstream,                                     // fetch sets the multipart boundary
  });
  // imported.events is in the event contract: validate it with the engine, then store a snapshot.
}
```

`lifecycle=complete` (the default) keeps only events whose `lifecycle:transition` is
`complete` or absent, as most mining tools do. Use `lifecycle=all` to keep start/complete
pairs. Trace attributes (`case:department`) come back without their prefix (`department`)
unless that name clashes with an event attribute.

```jsonc
{
  "events": [ { "case_id": "…", "activity": "…", "timestamp": "…Z", "resource": "…", "amount": 1200.0 }, … ],
  "stats": { "num_events": 40, "num_cases": 7, "num_activities": 6,
             "dropped_events": 0, "lifecycle_filtered_events": 0, "attributes": ["amount", "vendor"] }
}
```

### Errors

| Status | When |
| --- | --- |
| 400 | `events_url` is not https, or its host is not in `EVENTS_URL_ALLOWED_HOSTS`. |
| 401 | Missing, expired or invalid token (`WWW-Authenticate: Bearer`). |
| 413 | Body, download, upload or decompressed XES over its limit, or more than `MAX_EVENTS` events. |
| 422 | Request or events break the contract, or the reference model is unusable. `detail` says which lines or fields. |
| 502 | Storage answered `events_url` with an error. The URL is never echoed back, because it is a credential. |

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | – | Turns on JWKS verification (RS256/ES256, from `<url>/auth/v1/.well-known/jwks.json`) and pins `iss` to `<url>/auth/v1`. |
| `SUPABASE_JWT_SECRET` | – | Turns on HS256 verification with the project's legacy JWT secret. Keep it in a secret store. |
| `AUTH_DISABLED` | `0` | `1` skips auth entirely. **Local dev and tests only.** |
| `JWT_AUDIENCE` | `authenticated` | Required `aud`. Rejects anon-key tokens. |
| `JWKS_CACHE_SECONDS` | `600` | JWKS cache TTL. An unknown `kid` forces a refresh, at most every 30s. |
| `MAX_EVENTS` | `250000` | Max events per request (413 above). |
| `MAX_PAYLOAD_BYTES` | `52428800` | Max request body, `events_url` download and XES upload (50 MiB). |
| `MAX_XES_UNCOMPRESSED_BYTES` | `536870912` | Max size of a `.xes.gz` after decompression, as a gzip-bomb guard (512 MiB). |
| `EVENTS_URL_ALLOWED_HOSTS` | *(any)* | Comma-separated hosts `events_url` may point at. **Set it to your Supabase host in production.** |
| `FETCH_TIMEOUT_SECONDS` | `30` | Timeout for fetching `events_url`. |
| `SOURCE_URL` | – | Source link reported by `/health` (see Licensing). |
| `WEB_CONCURRENCY` | `1` | uvicorn worker processes. Mining is CPU-bound, so use one per vCPU. |
| `PORT` | `8080` | Listen port (container only). |

Auth needs at least one of `SUPABASE_URL` or `SUPABASE_JWT_SECRET` unless
`AUTH_DISABLED=1`; otherwise the service refuses to start. With both set, each token is
checked by the path its `alg` header names: HS256 against the secret, RS256/ES256 against
JWKS. No other algorithm is accepted. That supports a project midway through Supabase's
move to asymmetric signing keys.

---

## Development

The toolchain is [uv](https://docs.astral.sh/uv/). `pyproject.toml` pins pm4py exactly,
`uv.lock` pins everything else, and `.python-version` selects Python 3.12.

```bash
cd src/miner
uv sync                      # create .venv with runtime + dev dependencies
```

Run locally without auth:

```bash
AUTH_DISABLED=1 uv run uvicorn --factory throughline_miner.main:create_app --reload --port 8000
```

Then open http://localhost:8000/docs, or try it:

```bash
python3 -c "import csv,json;print(json.dumps({'events':list(csv.DictReader(open('tests/fixtures/invoice_approval.csv')))}))" \
  | curl -s localhost:8000/discover/inductive -H 'content-type: application/json' -d @- | head -c 600
```

To run against local Supabase, set `SUPABASE_URL=http://127.0.0.1:54321` (JWKS) or
`SUPABASE_JWT_SECRET` from `supabase status`.

### Tests and checks

```bash
uv run pytest                # all tests; no network, no Docker
uv run ruff check .          # lint (pycodestyle, pyflakes, isort, bugbear, bandit, …)
uv run ruff format --check . # formatting
uv run mypy throughline_miner tests   # strict typing
```

CI (`.github/workflows/ci.yml`, job `miner`) runs `uv sync --frozen`, `ruff check` and
`pytest`.

The fixture `tests/fixtures/invoice_approval.csv` is a small invoice-approval log: 4
happy-path cases (Receive Invoice → Check Invoice → Approve → Pay) and 3 rework cases
(Price Change → Re-invoice → Check Invoice again, one of them twice), across ISO weeks
2026-W10 and W11, with mixed UTC offsets. The tests cover:

- **Discovery:** BPMN XML parses, has a task per activity, and has DI for every node and
  flow with no overlapping shapes. The process tree is a sequence with a rework loop.
  Stats, `noise_threshold` and `events_url` fetching (mocked) are checked too.
- **Conformance:** happy-path cases have fitness 1.0 and rework cases less (two loops less
  than one) when the reference is the happy variant. Weekly rates are checked. Using
  `bpmn_xml` gives the same result as `happy_variants`, and the discovered model fits
  every case.
- **XES:** `.xes` and `.xes.gz` round-trip to the same events, along with the lifecycle
  filter and trace-attribute naming.
- **Auth:** HS256, RS256/ES256 via JWKS, expired, wrong audience/issuer/key, `alg: none`
  and unknown `kid` tokens.
- **Limits and hardening:** event count, body size (with and without `Content-Length`),
  download size, https-only and host allowlist, DOCTYPE/XXE refusal, gzip-bomb cap.

---

## Deploy

### Docker

```bash
cd src/miner
docker build -t throughline-miner .
docker run --rm -p 8080:8080 -e AUTH_DISABLED=1 throughline-miner
```

The image is multi-stage on `python:3.12-slim-bookworm`. The runtime stage holds only the
locked virtualenv (no uv, no compilers, no tests) and runs as uid 10001. It has a
`HEALTHCHECK` on `/health`. No Graphviz is needed (see Design notes).

### Fly.io

```bash
cd src/miner
cp fly.toml.example fly.toml          # set app name, region, SUPABASE_URL, allowed host, SOURCE_URL
fly launch --no-deploy --copy-config
fly secrets set SUPABASE_JWT_SECRET=…  # only if your project still issues HS256 tokens
fly deploy
```

Then set `MINER_URL=https://<app>.fly.dev` in the Next.js environment (Vercel project
settings). The example config scales to zero when idle. Expect a few seconds of cold start
on the first request, or set `min_machines_running = 1` before a demo.

### Render

Create a **Web Service** from this repository with runtime **Docker**, root directory
`src/miner`, health check path `/health`, and the same environment variables (put
`SUPABASE_JWT_SECRET` in a secret). Render sets `PORT` automatically.

---

## Design notes

- **Layout without Graphviz.** bpmn-js needs BPMN diagram interchange (shape bounds and
  edge waypoints). pm4py's layouter shells out to Graphviz `dot`, which would add a system
  package to the image. `layout.py` is a small Sugiyama-style layered layout instead:
  back-edge removal, longest-path layering, dummy vertices for long edges, barycenter
  ordering, orthogonal routing, and loop-backs in a lane above or below. Inductive
  Miner output is block-structured, so this gives clean left-to-right diagrams.
- **CPU-bound work off the event loop.** pm4py calls run in the threadpool, so `/health`
  stays responsive during a long mining request. Throughput comes from worker processes
  (`WEB_CONCURRENCY`) and Fly's request concurrency limits.
- **Untrusted input.** `events_url` is https-only, has an optional host allowlist, no
  redirects, a streamed size cap, and is never logged or echoed. XML (BPMN and XES) with a
  DOCTYPE or entity declaration is refused before it reaches lxml. Gzip is inflated in
  bounded steps. Request bodies are capped in middleware even without `Content-Length`.

## Licensing

pm4py is licensed under **AGPL-3.0**. Running this worker as a network service makes the
AGPL's network clause apply to it. The simplest way to comply is to keep the source public
(it is, in this repository) and set `SOURCE_URL` so `/health` links to it. A closed-source
commercial deployment would need pm4py's commercial licence instead.
