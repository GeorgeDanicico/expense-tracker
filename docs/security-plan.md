# Security plan (family hub phase 14)

This plan makes the app ready for real production use: no leaked secrets, patched dependencies,
safe cookies and headers, no injection paths, no data shown to the wrong person, limits against
abuse, hardened containers, backups you can restore, and account deletion. It replaces steps
14.1–14.9 in [family-hub-roadmap.md](family-hub-roadmap.md).

## Where the app stands (audit, 26 October 2026)

| Area | Today | Gap |
| --- | --- | --- |
| Data access | RLS on every table. supabase-js and RPCs with parameters; no raw SQL. Zod on route input. | Two PostgREST filters are built from strings (`expenses.ts` builds `.or()` from expense-tab keys; `todos.ts` uses a constant). 64 `security definer` functions across 17 migrations, never checked as a set. |
| Secrets | Server-only env, `.env.example` only, the secret key behind `admin-client.ts` with an allowed-uses list. | 302 commits never scanned. No check of the client bundle or the GHCR image for secrets. Env checked lazily, not at startup. |
| Routes | 58 route files. Most use `withUser`; 18 use `withPermission` (expenses, investments, net worth, expense tabs, dashboard) or their own handling (`auth`, `auth/google`, `mcp`). | No CSRF or Origin check. No body size limit in `readJson`. Rate limits only on sign-in, joining a family, MCP tokens and avatars. |
| Cookies | `@supabase/ssr` defaults, refreshed in `src/proxy.ts`. | The browser never talks to Supabase, so the cookies could be `HttpOnly`, but they aren't set that way. |
| Headers | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. | No CSP, HSTS, COOP or CORP. |
| Supply chain | Actions on major tags (`@v4`, `@v3`, `@v6`). Base image pinned by digest. | No `npm audit`, Dependabot or image scan. Actions not pinned by SHA. |
| Containers | Non-root `node` user. Images built on GitHub and pulled (#135). | Writable root filesystem, all capabilities, no `no-new-privileges`. |
| Backups | Whatever the Supabase plan includes, never restore-tested. | No rehearsed restore and no incident checklist. |
| Privacy | `GET /api/expenses/export`. | No account deletion or full data export. |

## Tasks

Same workflow as phases 1–5: one task, one branch (`security/<id>-<slug>` from `main`), one PR,
one fresh agent per task, run one at a time. Merge when reviewed and green. Migrations wait for
George's go-ahead at a checkpoint.

| Task | What | Depends on |
| --- | --- | --- |
| S1 | Secret scan: full history, CI, client bundle and image | — |
| — | **Checkpoint:** George rotates anything S1 found | S1 |
| S2 | Supply chain: `npm audit`, Dependabot, actions pinned by SHA, Trivy | — |
| S3 | Env checked at startup for the web app and the worker | — |
| S4 | One request guard: Origin check (CSRF), body size limit, both wrappers | — |
| S5 | `HttpOnly`, `Secure`, `SameSite` auth cookies, and signing out everywhere | S4 |
| S6 | Security headers and a CSP in report-only mode | S4 |
| S7 | Injection audit and a lint rule against string-built filters | — |
| S8 | Data exposure: response shapes, error leaks, `security definer` review, Supabase advisors | — |
| — | **Checkpoint:** George applies S8's migration, if any | S8 |
| S9 | Rate limits on every route | S4 |
| S10 | Hardened containers, a backup restore drill, an incident checklist | — |
| S11 | Account deletion and a full data export | S8 |
| — | **Checkpoint:** George applies S11's migration | S11 |
| S12 | Enforce the CSP and write the final security review | S6 (a week of report-only), all the above |

### S1: Secret scan

- Run `gitleaks` (pinned release) over the **full history** and the working tree, locally.
  Triage each finding: a real secret, a test value or a false positive. Record false positives
  in `.gitleaks.toml` with a reason.
- CI: a `secrets` job that scans every push and PR (`gitleaks detect --redact`, failing on
  findings).
- `scripts/scan-build-secrets.sh`: after `next build`, search `.next/static` (everything the
  browser can download) for known patterns (`sb_secret_`, `SUPABASE_SECRET_KEY`, private keys,
  `VAPID_PRIVATE`, long base64url tokens). Run it in CI after the build, and in the image workflow
  against the image's filesystem.
- Check that no `NEXT_PUBLIC_*` variable carries anything secret, and that committed
  screenshots and fixtures show only fake data (`preview@example.com`, sample names).

**Done when** CI runs the scans green, and a short report (in the PR) lists what was checked,
found and must be rotated. **The agent never prints a secret it finds:** it reports the file,
commit and type only.

### Checkpoint: rotation

If S1 finds a real secret in history, George rotates it (Supabase keys in the dashboard, VAPID
keys only if the private key leaked, since rotating them means every device enables
notifications again). Rewriting history is not planned: rotation makes an old value useless.

### S2: Supply chain

- `npm audit --omit=dev --audit-level=high` in CI, failing on high and critical. Known findings
  that can't be fixed go in a documented allowlist that expires.
- `.github/dependabot.yml`: npm (weekly, minor and patch grouped), GitHub Actions, and Docker
  (the base image digest).
- Pin every action by commit SHA with the version in a comment, in all four workflows.
- Trivy in `image.yml`: scan the pushed image and fail on high or critical vulnerabilities that
  have a fix.

**Done when** CI fails on a deliberately vulnerable package (tried on a branch), Dependabot opens
its first PRs, and there are no open high or critical findings.

### S3: Env checked at startup

- `src/lib/env.ts`: one Zod schema for every server variable (Supabase, `SITE_URL`, VAPID,
  `FAMILY_ENABLED`, …) with the required and optional ones, used by `config.ts` and the worker.
- The web app validates at startup through `instrumentation.ts` `register()` (check the Next 16
  docs in `node_modules/next/dist/docs/`), and the worker in `src/worker/main.ts`. A missing
  required variable stops the process with a clear message naming the variable, never its value.
- A test that the client bundle can't import `env.ts` (`server-only`).

**Done when** starting without `SUPABASE_URL` fails at once with a clear message, and
`.env.example` lists every variable.

### S4: One request guard

- Both wrappers (`withUser` in `src/lib/http/route.ts` and `withPermission` in
  `src/lib/http/permission.ts`) run the same guard for `POST`, `PUT`, `PATCH` and `DELETE`:
  - `Origin` (or `Sec-Fetch-Site: same-origin`) must match `SITE_URL`'s origin, otherwise
    `403`.
  - The body is limited to 64 KB in `readJson`, with a `413` above that. Avatar uploads keep
    their own limit.
- **Exempt:** `/api/mcp` (bearer tokens, no cookies) and the OAuth endpoints that clients call
  from other origins. Each exemption is listed in one place with the reason.
- `/api/auth` and `/api/auth/google` get the same Origin check through the guard, even though
  they don't use the wrappers.

**Done when** route tests show a cross-site POST and an oversized body are refused on every
mutating route, `protected-routes.test.ts` checks the guard covers all of them, and the app's
own forms still work.

### S5: Cookies and sessions

- Set the `@supabase/ssr` cookie options in the server client and in `src/proxy.ts`:
  `httpOnly: true`, `secure` in production, `sameSite: "lax"`, `path: "/"`. Check in the
  `@supabase/ssr` source that nothing in the browser needs to read them (the browser never
  creates a Supabase client here).
- Check that sign-in, Google sign-in, MCP OAuth consent, sign-out and token refresh all still
  work.
- **Sign out everywhere** in Settings → Account (`signOut({ scope: "global" })`), with a confirm.

**Done when** the browser shows the cookie flags, every sign-in flow works in the preview, and
signing out everywhere ends a second session.

### S6: Security headers and a report-only CSP

- In `next.config.ts` headers: `Strict-Transport-Security: max-age=31536000` (only when
  `SITE_URL` is HTTPS), `Cross-Origin-Opener-Policy: same-origin`,
  `Cross-Origin-Resource-Policy: same-origin`. Keep the existing headers.
- **CSP with a nonce** set in `src/proxy.ts`, following the Next 16 CSP guide:
  `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic'; style-src 'self'
  'unsafe-inline'` (Chakra/Emotion inject styles); `img-src 'self' data: blob:`;
  `connect-src 'self'`; `frame-ancestors 'none'`; `form-action 'self'`; `base-uri 'self'`;
  `object-src 'none'`. Sent as **`Content-Security-Policy-Report-Only`**, with reports going to
  `POST /api/csp-report` (rate-limited, logged as one JSON line).
- Check the service worker, the Google sign-in redirect and the OAuth consent page under the
  policy.

**Done when** no violations appear while using every screen in the preview, and the headers
are visible on every page.

### S7: Injection audit

- `expenses.ts` `applyExpenseScope`: the `.or()` string is built from expense-tab category and
  subtype keys. Make sure only known keys reach it: validated on write (the expense-tab schema)
  and asserted again in the repository against the category catalogue. Add a test where a tab
  key contains `,`, `)` or `.`, which must be refused.
- Search for every `.or(`, `.filter(`, `.ilike(`, `.textSearch(` and `.rpc(`. Parameters are
  fine; anything built from strings is either whitelisted or escaped (`%` and `_` in `ilike`).
- An ESLint rule (`no-restricted-syntax`) against template literals and string concatenation as
  the argument of `.or()` and `.filter()`, with a reviewed disable comment where a constant is
  used.
- Review the MCP tool and OAuth inputs, and the avatar path parsing in
  `/api/avatars/[userId]/[file]`, for path traversal.

**Done when** every string-built filter has a guard and a test, and the lint rule is on.

### S8: Data exposure and the database review

- **Response shapes:** snapshot tests for the account, family, members, invites, MCP and OAuth
  routes. Each field has a reason; no other member's email or auth ids unless the screen needs
  them. Kids' generated emails (`@kids.ifam.invalid`) never reach the client.
- **Errors:** a test that unexpected database errors become the route's generic `failure`
  message (`translateDatabaseError`), never the Postgres text.
- **`security definer` review:** a SQL test (`supabase/tests/security_definer.sql`) that lists
  every `security definer` function in `public`, `app_private` and `family_private`, and asserts:
  - each one has `search_path` set;
  - `anon` can't execute any of them unless it's on a named allowlist;
  - every trigger function is revoked from `public`.
  Fix any that fail in one migration.
- **Supabase advisors:** George (or the coordinating session, with his go-ahead) runs the
  security and performance advisors on the live project and pastes the findings into the
  task. The task fixes them in the same migration.

**Done when** the snapshots and the SQL test pass, and the advisors show no security findings.

### S9: Rate limits on every route

- Extend `src/lib/http/rate-limit.ts` with a sliding-window **request** limiter, not only a
  failure counter. Per user for signed-in routes (for example 120 writes and 600 reads a minute)
  and per IP for anonymous ones (sign-in, join preview, OAuth). Return `429` with `Retry-After`.
- The client IP comes from `X-Forwarded-For` only when the request came through the trusted
  proxy (Tailscale Serve on the VPS). Otherwise use the socket address.
- Memory stays bounded (the existing `MAX_TRACKED_KEYS`).

**Done when** a burst test gets `429` on each kind of route and normal use never does.

### S10: Containers, backups and incidents

- `scripts/deploy.sh` runs both containers with `--read-only`, `--tmpfs /tmp`, a tmpfs or volume
  for `.next/cache`, `--security-opt no-new-privileges` and `--cap-drop ALL`, plus a memory
  limit. Check the app and the worker still work (image cache, avatars, push).
- **Backups:**
  - Check what the Supabase plan backs up and for how long, and record it.
  - Rehearse a restore once into a Supabase branch or a local stack.
  - If the plan has no usable backups, add a nightly `pg_dump` (a GitHub Action or the VPS) to an
    encrypted file kept for 14 days. That's a decision for George.
- `docs/incident-checklist.md`: what to do if a key leaks, the database needs a restore, a
  deploy is bad (roll back to a previous image tag), or an account is compromised.

**Done when** both containers run hardened in production, a restore has been rehearsed and
written up, and the checklist exists.

### S11: Account deletion and data export

- **Delete my account** in Settings → Account, with re-entering the password and a typed
  confirm. It removes the user's own data (expenses, tabs, investments, net worth, reminders,
  notifications, push devices, MCP tokens, avatar), signs out every session and deletes the
  auth user through the admin client.
- **Family rules, using the existing functions:** a creator must hand over the creator role or
  delete the family first. A parent leaves the family first. A kid's account is deleted by a
  parent from Manage family (13.2's reasoning).
- **Download my data:** a ZIP of JSON and CSV files with everything the user owns, streamed by
  the server.
- Any migration this needs (for example a `delete_my_data()` function) waits for the checkpoint.

**Done when** route and SQL tests cover each role, a deleted user can't sign in, and their rows
are gone. The export opens and contains every table's rows.

### S12: Enforce the CSP and the final review

- After at least a week of report-only with no unexplained violations, switch the CSP to
  `Content-Security-Policy`.
- `docs/security-review.md`: what was checked in S1–S11, what was found and fixed, what was
  accepted and why, and how to run the checks again.

**Done when** the CSP is enforced in production with no breakage, and the review is merged.

## Decisions for George

| Decision | Recommendation |
| --- | --- |
| Backups if the Supabase plan has none | A nightly `pg_dump` from a GitHub Action, encrypted with a key only George holds, kept 14 days |
| HSTS | Turn it on once the production origin (the `*.ts.net` name or a domain) is final. Browsers remember it for a year. |
| Rewriting Git history if a secret is found | No: rotate the secret instead |
| Rate limit numbers | Start generous (120 writes and 600 reads a minute per user) and tighten after phase 15's logs show real usage |

## Not in this plan

- **Logging and the log viewer** (phase 15). Until then, CSP reports and security events are
  plain JSON lines in `docker logs`.
- **A web application firewall or a public HTTPS edge.** The app stays behind Tailscale.
- **Penetration testing by a third party.**
- **Two-factor authentication.** It's worth considering after this phase; Supabase supports TOTP.
