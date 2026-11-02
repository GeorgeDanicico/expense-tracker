# Logging plan (family hub phase 15)

This plan gives the app logs that answer "what happened over the last few days?" at almost no
memory or CPU cost. Every process writes one JSON line per event, each API request gets an id
that follows it into the logs and onto the error message the user sees, slow calls show up
inside the request's own line, and Obsy gets a Logs page to search all of it. **No
Elasticsearch, Loki, Grafana or OpenTelemetry backend.** It replaces steps 15.1–15.6 in
[family-hub-roadmap.md](family-hub-roadmap.md) and closes the audit findings mapped to phase 15
([codebase-audit.md](codebase-audit.md): P7, B9, and the logging half of D3).

Phase 15 doesn't depend on S14 (enforcing the CSP), so it can start before S14's week of
report-only ends (about 9 November 2026).

## Where the app stands (2 November 2026)

| Area | Today | Gap |
| --- | --- | --- |
| Worker | `src/worker/log.ts` writes `{ time, level, event, ...fields }` JSON lines (info to stdout, errors to stderr). `tick` lines carry counts and `ms`. | No `warn` or `debug`. Its own format, not shared with the web app. Bookkeeping errors after a successful push re-send the notification, and a failed `claimDueReminders` skips the whole tick's deliveries (B9). |
| Web app, routes | `withUser`, `withPermission`/`withParent`, `withRequestGuard` and `withAnonymousLimit` wrap every route except `/api/mcp` and `/api/csp-report`. Unexpected errors become a 500 with a generic message. | **No request line at all.** Nothing records method, route, status, duration or who asked. A 500 leaves no trace unless the route logs it itself. |
| Web app, other logs | 14 `console.*` calls: free-text strings (`"Kid password reset: …"`), `console.error(message, error)` pairs, and two JSON-ish lines (`csp_violation`, `Statement import`, `AI call`). | Three formats. Errors printed with `console.error(msg, error)` dump whole objects, which can carry Supabase response bodies. No levels, no request id. |
| Background work | `touchLastActiveInBackground` is a floating promise; failures are swallowed with no log (P7). | Should use Next's `after()` and log failures at debug level. |
| MCP | `define-tool.ts` logs `MCP tool … failed` with the raw error. | `HttpError` and `ImportError` are logged as crashes (D3). No request line. |
| Server components | `src/app/(app)/error.tsx` shows "We couldn't load this page". | Nothing logs the error on the server; there's no `onRequestError`. Errors outside `(app)` (login, join, consent) have no boundary. |
| Browser | `ApiError` carries status, message, field errors and code. | Client errors, unhandled rejections and Web Vitals never reach the server. The user can't quote anything that would find their request in the logs. |
| CSP reports | `POST /api/csp-report` logs one `csp_violation` line per violation, with redacted paths (S7). | Uses `console.warn` directly; the redaction rules live only in `csp-report.ts`. |
| Retention | `scripts/deploy.sh` runs both containers with the `json-file` driver, `max-size=10m`, `max-file=3`. | Retention is by size, not time: a noisy hour can push out yesterday, a quiet week keeps everything. |
| Viewing | `docker logs` over SSH. Obsy (`GeorgeDanicico/obsy`, Next 16) shows container metrics through the Docker CLI and a read-only socket mount. | No search, no filters, no way to go from a request id to its line without SSH and `grep`. |

## Design

- **One logger, `src/lib/log.ts`**, used by the web app and the worker. Each line is
  `{ time, level, event, ...fields }`, the format the worker already writes, so existing worker
  lines and anything that parses them keep working. Levels: `debug`, `info`, `warn`, `error`.
  `LOG_LEVEL` (default `info`) sets the lowest level written. No dependency (`pino` only if L12's
  measurement shows the hand-written one costs something; it won't at this volume).
- **Never in a log line:** emails, passwords, tokens, cookies, `Authorization` headers, request or
  response bodies, query strings, invite codes, calendar feed tokens, statement rows, prompts or
  AI answers. **Allowed:** user ids (UUIDs), family ids, record ids, route templates, status
  codes, durations, counts, error names and codes. Redaction is by field name *and* by value
  pattern, so a secret in an unexpected field is still caught.
- **Request id:** 12 characters of URL-safe randomness, generated on the server for every request
  (incoming `x-request-id` headers are never trusted). The proxy sets it on page and API requests
  it matches; the route wrappers generate one for the routes the proxy skips (`/api/mcp`,
  `/api/csp-report`, the calendar feed, `/health`). It's returned as `x-request-id` on every API
  response.
- **One `request` line per API request**, written when the response is ready: method, route
  template (`/api/expenses/:id`, never the raw path), status, `ms`, user id when signed in, the
  request id, and the spans. Requests slower than `LOG_SLOW_MS` (default 1000) are logged at
  `warn` with `slow: true`.
- **"Tracing" is spans inside that line**, not a tracing backend:
  `spans: [{ name: "db.expenses", ms: 12 }, { name: "rpc.move_todo", ms: 30 }]`. Every Supabase
  call is timed by a `fetch` wrapper passed to each Supabase client, so no repository changes.
  Web Push and AI calls get explicit spans. Request context lives in `AsyncLocalStorage`.
- **The user sees the id.** A 5xx or network error message ends with `(ref 3fK9xQ2mBv0a)`, so a
  family member can read it out and George can paste it into Obsy.
- **Browser errors and Web Vitals** go to `POST /api/client-log`: small, schema-checked,
  rate-limited, and logged as `client_error` and `web_vital` lines in the same stream.
- **Retention is by time, through journald:** Docker's `journald` log driver, plus a journald
  drop-in on the VPS (`MaxRetentionSec=5day`, `SystemMaxUse=300M`). `docker logs` keeps working
  with that driver, so Obsy and SSH need nothing new.
- **Obsy reads logs with `docker logs`**, the same way it already runs `docker inspect` and
  `docker stats`: no journal mount, no new privileges.

## Tasks

Same workflow as phases 1–7 and 14: one task, one branch, one PR, one fresh agent per task, run
one at a time in the main checkout. Branches are `logging/<id>-<slug>` from `main`. L9–L11 live in
the **Obsy repo** (`~/Documents/github/obsy`, `GeorgeDanicico/obsy`), branched from its `main`.
Merge when reviewed and green. **Merging to `main` deploys to production**, so each task must
leave production working on its own.

### Which agent picks each task

The rule from phase 14: **opus** for work where a subtle mistake leaks data, changes every
request's behaviour, or needs careful design across many files; **sonnet** for well-specified work
in one area with clear tests; **haiku** only for mechanical edits with no judgement. Effort is
`high` for every task unless noted.

| Task | What | Audit | Depends on | Agent | Why that agent |
| --- | --- | --- | --- | --- | --- |
| L1 | Shared logger: levels, redaction, error serialising; the worker moves onto it | D3 (logging) | — | **sonnet** | One new module with a precise spec and heavy unit tests. Redaction is sensitive, but the rules are listed in full here. |
| L2 | Request context and request id; one `request` line from every route wrapper; `x-request-id` on responses | — | L1 | **opus** | Touches the wrapper every route goes through, adds `AsyncLocalStorage` next to the existing scoped Supabase client, and must not change any response. A mistake breaks or slows every request. |
| L3 | Every server `console.*` onto the logger; `onRequestError`; `after()` for last-active; MCP tool errors | P7, D3 (logging) | L2 | **sonnet** | Fourteen known call sites, each a small, local change with tests. |
| L4 | Spans: `span()`, a traced `fetch` for every Supabase client, Web Push and AI spans, slow warnings | — | L2 | **opus** | Wraps the transport of every Supabase client (auth, storage, admin, token and scoped clients). Span names must be built from URLs without leaking filter values, and the overhead must be measured. |
| L5 | Worker: per-tick context and spans; B9's double send and skipped tick | B9 | L1, L4 | **sonnet** | Two well-described fixes in one file plus the plumbing from L4, all covered by the worker's existing fakes. |
| L6 | `POST /api/client-log`: schema, limits, redaction, `client_error` and `web_vital` lines; CSP lines share the redaction | — | L2 | **opus** | A new endpoint that writes untrusted, partly anonymous input into the logs. Needs careful limits, schema and sanitising. |
| L7 | Browser side: request id in error messages, error boundaries, `error`/`unhandledrejection` hooks, Web Vitals | — | L6 | **sonnet** | Client wiring against L6's contract; small components and one change in `src/lib/api/client.ts`. |
| — | **Checkpoint:** George adds the journald drop-in on the VPS | | | George | Must be in place before L8 deploys, or logs fall back to journald's defaults. |
| L8 | Retention: journald log driver in `scripts/deploy.sh`; `docs/logging.md` with the drop-in and query recipes | — | L1, checkpoint | **sonnet** | Shell and docs, but the deploy script runs production; haiku is too risky here. |
| L9 | Obsy: `GET /api/logs` and a live-tail stream over `docker logs` (Obsy repo) | — | L2, L8 | **opus** | Spawns and kills child processes per request, streams to the browser and parses untrusted lines. A leak here holds processes and memory on the VPS. |
| L10 | Obsy: the Logs page, request-id search and links from container cards (Obsy repo) | — | L9 | **sonnet** | One UI page against L9's API. |
| L11 | (Optional) Obsy: requests per minute, p50/p95 per route, error rate, worker heartbeat age (Obsy repo) | — | L4, L9 | **sonnet** | Aggregation over parsed lines with clear checks. |
| L12 | Measure and close: overhead numbers, a production smoke test, baseline numbers for phase 16 and the S11 rate limits | — | all the above | **sonnet**, effort medium | Running checks and writing them up; no new design. |

There are no migrations in this phase.

### L1: Shared logger

**Files:** new `src/lib/log.ts` (or `src/lib/log/` with `index.ts`, `redact.ts`, `serialize.ts`
if it grows past ~200 lines), `src/lib/log.test.ts`, `src/worker/log.ts`,
`src/lib/notifications/worker.ts` (types only), `src/lib/env.ts`, `.env.example`.

- **API:**
  ```ts
  type LogLevel = "debug" | "info" | "warn" | "error";
  type LogValue = string | number | boolean | null | LogValue[] | { [key: string]: LogValue };
  type LogFields = Record<string, LogValue | undefined>; // undefined fields are dropped
  interface Logger {
    debug(event: string, fields?: LogFields): void;
    info(event: string, fields?: LogFields): void;
    warn(event: string, fields?: LogFields): void;
    error(event: string, fields?: LogFields): void;
    child(fields: LogFields): Logger; // every line also carries these fields
  }
  export const log: Logger;              // the process-wide logger
  export function createLogger(options?: { out?: Write; err?: Write; now?: () => Date; level?: LogLevel; base?: LogFields }): Logger;
  export function errorFields(error: unknown): LogFields; // see "Errors" below
  ```
- **Line format:** `{"time":"<ISO>","level":"info","event":"<snake_case>",...fields}\n`, one
  `JSON.stringify` per line. `time`, `level` and `event` always come first and can't be
  overwritten by fields. `debug` and `info` go to stdout, `warn` and `error` to stderr (as now).
- **Event names** are `snake_case`, checked by a test helper (`/^[a-z][a-z0-9_]{0,63}$/`); a bad
  name is still written, prefixed `invalid_event:` so it's noticed, never thrown.
- **Level:** `LOG_LEVEL` in `src/lib/env.ts`, optional, one of the four, default `info`.
  Lines below it cost one comparison and nothing else (no serialising).
- **Redaction** (in this order, applied recursively to nested objects and arrays, depth ≤ 4,
  arrays ≤ 50 items, objects ≤ 50 keys, beyond that `"[truncated]"`):
  1. **By field name**, case-insensitive, ignoring `_` and `-`: `password`, `passcode`, `secret`,
     `token`, `accesstoken`, `refreshtoken`, `apikey`, `authorization`, `cookie`, `setcookie`,
     `email`, `code` (invite codes) when its value isn't an error code (see below), `body`,
     `payload`, `prompt`, `answer`, `rows`. The value becomes `"[redacted]"`.
     `code` is kept when it matches `/^[a-z0-9_]{1,40}$/` (error codes such as
     `unrecognised_layout`, Postgres codes such as `23505`), redacted otherwise.
  2. **By value pattern**, on every string: `sb_secret_…`, `sb_publishable_…`, `Bearer …`,
     anything shaped like a JWT (`eyJ…\.…\.…`), email addresses, and runs of 32+ base64url
     characters. The match is replaced with `[redacted]`, the rest of the string kept.
  3. **Length:** strings are clipped to 500 characters with a trailing `…`.
- **Errors** (`errorFields(error)`): `{ error: { name, message, code?, status?, stack? } }`.
  `message` goes through the same redaction. `stack` only at `debug` level and only the first 10
  frames, with file paths made relative to the app root. Supabase `PostgrestError`s keep `code`,
  `message` and `hint` (never `details`, which can hold row values). An `AggregateError` or
  `cause` chain is followed two levels deep. A non-`Error` thrown value becomes
  `{ name: "NonError", message: String(value).slice(0, 200) }`.
- **The logger never throws.** A field that can't be serialised (a cycle, a `BigInt`) becomes
  `"[unserializable]"`; a write that throws is dropped.
- **Worker:** `createJsonLog` in `src/worker/log.ts` becomes a thin adapter over `createLogger`,
  keeping the `WorkerLog` interface (`info`, `error`) and adding `warn` and `debug`. Every worker
  line stays byte-compatible except for new fields: same `time`, `level`, `event` keys and order.
  Move `LogFields` to `src/lib/log.ts` and re-export it from `worker.ts`.
- **Import rules:** `src/lib/log.ts` must import nothing from `next/*` or `server-only`, so the
  worker bundle (`npm run build:worker`) and client-side code that only needs the types stay
  clean. Check `dist/worker.js` still builds.

**Tests:** level filtering, field ordering, every redaction rule (one test per name and per
pattern, including nested and array cases and the `code` exception), clipping, the limits,
cycles and `BigInt`, `errorFields` for `Error`, `PostgrestError`-shaped objects, `cause` chains and
non-errors, stdout/stderr split, and the worker's existing `log.test.ts` passing unchanged.

**Done when** the worker writes through the new logger with no change to its existing lines, all
of the above is tested, and `npm run build:worker`, lint, typecheck and tests pass.

### L2: Request context, request id and one line per request

**Files:** new `src/lib/log/request-context.ts` (+ test), `src/lib/log/route-template.ts`
(+ test), `src/lib/http/route.ts`, `src/lib/http/permission.ts` (if `withPermission`/`withParent`
don't already go through `withUser`), `src/proxy.ts`, `src/app/api/mcp/route.ts`,
`src/app/api/csp-report/route.ts`, `src/lib/http/route.test.ts`, `src/proxy` tests.

- **Context:** an `AsyncLocalStorage<RequestContext>` with
  `{ requestId, method, route, startedAt, userId?, spans: Span[], fields: LogFields }`.
  Helpers: `runWithRequestContext(ctx, fn)`, `currentRequest()` (or `undefined` outside a request),
  `setRequestUser(userId)`, `addRequestFields(fields)` (for a handler that wants to add, say,
  `familyId` or `importId` to its line). The logger from L1 adds `requestId` to every line written
  inside a context, so a `warn` in a repository carries the id without being passed it.
  This is a **separate** store from `runWithSupabaseClient`'s in `src/lib/supabase/server.ts`;
  don't merge them.
- **Request id:** `createRequestId()`: 12 characters from `crypto.getRandomValues` in the
  alphabet `[A-Za-z0-9]` (about 71 bits). `src/proxy.ts` always sets `x-request-id` on the
  request headers it forwards (overwriting anything the client sent) and on its response. A
  wrapper reads the header only when the request went through the proxy, which it knows because the
  proxy also sets a second internal header, `x-request-id-source: proxy`, that it strips from
  incoming requests first. Otherwise the wrapper generates a new id. This way a client can't
  choose its own id on the proxy-skipped routes.
- **Route template:** Next doesn't tell a route handler its own pattern, so build it from the
  path: UUID segments → `:id`; `/api/calendar/feed/<token>` → `/api/calendar/feed/:token`;
  `/join/<code>` → `/join/:code` (reuse `redactPath` from `csp-report.ts`, moved to
  `src/lib/log/redact-path.ts`); any other segment longer than 24 characters or with 16+ digits
  and letters mixed → `:value`. Query strings are dropped. A test lists every route under
  `src/app/api` (glob the files) and checks each one's sample path maps to a template with no raw
  ids.
- **The wrappers:** `withUser` (and so `withPermission`/`withParent`), `withRequestGuard` and
  `withAnonymousLimit` each:
  1. create the context and run everything (guard, auth, limits, handler) inside it;
  2. set the user id as soon as `getAuthenticatedUser` returns one;
  3. on the way out, set `x-request-id` on the response (copying headers if the response is
     immutable), and write one `request` line: `{ method, route, status, ms, userId?, spans,
     ...fields }`. Level: `info`; `warn` when `ms > LOG_SLOW_MS` (with `slow: true`) or status is
     429; `error` when status ≥ 500;
  4. for an unexpected error (the branch that answers `failure` with 500, or rethrows), write a
     `request_failed` line at `error` with `errorFields(error)` **before** the 500 is sent, and add
     `requestId` to the 500's JSON body: `{ error, requestId }`. When `failure` is unset and the
     error propagates, still log it, then rethrow so Next's behaviour is unchanged;
  5. `HttpError`/`DomainError`/`ImportError` responses are logged at `info` (4xx) with
     `errorCode` when they have one, never as failures.
- **Routes without a wrapper:** `src/app/api/mcp/route.ts` (wrap `handle` in the context and
  write the same `request` line, with `mcpTool` added by `define-tool.ts` through
  `addRequestFields` in L3) and `src/app/api/csp-report/route.ts` (context + line at `debug`, so
  report floods don't drown real traffic). `/health` gets no line at all (Docker hits it every few
  seconds); document that in the file.
- **`LOG_SLOW_MS`:** optional env in `src/lib/env.ts`, positive integer, default 1000.
- **Behaviour must not change:** status codes, bodies (apart from the new `requestId` on 500s),
  headers (apart from the new `x-request-id`), the order guard → auth → limits →
  password-change → handler, and the 401/403/429 paths. Every existing route test must pass
  untouched.

**Tests:** in `route.test.ts`, one `request` line per call for 200, 401, 403 (guard), 429, 4xx
from each error class, 500 with and without `failure`; the line carries the user id, the right
level, and no body or query; `x-request-id` on every response and equal to the line's
`requestId`; a forged `x-request-id` (with and without the internal header) is ignored on a
proxy-skipped route; context isolation between two concurrent requests (two interleaved promises
get different ids on every line). In the proxy tests: the id is set on request and response and an
incoming one is replaced.

**Done when** every API route except `/health` writes exactly one `request` line in
`docker logs`, every API response carries `x-request-id`, and all existing tests pass unchanged.

### L3: Every server log onto the logger

Closes P7 and the logging half of D3.

**Files:** the 14 call sites found by `grep -rn "console\.\(log\|error\|warn\|info\)" src`
(excluding tests and `src/lib/imports/ai/__eval__/`), `src/instrumentation.ts`,
`src/lib/family/last-active.ts`, `src/lib/mcp/define-tool.ts`, `eslint.config.mjs`.

- **Each `console.*` becomes a `log.<level>("<event>", fields)` call** with a fixed event name and
  structured fields, no prose with values in it. Suggested names: `env_optional_off` (info),
  `env_check_failed` (error, before `process.exit(1)`), `kid_sessions_signout_failed`,
  `password_change_signout_failed`, `kid_account_cleanup_failed`, `auth_user_cleanup_failed`,
  `avatar_delete_failed`, `account_deleted_cookie_clear_failed`, `csp_violation` (warn, same
  fields as today), `statement_import_step` (info), `ai_call` (info), `ai_followup_failed`
  (error), `mcp_tool_failed` (error). Ids that the old messages printed (`user.id`, the avatar
  path) go into fields (`userId`, `path`). Keep the injectable `log` options of
  `pipeline.ts`, `ai/gate.ts` and `ai/index.ts`; only their defaults change.
- **ESLint:** add `no-console: "error"` for `src/**`, with exceptions for tests,
  `src/lib/imports/ai/__eval__/**` (CLI scripts that print to a terminal) and `src/lib/log.ts`
  if it ever needs `console`.
- **`onRequestError`** in `src/instrumentation.ts` (see
  `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`):
  in the Node.js runtime, write `server_render_failed` at `error` with `errorFields(err)`,
  `digest`, `routePath`, `routeType`, `renderSource`, the request's method and route template, and
  the request id from `request.headers["x-request-id"]`. Never log the headers themselves. API
  route errors are already logged by L2's wrappers; skip `routeType: "route"` when the error went
  through a wrapper (the wrapper marks the error, for example with a symbol), so nothing is logged
  twice.
- **P7:** `touchLastActiveInBackground` runs the touch inside `after()` from `next/server`
  (route handlers only; `withUser` is always one). A failure logs `last_active_failed` at `debug`
  with `errorFields`. Keep the 5-minute in-process throttle as is. In tests, where there's no
  request scope, `after` isn't available: inject the scheduler (default `after`, tests pass a
  function that runs the callback) rather than mocking `next/server`.
- **MCP (D3, logging half):** in `define-tool.ts`, an `HttpError`, `DomainError` or `ImportError`
  is an expected refusal: answer with its message (as `toolError` does for `DomainError` today)
  and log `mcp_tool_refused` at `info` with `tool` and `status`. Only other errors log
  `mcp_tool_failed`. Add `mcpTool: name` to the request line through `addRequestFields`. The
  error classes themselves stay as they are; merging them into one `AppError` is phase 18.

**Tests:** each replaced call site has a test asserting the event and fields (and that no email,
token or body appears); `onRequestError` writes one line and skips wrapper-marked errors; the
last-active failure path logs at debug; MCP refusals vs failures. A lint run proves no
`console.*` remains in `src/` outside the exceptions.

**Done when** `grep -rn "console\." src` finds only tests and the eval scripts, server render
errors show up as one line with a request id, and P7 is closed.

### L4: Spans and slow requests

**Files:** new `src/lib/log/span.ts` (+ test), `src/lib/log/traced-fetch.ts` (+ test),
`src/lib/supabase/server.ts`, `admin-client.ts`, `anon-client.ts`, `proxy.ts` (the Supabase one),
`worker-store.ts`, `src/lib/notifications/push.ts`, `src/lib/ai/index.ts`.

- **`span(name, fn)`**: runs `fn`, records `{ name, ms }` (rounded to whole ms) on the current
  request's context, and returns `fn`'s result or rethrows its error (adding `error: true` to the
  span). Outside a request context it just runs `fn`. Add `spanSync` only if something needs it.
- **Span list limits:** at most 30 entries per request. Past that, spans with the same name are
  merged into `{ name, ms, count }` (ms summed), and past 30 distinct names the rest go into one
  `{ name: "other", ms, count }`. Also add totals to the request line: `dbMs` (all `db.*`,
  `rpc.*`, `auth.*`, `storage.*` spans) and `dbCalls`.
- **Traced fetch:** `tracedFetch(input, init)` wraps the global `fetch` and names the span from
  the URL path only:
  `/rest/v1/rpc/<fn>` → `rpc.<fn>`; `/rest/v1/<table>` → `db.<table>.<method>` (`get`, `post`,
  `patch`, `delete`); `/auth/v1/<op>` → `auth.<op>` (with ids replaced as in L2); `/storage/v1/object/<bucket>/…`
  → `storage.<bucket>`; anything else → `supabase.other`. **Never** the query string (PostgREST
  filters carry values, such as `email=eq.…`) or headers. Adds `status` to the span when it's
  ≥ 400. Pass it as `global: { fetch: tracedFetch }` to every `createClient`/`createServerClient`
  call, so repositories and RPC callers need no change. Check that `@supabase/ssr`'s
  `createServerClient` passes `global.fetch` through, and that auth calls (`getClaims`, sign-in,
  admin) use it (`auth.fetch`); if not, set it there too.
- **Explicit spans:** `push.send` → `push.send` (one per device; with the device id, never the
  endpoint URL); the AI provider call → `ai.<provider>.<model>`; the statement reader's PDF
  parse → `import.parse_pdf`. Add others only where L12 shows a gap.
- **Slow warning:** already in L2's line. Add `slowestSpan: { name, ms }` to that line when it's
  slow, so the cause is visible without reading the whole list.
- **Overhead check:** a micro-benchmark test (skipped in CI, run with an env flag) that times
  10 000 `span` calls and 10 000 request lines; record the numbers in the PR. Expect well under
  0.1 ms per request.

**Tests:** span naming for every URL shape (with query strings and ids that must not appear);
limits and merging; errors still propagate; no-op outside a context; a route test showing a
request line with `db.*` spans from the fake Supabase (or, if the fakes bypass `fetch`, a test of
`tracedFetch` with a fake inner `fetch`).

**Done when** the request line of a slow page shows which call was slow, and no query string
or header ever appears in a span.

### L5: Worker context, spans and B9

Closes B9.

**Files:** `src/lib/notifications/worker.ts`, `src/lib/notifications/worker.test.ts`,
`src/worker/run.ts`, `src/worker/main.ts`.

- **Per-tick context:** each tick runs inside a request-like context
  (`{ requestId: "tick-<12 chars>", route: "worker.tick" }`), so the `tick` line carries the
  spans from L4 (store calls go through the traced fetch, push sends through `span`). The `tick`
  line keeps its current counts; add `spans` and `dbMs`. A tick slower than 10 s logs at `warn`
  with `slow: true`.
- **B9, scenario 1 (double send):** in `deliver`, once at least one device received the push,
  errors from `markDevicesDelivered` and `finishNotification` are caught, logged
  (`notification_bookkeeping_failed`, error, with the notification id and which write failed),
  and the row still counts as sent for the tick. Retry `finishNotification` once before giving
  up. If it still fails, the lease runs out and the row would be claimed again: guard that by
  recording delivered notification ids in `WorkerState` for the lease length (2 minutes, max 1000
  ids) and skipping the push for a re-claimed id, finishing it as `sent` instead.
- **B9, scenario 2 (skipped tick):** wrap `claimDueReminders` like `claimDueCalendarEvents`
  already is: log `reminder_claim_failed` and go on to deliveries with zero reminders.
- **Lines:** check every worker event still uses a stable name; add `warn` where an error is
  expected and retried (`notification` lines for `retried` status).

**Tests:** with the existing fake store: a push that succeeds then `finishNotification` throws
is not pushed again on the next tick; `markDevicesDelivered` throwing still finishes the row as
sent; `claimDueReminders` throwing still delivers that tick's outbox rows; the tick line has
spans.

**Done when** both B9 scenarios are covered by tests and the worker's tick line shows its spans.

### L6: `POST /api/client-log`

**Files:** new `src/app/api/client-log/route.ts` (+ test), `src/lib/log/client-report.ts`
(+ test: the schema and sanitising), `src/lib/http/rate-limit.ts`, `src/lib/http/csp-report.ts`,
`src/proxy.ts` (matcher), `src/lib/http/guard.ts` (exemption list, only if needed).

- **Who may send:** anyone with a same-origin request, signed in or not (errors on the login and
  join pages matter too). It goes through `withRequestGuard`, so the S5 Origin/`Sec-Fetch-Site`
  check and the per-IP anonymous limit apply. When a session cookie is present, read the user id
  with the cheap claims check and add it to the lines; never answer 401.
- **Body:** JSON, at most 16 KB, `{ events: ClientEvent[] }` with 1–10 events. Zod, strict (no
  unknown keys):
  - `{ kind: "error", source: "window" | "unhandledrejection" | "boundary" | "global_boundary",
    name, message, stack?, digest?, requestId?, page, release? }`
  - `{ kind: "vital", name: "LCP" | "INP" | "CLS" | "TTFB" | "FCP", value, rating: "good" |
    "needs-improvement" | "poor", navigationType?, page, release? }`
  Limits: `name` ≤ 80, `message` ≤ 500, `stack` ≤ 4000 characters, `value` a finite number
  0–600 000, `requestId` matching L2's format, `release` ≤ 64 `[A-Za-z0-9._-]`.
- **Sanitising** before logging: `page` becomes a path only, through `redactPath` (moved to
  `src/lib/log/redact-path.ts` in L2) with ids replaced as in L2's route template; stack frames
  keep only `function@path:line:col` for the app's own origin, drop other origins' URLs to their
  origin, drop query strings, and keep at most 15 frames; `message` goes through L1's redaction.
  CSP reports (`csp-report.ts`) use the same `redactPath` and value redaction, so the two stay in
  line.
- **Limits:** a new `clientLogAttempts` limiter in `rate-limit.ts`: 30 events per minute per user
  (or per IP when signed out), counted per event, not per request. Plus a process-wide cap of 600
  events per minute; past it, drop and write one `client_log_dropped` line per minute with the
  count. Over the per-client limit, answer 429 with `Retry-After`.
- **Lines:** `client_error` at `warn` (it's the browser's error, not the server's) and
  `web_vital` at `info`, each with `userId?`, `page`, the event's fields, and the request's own
  `requestId` (the event's `requestId`, if any, as `relatedRequestId`).
- **Answer:** 204, or 400 for a bad body (no details beyond "That isn't a client report."), 413,
  415, 429.
- The proxy matcher can keep matching it (it needs no session refresh, but the CSP headers on a
  204 do no harm); add it to the skip list only if L4's spans show the session refresh costing a
  Supabase call per report.

**Tests:** valid batches of each kind; every limit; unknown keys; a stack with tokens, query
strings and foreign URLs comes out clean; signed-in and signed-out; the per-client and process
limits; that nothing in the body is logged unsanitised (a fuzz-style test feeding emails, JWTs,
`sb_secret_` values into every string field).

**Done when** a forged report with secrets in every field logs nothing secret, the limits hold,
and the endpoint answers 204 for a valid batch.

### L7: Browser side

**Files:** `src/lib/api/client.ts` (+ test), new `src/lib/client-log.ts` (browser reporter, +
test), new `src/components/web-vitals.tsx`, `src/app/layout.tsx`, `src/app/(app)/error.tsx`,
new `src/app/error.tsx` and `src/app/global-error.tsx`, `src/instrumentation-client.ts`.

- **Request id in messages:** `ApiError` gets `requestId` from the response's `x-request-id`
  header (or the 500 body's `requestId`). For status ≥ 500, the message ends with
  ` (ref <id>)`. 4xx messages stay as they are (they're the user's to fix). Network errors and
  timeouts (503/504 made up by the client) have no server id; they get none. Because every form
  shows `ApiError.message` through `useApiForm`, no form changes.
- **Reporter:** `reportClientEvent(event)` queues events and sends them in batches of up to 10,
  at most every 5 s and on `pagehide`/`visibilitychange: hidden`, with
  `fetch("/api/client-log", { method: "POST", keepalive: true, … })`. It dedupes identical error
  messages for 60 s, sends at most 20 events per page load, drops everything when the endpoint
  answers 429, and never throws or reports its own failures.
- **Hooks:** in `instrumentation-client.ts` (it already runs before the app; keep the zod
  `jitless` line first), add `window.addEventListener("error", …)` and
  `("unhandledrejection", …)`. Skip errors from browser extensions (`chrome-extension:`,
  `moz-extension:`, `safari-extension:` in the stack or filename) and `ResizeObserver loop`
  noise. `ApiError`s that reached `unhandledrejection` are reported with their `requestId`.
- **Error boundaries:** `src/app/(app)/error.tsx` reports `{ source: "boundary", digest }` once
  per error in a `useEffect`. Add `src/app/error.tsx` (pages outside `(app)`: login, join,
  consent) with the same look, and `src/app/global-error.tsx` (root layout failures; it must
  render its own `<html>` and `<body>`, see the Next docs in `node_modules/next/dist/docs/`). Both
  report with `source: "boundary"` and `"global_boundary"`.
- **Web Vitals:** a client component using `useReportWebVitals` from `next/web-vitals` (see
  `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-report-web-vitals.md`),
  with a stable callback, rendered once in the root layout. Report LCP, INP, CLS, TTFB and FCP for
  every page view (see "Decisions" on sampling).
- **Release:** pass the build's `GIT_SHA` (or the package version) to the client as
  `NEXT_PUBLIC_RELEASE` at build time, so stacks can be matched to a build. Check it's not a
  secret (it's a commit hash) and that S2's bundle scan still passes.
- **CSP:** the reporter only calls the app's own origin, so `connect-src 'self'` covers it; check
  the browser console shows no new violations.

**Tests:** `ApiError` message with and without an id, for 4xx, 5xx and network errors; reporter
batching, dedupe, the per-page cap, 429 back-off, and the `pagehide` flush (with fake timers and a
fake `fetch`); extension errors skipped.

**Done when** a forced client error (a dev-only button or `throw` in the console) shows up in
`docker logs` as a `client_error` line, and a forced 500 shows `(ref …)` in the form, whose id
finds the server's `request_failed` line.

### Checkpoint: the journald drop-in (George)

Before L8 merges (merging deploys), George on the VPS:

```bash
sudo mkdir -p /etc/systemd/journald.conf.d /var/log/journal
sudo tee /etc/systemd/journald.conf.d/expense-tracker.conf <<'EOF'
[Journal]
Storage=persistent
MaxRetentionSec=5day
SystemMaxUse=300M
EOF
sudo systemctl restart systemd-journald
journalctl --disk-usage
```

`MaxRetentionSec` and `SystemMaxUse` apply to the whole journal, not only the app's containers.
300 MB covers the app's lines for 5 days many times over (L12 measures it); the host's own logs
share the space.

### L8: Retention through journald

**Files:** `scripts/deploy.sh`, new `docs/logging.md`, `README.md` (one link), and a note for the
vps-apps README (as text in the PR for George to paste, since that's another repo).

- **Deploy:** both `docker run` calls use `--log-driver journald` with
  `--log-opt tag=expense-tracker/{{.Name}}` (and `--log-opt labels=…` only if needed). New env
  `LOG_DRIVER` (default `journald`, `json-file` allowed) for a host without journald, keeping
  the current `max-size`/`max-file` options for `json-file` only. Validate `LOG_DRIVER` like the
  other inputs. Keep the rollback path working: a rolled-back container keeps the driver it was
  started with.
- **Check at deploy time:** if `LOG_DRIVER=journald` and `docker info --format '{{.LoggingDriver}}'`
  plus a quick `docker run --rm --log-driver journald <image> true` fails, stop the deploy with a
  clear message before touching the running containers.
- **`docs/logging.md`**, the operator's page:
  - what a line looks like, the event names (generated from a grep of `log.*("` calls, listed
    with their level and one-line meaning), and what is never logged;
  - the journald drop-in above and how to check it (`journalctl --disk-usage`,
    `journalctl CONTAINER_NAME=expense-tracker --since "5 days ago" | head`);
  - query recipes over SSH:
    ```bash
    docker logs --since 1h expense-tracker 2>&1 | jq -c 'select(.level == "error")'
    journalctl CONTAINER_NAME=expense-tracker --since today -o cat | jq -c 'select(.requestId == "3fK9xQ2mBv0a")'
    journalctl CONTAINER_NAME=expense-tracker --since "-15min" -o cat | jq -c 'select(.event == "request" and .ms > 1000) | {route, ms, slowestSpan}'
    ```
  - how to change `LOG_LEVEL` and `LOG_SLOW_MS` (the env file, then redeploy);
  - a link to Obsy's Logs page once L10 is live.
- **Checks:** `deploy.sh` has no tests; run `bash -n` and `shellcheck` and describe a dry run in
  the PR (S12 did the same).

**Done when** both containers run with the journald driver in production, `docker logs` still
works, `journalctl` shows nothing older than 5 days, and `journalctl --disk-usage` stays under
300 MB.

### L9: Obsy logs API (Obsy repo)

**Repo:** `GeorgeDanicico/obsy`, branch `logs/l9-logs-api`. Read Obsy's own `AGENTS.md` and its
Next docs (`node_modules/next/dist/docs/`, Next 16.3) first. Obsy has no test runner yet: add
`vitest` (pinned) with a `test` script and run it in whatever CI the repo has (add a minimal
GitHub Actions workflow with typecheck and test if there is none).

- **`GET /api/logs`**, query: `container` (required, must be the `id` of an app in Obsy's apps
  config, such as `expense-tracker`, which Obsy maps to its `container` name; never a free
  string), `since` (`15m`, `1h`, `today`, `3d`, or an ISO time),
  `until` (optional ISO time), `level` (lowest level), `q` (plain text, ≤ 100 chars, matched
  case-insensitively against the raw line), `requestId` (exact match on the `requestId` field),
  `event` (exact), `limit` (default 500, max 2000).
- **Reading:** `execFile("docker", ["logs", "--timestamps", "--since", since, ...(until ? ["--until", until] : []), container], { maxBuffer: 20 MB, timeout: 10 s })`.
  Never a shell, never string-built arguments; `since`/`until` are converted to RFC 3339 times
  by Obsy before they're passed. Both stdout and stderr are read (the app writes warnings and
  errors to stderr). Parse each line: strip Docker's timestamp, `JSON.parse` the rest, and keep
  non-JSON lines as `{ level: "info", event: "raw", message }` (Next's own startup lines, for
  example). Filter, then return the **last** `limit` lines, newest first, as
  `{ lines: LogLine[], truncated: boolean, scanned: number }`.
- **Request-id search across containers:** `GET /api/logs?requestId=…` without `container`
  searches every configured container over the last 3 days and merges the results by time. A
  worker tick id (`tick-…`) works the same way.
- **Live tail:** `GET /api/logs/stream?container=…&level=…&q=…` returns Server-Sent Events from
  `spawn("docker", ["logs", "--follow", "--timestamps", "--since", "1s", container])`, applying the
  same filters per line. Kill the child process when the client disconnects (`request.signal`),
  after 15 minutes, or when the process limit is hit. At most 3 tails at once across all clients;
  a fourth gets 429. Send a heartbeat comment every 15 s so proxies keep the stream open.
- **Limits and safety:** at most 2 concurrent `docker logs` reads (queue or 429 beyond), each with
  the timeout above; lines longer than 16 KB are clipped; no endpoint can run any Docker command
  other than `logs`. The route is read-only and changes nothing.
- **Access:** reachable only the way Obsy already is (bound to `127.0.0.1` on the VPS through
  vps-apps' compose override, reached over Tailscale or SSH). Log lines carry user ids, so check
  in the PR that this binding is still in place, and say so.

**Tests:** argument building (container allowlist, time parsing, rejected inputs), line parsing
(JSON, non-JSON, Docker timestamps, clipped lines), filtering and ordering, the cross-container
merge, and the tail's process cleanup on abort (with a fake `spawn`).

**Done when** the API returns filtered lines from both expense-tracker containers on the VPS, a
request id finds its line in under a few seconds over 3 days of logs, and closing a tail kills its
`docker logs` process (check with `ps`).

### L10: Obsy Logs page (Obsy repo)

**Repo:** Obsy, branch `logs/l10-logs-page`.

- **`/logs`**: a container picker (from the apps config), level select, time range buttons
  (last 15 minutes, hour, today, 3 days), a text search box, a request-id box, and a "Live" toggle
  that switches to the stream. URL query parameters mirror the filters, so a link to a search can
  be shared.
- **Rows:** time (local), level as a coloured badge, event, route and status for `request` lines,
  `ms` (highlighted when `slow`), and the user id shortened. Clicking a row expands the whole JSON,
  pretty-printed, with spans as a small bar list sorted by `ms`. A request id in a row is a link
  that searches for it.
- **From the dashboard:** each container card gets a "Logs" link to `/logs?container=…&since=1h`,
  and an "Errors (1h)" count from a cheap `level=error&since=1h&limit=1`-style call (or skip the
  count if it costs a `docker logs` read per card per refresh; L11 can add it properly).
- **Live tail:** new lines appear at the top, capped at 1000 rows in the page; pause and resume;
  the stream closes when the tab is hidden for more than a minute.
- Follow Obsy's existing look (`app/globals.css`, `app/page.tsx`); no new UI library.

**Done when** a request id copied from an app error message (`(ref …)`) finds its `request_failed`
line in Obsy, and live tail shows new lines within a few seconds.

### L11 (optional): Simple metrics from the logs (Obsy repo)

**Repo:** Obsy, branch `logs/l11-log-metrics`.

- An aggregation over the last 15 minutes of `request` lines (one `docker logs --since 15m` read,
  cached for 30 s): requests per minute, error rate (status ≥ 500), 429 count, and p50/p95 `ms`
  per route template (routes with fewer than 5 requests grouped as "other").
- **Worker heartbeat age:** time since the last `tick` line of the worker container, shown red
  past 3 tick intervals.
- Shown on the dashboard's expense-tracker card and as a table on `/logs`.

**Tests:** percentile maths against a hand-computed set; grouping; heartbeat age.

**Done when** the numbers match a manual `jq` count over the same window.

### L12: Measure and close

**Files:** `docs/logging.md`, `docs/family-hub-roadmap.md`, `docs/security-plan.md` (the
"tighten after phase 15's logs" decisions), a short report section in `docs/logging.md`.

- **Overhead:** compare the web container's memory and CPU (Obsy's numbers) for a day before
  L2 and a day after L4; the p50 of a cheap route (`GET /api/account`) before and after. Record
  log volume per day in MB (`journalctl --disk-usage` and per-container
  `journalctl CONTAINER_NAME=… -o cat | wc -c`), and check 5 days fits well under 300 MB.
- **Smoke test** in production, written up as a checklist with results: a 500 shows `(ref …)` and
  Obsy finds it; a slow request shows its `slowestSpan`; a client error and the Web Vitals
  arrive; a CSP report arrives; the worker's ticks have spans; `journalctl` has nothing older than
  5 days.
- **Baselines for phase 16:** p50/p95 per route and the slowest spans over a few days of real use,
  and LCP/INP per page, as a table in `docs/logging.md` that phase 16 measures against.
- **Rate limits (security plan decisions):** requests per user per minute at the 99th percentile
  and the count of 429s, with a recommendation for `userReadRequests`, `userWriteRequests` and
  the sign-in limits. George decides; this task only reports.
- Update the roadmap's phase 15 section to "done", linking this plan and `docs/logging.md`.

**Done when** the numbers and the checklist are merged, and George has what he needs to
tighten the rate limits and start phase 16.

## Decisions for George

| Decision | Recommendation |
| --- | --- |
| Log user ids? | Yes, the UUID only (the roadmap already says so). Never emails or names. |
| Log client IPs? | No. Rate-limit refusals log the route and user id; the IP adds little behind Tailscale and is personal data. |
| Trust an incoming `x-request-id`? | No. The server always makes its own, so nobody can plant an id in the logs. |
| Request-id length | 12 characters: short enough to read out from a phone, unique enough for a family's traffic. |
| Web Vitals sampling | 100% of page views. The app has a handful of users, and the endpoint caps each one at 30 events a minute. Revisit if the logs grow past 50 MB a day. |
| Client reports from signed-out pages | Accept them, under the per-IP limit and the process-wide cap, so login and join errors are seen. |
| `LOG_LEVEL` in production | `info`. Switch to `debug` for a day when chasing something, then back. |
| Retention | 5 days and 300 MB, as in the roadmap. |
| `pino` | Not unless L12's numbers show the hand-written logger costs something. |
| Obsy access | Keep it as it is (bound to `127.0.0.1`, reached over Tailscale or SSH). Logs carry user ids, so no wider exposure. |

## Not in this plan

- **A log line per page view.** Pages are mostly app shells that load their data through the API,
  which is logged. Server render errors are logged through `onRequestError` (L3).
- **OpenTelemetry, a tracing backend, Loki, Grafana or Elasticsearch.** Next's
  `instrumentation.ts` with OpenTelemetry stays an option if spans in a line ever aren't enough.
- **Alerts** (email or push when errors spike). Worth considering once L11's error rate exists.
- **One `AppError` class** (the rest of D3) and the database-error translator: phase 18.
- **Performance fixes** found by the spans: phase 16.
- **Shipping logs off the VPS.** Backups of logs aren't needed; 5 days on the box is the point.
