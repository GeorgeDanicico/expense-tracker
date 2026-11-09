# Logging

How to read the app's logs: what a line looks like, which events exist, what is never written, how
long lines are kept, and the commands for the questions you will actually ask. Written for the
operator (George, over SSH on the VPS). The design behind it is in
[logging-plan.md](logging-plan.md). The performance report built from these lines (Web Vitals per
page, server time per route, Auth calls per request) is in [performance.md](performance.md).

The short version: the web app and the worker write **one JSON object per line** to stdout and
stderr. Docker's `journald` driver hands those lines to the host's journal, which keeps them for
**5 days** and at most **300 MB**. `docker logs` still works, and so does `journalctl`.

## What a line looks like

```json
{"time":"2026-11-03T09:14:07.512Z","level":"info","event":"request","requestId":"3fK9xQ2mBv0a","method":"GET","route":"/api/expenses/:id","status":200,"ms":38,"userId":"6f1c…","spans":[{"name":"db.expenses","ms":12}],"dbMs":12,"dbCalls":1}
```

- `time`, `level` and `event` come first on every line. `level` is `debug`, `info`, `warn` or `error`.
  `event` is a `snake_case` name; the list is below.
- `requestId` is 12 characters of randomness the server makes for each request (it never trusts one
  sent by the client). The same id is on every line the request writes and on the `x-request-id`
  response header. When a 5xx or network error reaches the screen, its message ends with
  `(ref 3fK9xQ2mBv0a)`: that is the id to search for. The worker's ticks use `tick-<12 characters>`.
- The `request` line is the summary of one API request: `method`, `route` (a template such as
  `/api/expenses/:id`, never the raw path), `status`, `ms`, `userId` when signed in, and `spans`.
  Spans are the timed pieces inside the request (each Supabase call, Web Push and AI call); `dbMs`
  and `dbCalls` add up the Supabase ones. A request slower than `LOG_SLOW_MS` is written at `warn`
  with `slow: true` and a `slowestSpan`.
- Levels on `request` lines: `info`, `warn` for slow or 429, `error` for 5xx.
- `debug` and `info` lines go to stdout, `warn` and `error` to stderr. `docker logs` shows both; add
  `2>&1` before piping it to `jq`.

## Events

### Web app (container `expense-tracker-web`)

| Event | Level | Meaning |
| --- | --- | --- |
| `request` | info, warn, error | One per API request (see above). `warn` when slow or 429, `error` when 5xx. `/health` is not logged. |
| `request_failed` | error | A route threw an unexpected error; the user got a generic 500. Carries the error name, message and stack, and the request's `method`, `route` and `userId`. |
| `server_render_failed` | error | An error Next caught outside the API routes: a page that threw, a server action. Carries `digest` (the id the browser's error page shows), `routePath`, `routeType` and the `requestId` when known. |
| `env_check_failed` | error | A required environment variable is missing or invalid at start-up. Names the variable, never its value; the process exits with 1. |
| `env_optional_off` | info | At start-up, which optional features are off because their variables are not set. |
| `csp_violation` | warn | The browser reported a Content-Security-Policy violation (`POST /api/csp-report`). Paths are redacted. |
| `client_error` | warn | An error from the browser (`window` error, unhandled rejection, error boundary), sent to `POST /api/client-log`. The line's own `requestId` is the report's request; `relatedRequestId` is the API request that caused the error, if any. |
| `web_vital` | info | A Web Vitals measurement from the browser (`LCP`, `INP`, `CLS`, `TTFB`, `FCP`) with its rating and page. |
| `client_log_dropped` | warn | The browser-report endpoint dropped reports because of its process-wide limit; at most one line a minute, with the count. |
| `client_log_user_failed` | debug | The signed-in user of a browser report could not be read; the report is logged without a `userId`. |
| `mcp_tool_refused` | info | An AI-assistant (MCP) tool call was refused for an expected reason (validation, permission, not found). Carries `tool` and `status`. |
| `mcp_tool_failed` | error | An MCP tool call crashed. Carries `tool` and the error, never the arguments. |
| `last_active_failed` | debug | Updating a user's "last active" time failed. Best effort, so debug only. |
| `kid_sessions_signout_failed` | error | A parent reset a kid's password, but ending the kid's other sessions failed. |
| `password_change_signout_failed` | error | A password changed, but signing out the user's other sessions failed. |
| `kid_account_cleanup_failed` | error | Creating a kid account failed half-way and removing the half-made auth user failed too: an orphan to delete by hand. |
| `auth_user_cleanup_failed` | error | Same idea for a new auth user without a profile row. |
| `avatar_delete_failed` | error | Removing a profile picture from storage failed (the file is left behind; harmless). |
| `account_deleted_cookie_clear_failed` | error | An account was deleted but clearing the browser's session cookie failed. |

### Worker (container `expense-tracker-worker`, see "Container names" below)

The worker's lines have no `method`. Each tick runs under its own id, `tick-<12 characters>`.

| Event | Level | Meaning |
| --- | --- | --- |
| `started` | info | The worker started: build `version`, tick interval and whether push is configured. |
| `start_failed` | error | The worker could not start (a required variable is missing or invalid, or the store could not be created); exits with 1. |
| `stopping` / `stopped` | info | SIGTERM or SIGINT arrived; the current tick finishes, then the process exits with 0. |
| `forced_exit` | error | A second stop signal arrived while stopping; exits with 1. |
| `tick` | info, warn | One per tick (every 30 seconds): counts of reminders, events, to-dos and notifications handled, `ms`, `spans`, `dbMs`, `dbCalls`. `warn` with `slow: true` and a `slowestSpan` when it took too long. |
| `tick_failed` | error | A whole tick failed; the next one tries again. |
| `push_not_configured` | error | The VAPID keys are missing or invalid. Notifications stay pending. With a tick it carries how many are waiting. |
| `notification` | info, warn | An outbox row ended as `skipped` or `failed` (`info`), or went back to `pending` for another try (`warn`). Sent ones are only counted in `tick`. |
| `notification_failed` | error | Delivering one row threw; its lease runs out and it is claimed again. |
| `notification_bookkeeping_retry` | warn | A push went out but saving that failed; the write is tried once more. |
| `notification_bookkeeping_failed` | error | The write failed again. The row is finished on a later tick without sending the push a second time. |
| `notification_resend_skipped` | warn | A row that was already pushed is finished without pushing again. |
| `device_delete_failed` | error | A browser subscription that the push service reported gone could not be deleted. |
| `reminder_claim_failed` | error | Claiming due reminders failed; the rest of the tick still runs. |
| `reminder_failed` | error | Queueing one reminder's notification failed; it is claimed again after its lease. |
| `event_claim_failed` | error | Claiming due calendar events failed. |
| `event_failed` | error | Queueing one calendar event's notifications failed. |
| `todos_due` | info | The daily "Due today" to-do pass ran, with counts. |
| `todos_due_failed` | error | Listing the to-dos due today failed; the pass runs again next tick. |
| `todo_due_failed` | error | Queueing one to-do's notification failed; the day is not marked done, so the next tick retries it. |
| `cleanup` | info | Daily: old sent and skipped notifications deleted (count). |
| `cleanup_failed` | error | That clean-up failed; tried again next tick. |
| `import_drafts_purged` | info | Daily: expired statement-import drafts deleted (count only). |
| `import_drafts_purge_failed` | error | That purge failed; tried again next tick. |

To regenerate this list after code changes:

```bash
grep -rnoE 'log(\.[a-z]+|\[[^]]+\])\("[a-z_]+"' src | grep -v '\.test\.'
```

Browser reports are the exception: `client_error` and `web_vital` are chosen at run time in
`src/lib/log/client-report.ts`.

## What is never logged

Two layers keep secrets out (`src/lib/log/redact.ts`):

- **By field name.** Any field whose name contains `password`, `passcode`, `secret`, `cookie`,
  `authorization` or `apikey`, ends with `token`, or is exactly `email`, `emails`, `code`, `body`,
  `payload`, `prompt`, `answer` or `rows` is written as `[redacted]`. (`code` is kept only when it is
  an error code such as `PGRST116`; an invite code is never kept.)
- **By value.** Whatever the field is called, a string shaped like a Supabase key (`sb_secret_…`),
  a `Bearer` credential, a JWT, an email address, or a run of 32 or more base64url characters is
  replaced by `[redacted]`. UUIDs and git commit hashes are kept: they are ids.

So the logs do not contain: emails, passwords, tokens, cookies, `Authorization` headers, request or
response bodies, query strings, invite codes, calendar feed tokens, statement rows, AI prompts or
answers. They do contain what you need to find a request: user ids (UUIDs), family and record ids,
route templates, status codes, durations, counts, and error names and codes. Strings are cut at 500
characters, and objects and arrays are bounded in depth and size.

If you ever see a secret in a line, treat it as a leak (see
[incident-checklist.md](incident-checklist.md)) and add a rule and a test in `redact.ts`; do not
rename the field to hide it.

## How long lines are kept: the journald drop-in

`scripts/deploy.sh` starts both containers with Docker's `journald` log driver
(`--log-driver journald --log-opt tag=expense-tracker/{{.Name}}`). The host's journal decides how
long the lines stay, so retention is by time, not by size. This file must exist on the VPS (it is a
one-time setup, not part of the deploy):

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

`MaxRetentionSec` and `SystemMaxUse` apply to the **whole journal**, not just these containers, so
the host's own logs share the 300 MB. Without the drop-in, the journal may be kept in memory only
(lost at reboot) or grow to journald's default limits.

**Check it** (any of these should look right after a deploy):

```bash
docker inspect -f '{{.HostConfig.LogConfig.Type}}' expense-tracker-web expense-tracker-worker   # journald
journalctl --disk-usage                                                    # well under 300 MB
journalctl CONTAINER_NAME=expense-tracker-web --since "5 days ago" | head  # the oldest line is under 5 days old
journalctl -t expense-tracker/expense-tracker-web -n 5 -o cat              # the tag works too
systemd-analyze cat-config systemd/journald.conf | grep -E 'Storage|MaxRetention|SystemMaxUse'
```

Notes:

- Reading the journal needs `sudo`, or membership of the `systemd-journal` group.
- The container name in a line (`CONTAINER_NAME`) is the one the container had **when it started**,
  so a container that was later renamed to `…-previous` during a deploy keeps its old name in the
  journal. Lines from before and after a deploy therefore sit under one name.
- The first deploy with journald removes the old `json-file` containers, and their log files go
  with them. From then on lines survive deploys, because the journal belongs to the host.
- journald rate-limits per service (by default 10000 messages per 30 seconds for the Docker daemon).
  This app writes a few lines per request, far below that. If you ever see
  `Suppressed N messages from docker.service`, a loop is logging far too much.

If the host has no journald, set `LOG_DRIVER=json-file` in `/etc/vps-apps/expense-tracker.sh` and
redeploy. Retention is then by size (`LOG_MAX_SIZE`, default `10m`, and `LOG_MAX_FILES`, default
`3`, per container) and `docker logs` is the only way to read. When `LOG_DRIVER=journald` (the
default), the deploy first starts a throwaway container with the driver and stops with a clear
message, before touching the running containers, if that fails.

## Container names

`scripts/deploy.sh` names the web container `CONTAINER_NAME` (default `expense-tracker`) and the
worker `WORKER_CONTAINER_NAME` (default `${CONTAINER_NAME}-worker`). The vps-apps adapter sets
`CONTAINER_NAME=expense-tracker-web`, and in production the worker is `expense-tracker-worker`
(checked with `docker ps` on 3 November 2026; the host config sets `WORKER_CONTAINER_NAME`, since the
script's default would be `expense-tracker-web-worker`). The recipes below use those two names; check
yours with `docker ps --format '{{.Names}}'`.

## Recipes

Run these on the VPS. `jq` must be installed (`sudo apt install jq`). Use `-o cat` with
`journalctl` so only the JSON line is printed.

Errors from the web app in the last hour, straight from Docker:

```bash
docker logs --since 1h expense-tracker-web 2>&1 | jq -c 'select(.level == "error")'
```

Everything that happened for one request id (a family member read out `ref 3fK9xQ2mBv0a`). It also
finds the browser's report about it, whose `relatedRequestId` is that id:

```bash
journalctl CONTAINER_NAME=expense-tracker-web --since today -o cat \
  | jq -c 'select(.requestId == "3fK9xQ2mBv0a" or .relatedRequestId == "3fK9xQ2mBv0a")'
```

Slow requests in the last 15 minutes, with the slowest piece of each:

```bash
journalctl CONTAINER_NAME=expense-tracker-web --since "-15min" -o cat \
  | jq -c 'select(.event == "request" and .ms > 1000) | {route, ms, slowestSpan}'
```

Warnings and errors from both containers over the last day:

```bash
journalctl CONTAINER_NAME=expense-tracker-web CONTAINER_NAME=expense-tracker-worker --since "-1day" -o cat \
  | jq -c 'select(.level == "warn" or .level == "error")'
```

Everything one user did (a user id from the Supabase dashboard, not an email: emails are not logged):

```bash
journalctl CONTAINER_NAME=expense-tracker-web --since today -o cat \
  | jq -c 'select(.userId == "6f1c2a3e-0000-0000-0000-000000000000") | {time, event, method, route, status, ms}'
```

Requests per route and status, today (a quick look at errors and 429s):

```bash
journalctl CONTAINER_NAME=expense-tracker-web --since today -o cat \
  | jq -r 'select(.event == "request") | "\(.route) \(.status)"' | sort | uniq -c | sort -rn | head -20
```

Is the worker alive? The latest ticks:

```bash
docker logs --tail 200 expense-tracker-worker 2>&1 | jq -c 'select(.event == "tick" or .event == "tick_failed")' | tail -3
```

Browser errors and poor Web Vitals today:

```bash
journalctl CONTAINER_NAME=expense-tracker-web --since today -o cat \
  | jq -c 'select(.event == "client_error" or (.event == "web_vital" and .rating == "poor"))'
```

Follow the logs live (Ctrl-C to stop):

```bash
docker logs -f --since 1m expense-tracker-web 2>&1 | jq -c .
```

`jq` stops with `parse error` if a non-JSON line comes by (for example Node's own warning at
start-up). Use `jq -R 'fromjson? | select(...)'` to skip those lines.

## Changing `LOG_LEVEL` and `LOG_SLOW_MS`

Both are ordinary environment variables for the two containers (see `.env.example`):

- `LOG_LEVEL` is the lowest level written: `debug`, `info` (default), `warn` or `error`. `debug` adds
  the quiet lines (`last_active_failed`, `client_log_user_failed`, CSP-report request lines).
- `LOG_SLOW_MS` is how many milliseconds a request may take before its `request` line is a `warn`
  with `slow: true` (default `1000`).

Containers read the env file only **when they are created**. Edit `/etc/expense-tracker/.env.production`,
then replace the containers with a forced deploy (`docker restart` is not enough); see
[incident-checklist.md](incident-checklist.md) for the command. Set `LOG_LEVEL` back to `info` when
you are done: `debug` writes noticeably more.

`LOG_DRIVER`, `LOG_MAX_SIZE` and `LOG_MAX_FILES` are different: they are read by `scripts/deploy.sh`
on the host (set them in `/etc/vps-apps/expense-tracker.sh`), not by the app.

## Obsy

The Logs page in Obsy (search by request id, live tail) is planned in L10 of the logging plan.
_Link to be added here when it is live._
