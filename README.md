# iFam

A private, mobile-first family app, starting with an expense tracker. Built with Next.js 16, React 19, Chakra UI 3, and Supabase. It uses CSS files and Chakra styling—there is no Tailwind configuration or dependency.

## Included

- Email/password authentication with cookie-based Supabase SSR sessions
- Authenticated dashboard for the current month
- Historical statistics for 3 months, 6 months, 1 year, 2 years, or one custom day/month
- Monthly expense ledger with month/year navigation
- Add and delete expense entries
- Native-currency Net Worth view with manual assets, liabilities, dated valuations, and read-only investment holdings
- Per-account currency setting applied to every amount and export
- Secured `.xlsx` export for any selected month
- Installable PWA manifest, icons, and an offline shell
- Responsive desktop sidebar and safe-area-aware mobile navigation
- Searchable, category-filtered expense table with dedicated phone cards
- Owner-only Supabase RLS policies, explicit grants, input constraints, and query indexes
- Database-side dashboard aggregation so historical rows are not transferred to the app server
- Remote MCP server at `/api/mcp` so Claude can read and record ledger data
- Family hub (behind `FAMILY_ENABLED`): families, parent and kid roles, per-kid permissions, and a family view of finances; see [Family hub](#family-hub)

## Run locally

The connected Supabase URL and publishable key are already present in the ignored `.env.local` file as server-only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values. Set `PRICE_SERVICE_URL` to the base URL of the investment price service. `FAMILY_ENABLED=true` turns on the family features described under [Family hub](#family-hub); leave it `false` (or unset) to keep them off. `SUPABASE_SECRET_KEY` (the project's secret API key) is optional: the app starts without it, but creating kid accounts, signing in with a username and personal MCP tokens need it. It bypasses every database rule, so keep it only in server env files, never in the browser or in logs. For another project, copy `.env.example` to `.env.local` and replace the values. Keep these variables server-only; do not add a `NEXT_PUBLIC_` prefix.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

New accounts use `EUR` by default. Each signed-in user can change their account currency from **Settings**; the selection applies to dashboards, expense entry, lists, and Excel exports.

## Required Supabase Auth setting

The hosted Supabase project has Email/password authentication enabled. Confirm these settings if you connect the app to another project:

1. Open Supabase Dashboard → Authentication → Sign In / Providers → Email and enable email/password sign-ins.
2. Under Authentication → URL Configuration, set the local Site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/confirm` as a redirect URL.
3. Use the standard PKCE confirmation template below. It uses the callback URL supplied by signup, so local and deployed environments do not get mixed up. The app also supports this project's existing six-digit OTP link at `/confirm-email`.
4. For production, replace those URLs with the final HTTPS origin and update the server-only `SITE_URL`.

Recommended confirmation-template link:

```html
<a href="{{ .RedirectTo }}&amp;token_hash={{ .TokenHash }}&amp;type=email">
  Confirm your iFam account
</a>
```

For stronger password security, also enable leaked-password protection and keep the email OTP expiry at or below one hour in Supabase Auth settings.

## Database

Migrations live in `supabase/migrations`. They add or upgrade the expense ledger without deleting the earlier empty starter tables, then apply:

- positive amount, category, description, and note constraints;
- a validated per-account currency preference, defaulting existing accounts to `EUR`;
- indexes aligned with the ledger's owner, date, and creation-time filters;
- an owner-scoped dashboard aggregation function that runs under RLS;
- authenticated-only SELECT, INSERT, UPDATE, and DELETE policies scoped to `auth.uid()`;
- RLS-protected `net_worth_items` and `net_worth_valuations` with atomic first-value creation;
- anonymous privilege revocation and hardened legacy tracker policies/functions.

## Family hub

The family hub lets people share the app as a family. Someone creates a family and becomes its creator, then invites others with a parent or kid code or link. Parents can see everyone's expenses, investments and net worth, switch between members, and manage the family. Kids see only what their parents allow, set per module, and parents can create and remove kid accounts, reset their passwords, and delete the family. Phase 1 is described in [docs/family-hub-roadmap.md](docs/family-hub-roadmap.md).

- **`FAMILY_ENABLED`:** set it to `true` to turn the family features on. When it is `false` or unset, none of the family code runs, its API routes answer 404, and the app behaves as a single-user ledger.
- **`SUPABASE_SECRET_KEY`:** the project's secret API key, server-only. Creating a kid account and signing in with a username need it, as do personal MCP tokens; without it the app still starts and email sign-in works, but those fail safely. It bypasses every database rule, so never expose it to the browser or logs.
- **Kid sign-in by username:** a kid has no email address. A parent picks a username and a first password, and the kid signs in with that username on the normal sign-in page and must choose a new password straight away. Behind the scenes the account uses a placeholder email on `kids.ifam.invalid`. A kid can add a real email later.

## MCP / Claude

The app exposes its ledger to Claude as a remote [MCP](https://modelcontextprotocol.io) server, so Claude Code or another MCP client can read and record expenses, tabs, net worth, and investments on your behalf. Every tool runs as you under the same Supabase RLS policies as the web app. The full design is in [docs/mcp-access-plan.md](docs/mcp-access-plan.md).

- **Endpoint:** `/api/mcp`, stateless Streamable HTTP. Only `POST` is served; `GET` and `DELETE` return 405.
- **Turn it on first:** **Settings → AI assistants → "Let AI assistants use your account"**. It's off by default, for everyone. While it's off, every connected app and every personal token of yours is refused with 403; turning it back on lets them in again.
- **Two ways in:** connect an app through **OAuth** (anything with a browser), or use a **personal access token** on a machine without one. There are no passwords: an MCP client never sees yours.

Tools (the destructive ones carry the MCP `destructiveHint` annotation):

- **Account:** `get_account`
- **Expenses:** `list_expenses`, `get_spending_summary`, `add_expense`, `update_expense`, `delete_expense` (destructive)
- **Expense tabs:** `list_expense_tabs`, `get_expense_tab_expenses`, `create_expense_tab`, `update_expense_tab`, `delete_expense_tab` (destructive)
- **Net worth:** `get_net_worth`, `add_net_worth_item`, `update_net_worth_item`, `add_net_worth_valuation`, `update_net_worth_valuation`
- **Investments:** `get_investments`, `list_investment_transactions`, `add_investment_transaction`, `delete_investment_transaction` (destructive)
- **Family to-do board** (only while `FAMILY_ENABLED` is on; a caller without a family is refused): `list_todos`, `add_todo`, `move_todo`, `update_todo`, `delete_todo` (destructive). Assignees are given by member name or `me`.
- **Family calendar** (only while `FAMILY_ENABLED` is on; a caller without a family is refused): `list_events` (a range of at most 92 days, optionally one member's), `add_event` (with an optional daily or weekly repeat of 2 to 10), `update_event`, `delete_event` (destructive). Dates are `YYYY-MM-DD` and times `HH:MM` in Europe/Bucharest; attendees are given by member name, `me` or `everyone`; in a repeating series `scope` picks `this` (the default), `following` or `all` occurrences.

### Connecting through OAuth

OAuth is run by Supabase Auth's OAuth 2.1 server; the app serves the consent page and `/.well-known/oauth-protected-resource`. In Claude Code:

```bash
claude mcp add --transport http ifam <SITE_URL>/api/mcp
```

Then run `/mcp` in Claude Code, pick `ifam` and **Authenticate**. Your browser opens the iFam sign-in page if you're signed out, then a page saying "Claude Code (ifam) wants to use your iFam account". Check that it sends you back to `localhost`, and click **Allow**. The connection then refreshes itself. Settings → AI assistants lists every connected app with when it was connected; **Disconnect** refuses that app's very next call. Claude Code registers itself again each time its authentication is cleared, so the same name can appear more than once: disconnect the old ones.

While you have no connected apps, Settings → AI assistants shows this command with your address filled in.

### Personal access tokens, for machines without a browser

For a server, or Claude Code over Remote Control, where the OAuth redirect to `localhost` can't complete. Use OAuth wherever you can.

1. In **Settings → AI assistants → Personal access tokens**, create a token with a name and an expiry: 1 month, 3 months (the default), 6 months, or never (not recommended: a leaked token keeps working until you revoke it).
2. Copy it straight away. The token (`sl_mcp_…`) is **shown once**; only its hash is stored, so a lost token can't be recovered. Regenerate it instead.
3. Add it to the client:

   ```bash
   claude mcp add --transport http ifam <SITE_URL>/api/mcp --header "Authorization: Bearer sl_mcp_…"
   ```

The list shows each token's prefix, when it was created and last used, and its expiry. **Regenerate** stops the old value at once; **Revoke** refuses the next call. You can have at most 10 live tokens. Personal tokens need **`SUPABASE_SECRET_KEY`** on the server; without it, a token request answers 503 and OAuth still works.

### Kids

A kid can use AI assistants only when all three hold: a parent has turned on their **AI assistants** permission in Manage family (off by default), the kid has added and confirmed a real email address (not the generated `kids.ifam.invalid` one), and the kid has turned their own switch on. Kids connect through **OAuth only**; they can't create personal tokens, and an adult's tokens stop working if that adult joins a family as a kid.

### Security notes

- Every request is checked again: turning your switch off, a parent turning a kid's permission off, disconnecting an app or revoking a token all take effect on the next call.
- OAuth tokens and personal tokens work only on `/api/mcp`; the REST API refuses both, and neither can sign in to the web app or change a password.
- Production must be served over HTTPS. The deploy workflow binds the container to `127.0.0.1:3000`. For private access from your own devices, run `sudo tailscale serve --bg 3000` on the VPS and set `SITE_URL` to the resulting `https://<host>.<tailnet>.ts.net` origin. `SITE_URL` must be exactly the address clients are given, since the OAuth challenge points at it.
- Personal tokens live in your local Claude config, so keep those files private.
- After 5 bad personal tokens within 15 minutes from one client IP (30 bad app tokens, for OAuth apps), requests from that IP return 429 until the window passes. Failures are keyed by IP only, never by the token's prefix, which the caller chooses.
- A personal token's session is cached in server memory. A restart or redeploy only means a fresh session on the next request.
- Browser requests with an `Origin` other than `SITE_URL` are rejected with 403 (DNS-rebinding guard). Without `SITE_URL`, only localhost origins are accepted; Claude Code sends no `Origin`.
- The REST API (and sign-in) refuses writes from other sites the same way: a `POST`, `PUT`, `PATCH` or `DELETE` with `Sec-Fetch-Site: cross-site` or `same-site`, or with an `Origin` other than `SITE_URL`, gets 403, and JSON bodies must be `application/json` and at most 64 KB. Browsers mark the app's own requests `Sec-Fetch-Site: same-origin`, which is trusted on its own; only a browser that doesn't send that header has its `Origin` compared with `SITE_URL`, so keep `SITE_URL` set to the address you open the app at. The rules and the one exemption (`/api/mcp`) are in `src/lib/http/guard.ts`.

### Rate limits and the client IP

Every route has a request limit (a sliding one-minute window; a limited request gets 429 with `Retry-After`): 600 reads and 120 writes per signed-in user, 60 per client IP on the pages and endpoints that need no session, and the MCP and CSP-report limits. All the numbers and where each one is applied are in the table in `src/lib/http/rate-limit.ts`.

Limits by IP use the address from `X-Forwarded-For`, but only the hop our own proxy added: the last one by default (`TRUSTED_PROXY_HOPS=1`, one proxy such as Tailscale Serve). Anything earlier in the header comes from the client and is ignored, so sending a made-up `X-Forwarded-For` doesn't reset a limit. This assumes the proxy in front of the app appends the client's address to `X-Forwarded-For` (Next fills the header from the connection itself when nothing sent one); if it doesn't, every client shares the proxy's address and one limit. Set `TRUSTED_PROXY_HOPS=2` if a second proxy sits in front of the first, or `0` to ignore the header and put every client in one bucket. Without a usable address, requests share one `unknown` bucket.

## Docker on a VPS

Build the production image on the VPS or a Linux CI runner matching its architecture:

```bash
docker build -t expense-tracker:latest .
```

The multi-stage build uses a pinned Node.js 24 Debian slim image, caches npm downloads
and Next.js build work, and copies only the standalone server and static assets into
the runtime image. It runs as the unprivileged `node` user. The build needs internet
access for npm packages and Google fonts, but no Supabase credentials.

Create `/etc/expense-tracker/.env.production` on the VPS with `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `PRICE_SERVICE_URL`, and `SITE_URL` (your public HTTPS origin). Add
`SUPABASE_SECRET_KEY` when kid accounts, username sign-in or personal MCP tokens are in use; it bypasses every database
rule, so make the file readable only by the runner user (`chmod 600`). The
self-hosted GitHub Actions runner must be able to read this file.
Environment files are excluded from the build context and supplied at runtime:

```bash
docker run -d --name expense-tracker \
  --restart unless-stopped \
  --env-file /etc/expense-tracker/.env.production \
  --publish 127.0.0.1:3000:3000 \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --tmpfs /app/.next/cache:rw,noexec,nosuid,nodev,uid=1000,gid=1000,size=128m \
  --security-opt no-new-privileges --cap-drop ALL \
  --memory 768m --memory-swap 768m \
  --log-driver journald --log-opt 'tag=expense-tracker/{{.Name}}' \
  expense-tracker:latest
```

The hardening and logging flags are the ones `scripts/deploy.sh` uses (see "Hardened containers"
below). Logs go to the host's journald, which keeps them for 5 days; a host without journald uses
`--log-opt max-size=10m --log-opt max-file=3` instead, or `LOG_DRIVER=json-file` with the script.
How to read the logs, the events and the retention setup are in [docs/logging.md](docs/logging.md).

The same image also holds the notifications worker (`worker.js`, bundled by
`npm run build:worker`). It needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, has no port, and
writes a heartbeat to `worker_heartbeats` every 30 seconds. Every tick it sends the due
notifications as Web Push to each of the recipient's browsers, and once a day it deletes sent and
skipped notifications older than 30 days. Run it next to the web container:

```bash
docker run -d --name expense-tracker-worker \
  --restart unless-stopped \
  --env-file /etc/expense-tracker/.env.production \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --tmpfs /app/.next/cache:rw,noexec,nosuid,nodev,uid=1000,gid=1000,size=128m \
  --security-opt no-new-privileges --cap-drop ALL \
  --memory 256m --memory-swap 256m \
  --log-driver journald --log-opt 'tag=expense-tracker/{{.Name}}' \
  expense-tracker:latest node worker.js
```

Both containers check their environment when they start (`src/lib/env.ts`). The web app needs
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; the worker needs `SUPABASE_URL` and
`SUPABASE_SECRET_KEY`. Without one, the process prints which variable is missing or invalid (never
its value) and exits with 1, so `docker logs` says why. Everything else is optional: the web app logs
one line naming the features that are off, and the worker keeps running without the VAPID keys (it
still runs its daily clean-up). `.env.example` lists every variable.

`docker stop` lets the current tick finish before the worker exits.

#### Web Push (VAPID) keys

Browser notifications are signed with a VAPID key pair. Generate it once with
`npx web-push generate-vapid-keys` and put these in the env file both containers read:

- **`VAPID_PUBLIC_KEY`:** the public key. The web app hands it to browsers
  (`GET /api/notifications/push-key`) when they subscribe; it isn't secret.
- **`VAPID_PRIVATE_KEY`:** the private key, read only by the worker. Secret: never commit, log or
  expose it. Changing the pair makes every existing browser subscription stop working, so each
  device has to press **Enable on this device** again.
- **`VAPID_SUBJECT`:** a contact for the push services, `mailto:you@example.com` or an `https:` URL.

Without them the web app answers 503 to the push-key request (Settings → Notifications can't
enable a device) and the worker logs `push_not_configured` every tick, leaving notifications
pending until the keys are set; it doesn't exit. Web Push needs HTTPS (or `localhost`).

To try push locally, generate a separate pair for development (never reuse the production keys),
add the three variables and `NEXT_PUBLIC_SW_IN_DEV=true` to `.env.local`, run `npm run dev`, and run
the worker with `npm run build:worker && node --env-file=.env.local dist/worker.js`.
`NEXT_PUBLIC_SW_IN_DEV=true` registers the service worker in development too; it's off by default
so the offline page doesn't get in the way of everyday development.

Point a host-based HTTPS reverse proxy at `127.0.0.1:3000`. Preserve Next.js cache
headers, avoid shared caching of authenticated pages and API responses, and disable
response buffering for streaming. Update the Supabase Auth redirect URLs to your
production origin as described above. Expense data stays in hosted Supabase.

### Automated self-hosted deployment

`.github/workflows/deploy.yml` runs on every push to `main` and can also be started
manually. It checks out the latest commit on a self-hosted runner, calls
`scripts/deploy.sh`, builds the Dockerfile, starts the new image, and verifies that
the app responds before removing the previous container. If startup fails, the
script attempts to restore the previous container. Once the web container is healthy, it starts
or replaces the `expense-tracker-worker` container from the same image; if the new worker
doesn't stay up, it restores the previous worker and warns, without rolling the web app back.

Register a Linux self-hosted runner with Docker access, create the production
environment file at `/etc/expense-tracker/.env.production`, and ensure the runner
user can read it and use Docker. To use a different environment-file path, add a
repository variable named `DEPLOY_ENV_FILE`. The workflow publishes the container
on `127.0.0.1:3000` by default, matching the Docker command above.

### Hardened containers

`scripts/deploy.sh` starts the web and worker containers with the same flags as the examples above:

- `--read-only`: the container's filesystem can't be written. The only writable places are two
  in-memory mounts: `/tmp`, and `/app/.next/cache`, where Next.js keeps the optimized-image cache
  (it starts empty after a restart and fills again on demand). Nothing else the app does touches the
  disk: avatars (sharp), statement PDFs and push all work in memory.
- `--security-opt no-new-privileges` and `--cap-drop ALL`: the process can't gain privileges and has
  no Linux capabilities. It still binds port 3000 as the non-root `node` user, since that port is
  above 1024.
- `--memory` with `--memory-swap` set to the same value: a runaway process is stopped by the kernel
  instead of slowing down the whole VPS. The in-memory mounts count against this limit.

The sizes can be changed with environment variables (set them in `/etc/vps-apps/expense-tracker.sh`
on the VPS; the script sources it): `WEB_MEMORY_LIMIT` (default `768m`), `WORKER_MEMORY_LIMIT`
(`256m`), `TMP_TMPFS_SIZE` (`64m`) and `NEXT_CACHE_TMPFS_SIZE` (`128m`). `LOG_DRIVER` (`journald`, or
`json-file` for a host without it; `LOG_MAX_SIZE` and `LOG_MAX_FILES` then apply) picks the log
driver. Production runs this script through the vps-apps adapter, so a change to the flags here is a
change to production, and nothing has to change in vps-apps.

If something breaks after a deploy, see [docs/incident-checklist.md](docs/incident-checklist.md).
What Supabase backs up, and how to rehearse a restore, is in [docs/backups.md](docs/backups.md).

### Prebuilt images (GHCR)

`next build` needs more memory than a small VPS has, so production doesn't build there.
The last job of `.github/workflows/ci.yml` (`image`) builds the image on GitHub's runners, after
every other CI job has passed. On a push to `main` it scans the image and then pushes it to
`ghcr.io/georgedanicico/expense-tracker`, tagged with the full commit SHA and `latest`; a red
`main` never becomes `latest`. Pull requests run the same build and scans without pushing.
Once CI succeeds on `main`, `notify-vps.yml` wakes the central deployment, which runs
`scripts/deploy.sh` with `IMAGE_SOURCE=pull`, `IMAGE_NAME=ghcr.io/georgedanicico/expense-tracker`
and `IMAGE_TAG=<commit SHA>`: the script pulls that image (retrying for up to
`PULL_ATTEMPTS` × `PULL_INTERVAL_SECONDS`, 10 minutes by default) instead of building, then
deploys the web app and the worker exactly as above. `IMAGE_SOURCE` defaults to `build`, so a
manual run without it still builds locally.

The VPS needs to be able to pull the image: make the `expense-tracker` package public in its
GitHub package settings (the image holds no secrets; they come from the environment file at
runtime), or run `docker login ghcr.io` once on the VPS with a token that has only
`read:packages`.

When building on a different architecture, use Docker Buildx with the VPS platform
(for example, `--platform linux/amd64 --load` for an x86 VPS). Refresh the base-image
digest periodically and rebuild to receive security fixes.

## UI conventions

The Chakra theme in `src/components/ui/theme/` is the single source of styling (tokens, text styles, recipes); screens compose the primitives exported from `src/components/ui/`. The full rationale is in [docs/ui-styling-refactor-plan.md](docs/ui-styling-refactor-plan.md).

- **Sizes:** controls are `xs` 28px, `sm` 32px (default) and `md` 36px. Touch screens get a 40px hit area automatically; inputs keep a 16px font on mobile.
- **Type:** pick a `textStyle` (`pageTitle`, `sectionTitle`, `body`, `bodySm`, `label`, `caption`, `amountHero`, `amount`, `amountSm`, …) instead of setting `fontSize`/`fontWeight`. One `amountHero` figure per screen.
- **Colour:** use semantic tokens (`bg.surface`, `fg.muted`, `border`, `status.warning.fg`, `category.<key>.fg`) and the palettes `brand`, `neutral`, `danger`, `success`, `warning`, `info`. No hex values in components.
- **Actions:** one primary action per view (`variant="solid" colorPalette="brand"`); everything else is `outline` (the default) or `ghost`.
- **Building blocks:** `Avatar`, `Card`, `PageHeader`, `SectionHeader`, `AppDialog`, `ConfirmDialog`, `FormField`/`FormRow`, `FormActions`, `Stat`/`StatGroup`, `Amount`, `ListRow`, `EmptyState`, `InlineAlert`, `StatusBadge`/`CategoryBadge`, `SegmentedControl`, `Toolbar`, `IconButton` and the `ICON` sizes.
- **Guardrails:** `npm run lint` rejects hex colours, unknown colour palettes, radius overrides on controls and forced 44px minimum heights outside `src/components/ui/`.

In development, `/dev/ui` shows every primitive, size, tone and token, and `/dev/preview/<screen>` (`dashboard`, `expenses`, `investments`, `net-worth`, `settings`, `todos`, `reminders`, `notifications`) renders the real screens with fixture data so they can be reviewed without signing in. Both routes return 404 in production builds.

## Verification

```bash
npm test
npm run check
npm audit --omit=dev
```

The Excel endpoint and every Server Action independently re-check authentication. The browser service worker does not cache dashboard pages, API responses, or expense data.

### Secret scans

CI scans for leaked secrets in three places, and `.env.local` and the other `.env*` files stay out of git and out of the image.

- **Source and history:** the `secrets` job runs gitleaks (8.30.1) over the full git history and the working tree. `.gitleaks.toml` extends the default rules and lists each triaged finding with the reason it isn't a secret. Locally: `gitleaks git . --config .gitleaks.toml --redact`.
- **The browser bundle:** `scripts/scan-build-secrets.sh` searches `.next/static` after `npm run build` for secret patterns and the value of any server-only variable that is set. It prints the file and pattern name, never the value. `bash scripts/scan-build-secrets.sh --self-test` checks the patterns.
- **The image:** the `image` job in `ci.yml` runs the same script over the files copied out of the image, and only pushes the image if the scan passes.

### Dependencies and the image

- **`npm audit`:** the `audit` job runs `node scripts/audit-check.mjs`, which fails on a high or critical advisory in the production dependencies. A known advisory with no fix yet goes in `audit-allowlist.json` as `{ "id": "GHSA-...", "reason": "...", "expires": "YYYY-MM-DD" }`; the date can be at most 90 days out, and the check fails again once it passes. Run it locally with `node scripts/audit-check.mjs`.
- **Trivy:** the `image` job scans the built image and fails on HIGH or CRITICAL vulnerabilities that have a fixed version. To accept one for a while, add `CVE-... exp:YYYY-MM-DD` (with a comment saying why) to a `.trivyignore` file at the repo root.
- **Dependabot:** `.github/dependabot.yml` opens weekly pull requests for npm (minor and patch together), GitHub Actions and the base image in the `Dockerfile`.
- **Pinned actions:** every action in `.github/workflows` is pinned by commit SHA, with its version in a trailing comment. Dependabot moves both.

Only `NEXT_PUBLIC_SW_IN_DEV` is a `NEXT_PUBLIC_` variable (a development switch). Never give a secret that prefix: Next.js inlines it into the browser bundle.
