# Security plan (family hub phase 14)

This plan makes the app ready for real production use: no leaked secrets, patched dependencies,
limits against password guessing and abuse, safe cookies, sessions and headers, no injection
paths, no data shown to the wrong person, no lost writes when two requests race, hardened
containers, backups you can restore, and account deletion. It replaces steps 14.1–14.9 in
[family-hub-roadmap.md](family-hub-roadmap.md).

**Revised 1 November 2026** with the findings that the [codebase audit](codebase-audit.md) maps
to phase 14 (P1–P6, P8, P10, B1, B2, B6, B7, B12, D3, D5, D8). Each task below names the
findings it closes. The main changes from the first draft (26 October):
- **Sign-in rate limits come first** (new S1). The first draft assumed sign-in already had a
  limiter. It doesn't: its 429s only pass on Supabase's own per-IP limit, which every user
  shares because all auth calls come from the server.
- **"Must change password" and password changes** join the sessions task (S6).
- **A new task for races** (S10): investment sells, the AI budget and expense edits.
- **Smaller fixes** go into the tasks they fit: `Content-Type` checks (S5), database messages
  (S9), the image waiting for CI (S3), and the worker's draft purge (S4).

## Where the app stands (audit, 26 October, corrected 1 November 2026)

| Area | Today | Gap |
| --- | --- | --- |
| Data access | RLS on every table. supabase-js and RPCs with parameters; no raw SQL. Zod on route input. Every `security definer` function sets `search_path = ''` with explicit grants (audit). | The one string-built filter (`expenses.ts` `.or()` from expense-tab keys) is safe only because a check constraint whitelists the keys; nothing tests that. Amounts with more than two decimals pass validation and fail in the database (B1). |
| Secrets | Server-only env, `.env.example` only, the secret key behind `admin-client.ts` with an allowed-uses list. | ~300 commits never scanned. No check of the client bundle or the GHCR image for secrets. Env checked lazily, not at startup. |
| Routes | Every route except five deliberate public ones uses `withUser` or `withPermission`. | No CSRF or Origin check, and JSON routes accept any `Content-Type` (P3). Permission checks live in four places with no single list (D5). |
| Rate limits | Limiters on joining a family, avatars, imports and MCP tokens. | **None on sign-in, sign-up, password or email changes (P1).** Response time shows which usernames exist (B7). MCP has its own unbounded limiter and trusts `X-Forwarded-For` (P8, D8). |
| Passwords and sessions | `@supabase/ssr` defaults (`sameSite: "lax"`, `httpOnly: false`), refreshed in `src/proxy.ts`. | "Must change password" is enforced only in the browser (P4). Password changes don't ask for the current password or end other sessions (P5). A failed parent reset still flags the kid (B12). |
| Errors | Routes answer generic messages for unknown errors. | `translateDatabaseError` passes Postgres' own messages, with table names, to the client (P2). Three error classes, translated three ways (D3). |
| Concurrency | Invites, imports, to-do moves and MCP tokens lock rows in SQL. | Investment sells, the AI budget check and expense edits read, check and write separately (P6, B6). |
| Headers | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`. | No CSP, HSTS, COOP or CORP. |
| Supply chain | Base image pinned by digest. | No `npm audit`, Dependabot or image scan. Actions pinned by tag, not SHA. The image is published to `:latest` without waiting for CI, and `.dockerignore` lets `.claude/`, `tmp/` and `eval-results/` into the build (P10). |
| Containers | Non-root `node` user. Images built on GitHub and pulled (#135). | Writable root filesystem, all capabilities, no `no-new-privileges`. |
| Backups | Whatever the Supabase plan includes, never restore-tested. | No rehearsed restore and no incident checklist. |
| Privacy | `GET /api/expenses/export`. | No account deletion or full data export. Without the VAPID keys the worker never purges expired import drafts, which hold bank statement rows (B2). |

## Tasks

Same workflow as phases 1–7: one task, one branch (`security/<id>-<slug>` from `main`), one PR,
one fresh agent per task, run one at a time. Merge when reviewed and green. Migrations wait for
George's go-ahead at a checkpoint.

| Task | What | Audit | Depends on |
| --- | --- | --- | --- |
| S1 | Rate limits on sign-in, sign-up, password and email changes; one shared limiter; even timing for unknown usernames | P1, B7, D8 | — |
| S2 | Secret scan: full history, CI, client bundle and image | — | — |
| — | **Checkpoint:** George rotates anything S2 found | | S2 |
| S3 | Supply chain: `npm audit`, Dependabot, actions pinned by SHA, Trivy, the image waits for CI | P10 | — |
| S4 | Env checked at startup for the web app and the worker; the worker's clean-up runs without push | B2 | — |
| S5 | One request guard: Origin check (CSRF), `Content-Type`, body size limit, both wrappers | P3 | — |
| S6 | Passwords, cookies and sessions: "must change password" on the server, re-authentication, signing out other sessions | P4, P5, B12 | S5 |
| S7 | Security headers and a CSP in report-only mode | — | S5 |
| S8 | Injection and input audit, a lint rule against string-built filters, two-decimal amounts | B1 | — |
| S9 | Data exposure: response shapes, database messages, one permission list, `security definer` review, Supabase advisors | P2, D3 (translator only), D5 | — |
| — | **Checkpoint:** George applies S9's migration, if any | | S9 |
| S10 | Races: row-locked SQL for investment orders and the AI budget, atomic expense edits | P6, B6 | — |
| — | **Checkpoint:** George applies S10's migration | | S10 |
| S11 | Rate limits on every route, a trusted client IP, MCP on the shared limiter | P8 | S1, S5 |
| S12 | Hardened containers, a backup restore drill, an incident checklist | — | — |
| S13 | Account deletion and a full data export | — | S9 |
| — | **Checkpoint:** George applies S13's migration | | S13 |
| S14 | Enforce the CSP and write the final security review | — | S7 (a week of report-only), all the above |

### S1: Sign-in and account rate limits

Closes P1, B7 and the limiter half of D8. First, because it's the audit's only high finding.

- **One limiter.** `createFailureLimiter` in `src/lib/http/rate-limit.ts` is the only one. Add a
  `recordAttempt` alias for limiters that count every attempt (avatars, imports, tokens), so the
  names say what they count. Move `src/lib/mcp/auth.ts` onto it (its own `failures` map has no
  key cap and never trims).
- **Sign-in** (`POST /api/auth`, both the email and the username form): count failures by the
  normalised sign-in name and by client IP, and check both **before** calling Supabase. Answer
  `429` with `Retry-After`. Suggested limits: 5 failures per name in 15 minutes, 20 per IP.
- **Sign-up:** per IP, counting every attempt.
- **Password and email changes** (`/api/account/password`, `/api/account/email`): per user,
  counting every attempt.
- **Even timing (B7):** for an unknown username, still run a sign-in against a fixed dummy
  address (or pad every failure to the same minimum time), so the answer for a real kid
  username takes as long as for an unknown one. Same `401` body either way.
- **Client IP:** a `clientIp(request)` helper in `src/lib/http/`. Until S11 settles which
  header the proxy sets, it uses the last `X-Forwarded-For` hop added by our own proxy (see
  "Decisions for George"), and the limiter keys on the sign-in name as well, so a spoofed IP
  alone doesn't bypass it.
- Supabase's own limits stay as a second layer; their `rate_limited` result still maps to 429.

**Done when** route tests show the sixth wrong password for one name gets `429` with
`Retry-After` (and a different name still works), unknown and real usernames take the same
path in a timing-free test (the dummy sign-in is called), and the MCP limiter is the shared one.

### S2: Secret scan

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

If S2 finds a real secret in history, George rotates it (Supabase keys in the dashboard, VAPID
keys only if the private key leaked, since rotating them means every device enables
notifications again). Rewriting history is not planned: rotation makes an old value useless.

### S3: Supply chain

Also closes P10.

- `npm audit --omit=dev --audit-level=high` in CI, failing on high and critical. Known findings
  that can't be fixed go in a documented allowlist that expires.
- `.github/dependabot.yml`: npm (weekly, minor and patch grouped), GitHub Actions, and Docker
  (the base image digest).
- Pin every action by commit SHA with the version in a comment, in all the workflows.
- Trivy in `image.yml`: scan the pushed image and fail on high or critical vulnerabilities that
  have a fix.
- **The image waits for CI:** `image.yml` runs only after CI passes on `main` (`workflow_run` on
  CI success, or one workflow with `needs:`), so a red `main` never becomes `:latest`.
- **A narrower build context:** add `.claude/` (it holds a stale full copy of the repo),
  `tmp/` and `eval-results/` to `.dockerignore`.

**Done when** CI fails on a deliberately vulnerable package (tried on a branch), Dependabot opens
its first PRs, a failing CI run on `main` publishes no image, and there are no open high or
critical findings.

### S4: Env checked at startup

Also closes B2.

- `src/lib/env.ts`: one Zod schema for every server variable (Supabase, `SITE_URL`, VAPID,
  `FAMILY_ENABLED`, the AI keys, `APP_ADMIN_USER_IDS`, …) with the required and optional ones,
  used by the existing `config.ts` files (`src/lib/supabase`, `src/lib/notifications`, `src/lib/ai`) and the worker. Drop variables nothing reads (the feature map lists
  `APP_CURRENCY` as unused; check before removing it from `.env.example`).
- The web app validates at startup through a new `src/instrumentation.ts` `register()` (check the Next 16
  docs in `node_modules/next/dist/docs/`), and the worker in `src/worker/main.ts`. A missing
  required variable stops the process with a clear message naming the variable, never its value.
- A test that the client bundle can't import `env.ts` (`server-only`).
- **The worker's clean-up doesn't need push (B2):** in `src/lib/notifications/worker.ts`, run
  `cleanUpNotifications` and `purgeImportDrafts` before the `push_not_configured` early return.
  Only delivery needs the VAPID keys.

**Done when** starting without `SUPABASE_URL` fails at once with a clear message, `.env.example`
lists every variable, and a worker test without push still purges an expired draft.

### S5: One request guard

Closes P3.

- Both wrappers (`withUser` in `src/lib/http/route.ts` and `withPermission` in
  `src/lib/http/permission.ts`) run the same guard for `POST`, `PUT`, `PATCH` and `DELETE`:
  - `Sec-Fetch-Site: cross-site` is refused, and `Origin`, when present, must match
    `SITE_URL`'s origin. Otherwise `403`.
  - A JSON body needs `Content-Type: application/json` (`415` otherwise), checked in
    `readJson` / `parseBody`. Multipart uploads (avatars, imports) keep their own checks.
  - The body is limited to 64 KB in `readJson`, with a `413` above that. Avatar and import
    uploads keep their own limits.
- **Exempt:** `/api/mcp` (bearer tokens, no cookies) and the OAuth endpoints that clients call
  from other origins. Each exemption is listed in one place with the reason.
- `/api/auth` and `/api/auth/google` get the same checks through the guard, even though they
  don't use the wrappers.

**Done when** route tests show a cross-site POST, a `text/plain` body and an oversized body are
refused on every mutating route, `protected-routes.test.ts` checks the guard covers all of them,
and the app's own forms still work.

### S6: Passwords, cookies and sessions

Closes P4, P5 and B12.

- **Cookies:** set the `@supabase/ssr` cookie options in the server client and in
  `src/proxy.ts`: `httpOnly: true`, `secure` in production, `sameSite: "lax"`, `path: "/"`.
  Check in the `@supabase/ssr` source that nothing in the browser needs to read them (the
  browser never creates a Supabase client here).
- **"Must change password" on the server (P4):** while the flag is set, `withUser` answers `403`
  with code `password_change_required` for every route except `GET /api/account`,
  `POST /api/account/password` and sign-out. MCP refuses such a user too (OAuth and personal
  tokens). The browser's redirect in `(app)/layout.tsx` stays.
- **Re-authentication (P5):** changing your own password or email asks for the current password,
  checked with a sign-in on a throwaway client that sets no cookies. (Supabase's
  reauthentication nonce is the alternative; see "Decisions for George".)
- **Other sessions end (P5):** after you change your password, every other session is signed out
  (`signOut({ scope: "others" })`). After a parent resets a kid's password, all the kid's
  sessions are signed out through the admin client.
- **Parent reset order (B12):** in `/api/family/members/[id]/password`, set the password first
  and the "must change" flag second, so a failed reset leaves the kid's account untouched.
- **Sign out everywhere** in Settings → Account (`signOut({ scope: "global" })`), with a confirm.
- Check that sign-in, Google sign-in, MCP OAuth consent, sign-out and token refresh all still
  work.

**Done when** the browser shows the cookie flags; every sign-in flow works in the preview; a
flagged account gets `403` from an expense route and from MCP; a wrong current password is
refused; and a second session ends after a password change, a parent reset and "sign out
everywhere".

### S7: Security headers and a report-only CSP

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

### S8: Injection and input audit

Also closes B1.

- `expenses.ts` `applyExpenseScope`: the `.or()` string is built from expense-tab category and
  subtype keys. The audit found the `expense_tabs` check constraint whitelists them; keep that
  guarantee visible: assert the keys again in the repository against the category catalogue,
  and add a test where a tab key contains `,`, `)` or `.`, which must be refused.
- Search for every `.or(`, `.filter(`, `.ilike(`, `.textSearch(` and `.rpc(`. Parameters are
  fine; anything built from strings is either whitelisted or escaped (`%` and `_` in `ilike`).
- An ESLint rule (`no-restricted-syntax`) against template literals and string concatenation as
  the argument of `.or()` and `.filter()`, with a reviewed disable comment where a constant is
  used.
- **Two-decimal amounts (B1):** the shared expense amount schema in
  `src/lib/validation/expense.ts` refuses more than two decimal places with a field error
  (`422`), so `0.004` no longer becomes a 500 and `0.005` is no longer silently saved as `0.01`.
  Reminder templates, import confirms and MCP share the schema, so they get the fix too.
- Review the MCP tool and OAuth inputs, and the avatar path parsing in
  `/api/avatars/[userId]/[file]`, for path traversal.

**Done when** every string-built filter has a guard and a test, the lint rule is on, and route
and MCP tests show `0.004` and `0.005` are refused with a field error.

### S9: Data exposure and the database review

Closes P2 and D5, and the translator half of D3. (One shared error class for routes, services and
MCP stays in phase 18, as a move-only refactor.)

- **Response shapes:** snapshot tests for the account, family, members, invites, MCP and OAuth
  routes. Each field has a reason; no other member's email or auth ids unless the screen needs
  them. Kids' generated emails (`@kids.ifam.invalid`) never reach the client.
- **Database messages (P2):** `translateDatabaseError` passes a message through only when our own
  SQL marked it as user-facing (for example `raise exception … using errcode = 'P0001', hint =
  'user'`, or a custom SQLSTATE class). Postgres' own messages (RLS violations, check and unique
  constraint text) become the route's generic message. Every repository uses this one
  translator instead of plain `throw new Error(...)` or hand-written `DomainError`s, so a
  unique violation is a `409` everywhere. Tests cover an RLS violation and a constraint failure.
- **One permission list (D5):** a table-driven test that lists every route and MCP tool with the
  module and role it needs, so a new route or tool fails the test until it's added. Move the two
  checks that live in services (`createKidAccount`'s parent check, and
  `completeReminderWithExpense`'s expenses check) into the wrapper, `defineTool` or SQL, and use
  one forbidden message.
- **`security definer` review:** a SQL test (`supabase/tests/security_definer.sql`) that lists
  every `security definer` function in `public`, `app_private` and `family_private`, and asserts:
  - each one has `search_path` set;
  - `anon` can't execute any of them unless it's on a named allowlist;
  - every trigger function is revoked from `public`.
  The audit found them in good shape today; the test keeps them that way. Fix any that fail in
  one migration.
- **Supabase advisors:** George (or the coordinating session, with his go-ahead) runs the
  security and performance advisors on the live project and pastes the findings into the
  task. The task fixes them in the same migration.

**Done when** the snapshots, the permission list test and the SQL test pass, no Postgres message
reaches a response, and the advisors show no security findings.

### S10: Races

Closes P6 and B6. Follows the pattern the codebase already uses for imports, invites and to-do
moves: one SQL function that locks the parent row and checks inside the transaction.

- **Investment orders (B6):** recording and deleting an order goes through one RPC that locks the
  investment account row (`for update`), re-reads the asset's orders, checks the position can't
  go below zero, and writes. `src/lib/investments/service.ts` keeps its validation and calls the
  RPC instead of reading, checking and inserting separately.
- **The AI budget:** the gate reserves the call's worst-case cost in the ledger **before** the
  call, under a lock on the family's month (and the global month), and settles it to the real
  cost after. Parallel uploads then can't all pass the same check. This can also turn the four
  sequential budget queries into one RPC (audit P9, phase 16).
- **Expense edits:** one `update … returning` with only the changed fields, instead of read,
  merge and write, so two MCP edits to different fields don't lose one.
- Every RPC is `security definer` only if it must be, with `search_path = ''` and grants as in
  S9's test.

**Done when** SQL tests run two sells of the whole position in parallel and one is refused, two
parallel AI reservations can't go over the budget, and two parallel edits to different fields of
one expense both stick.

### S11: Rate limits on every route

Closes P8.

- Extend the shared limiter from S1 with a sliding-window **request** limit, not only a failure
  counter. Per user for signed-in routes (for example 120 writes and 600 reads a minute) and per
  IP for anonymous ones (join preview, OAuth, the calendar feed). Return `429` with
  `Retry-After`.
- **A trusted client IP:** `clientIp` from S1 reads `X-Forwarded-For` only from the hop our own
  proxy adds (Tailscale Serve on the VPS), once George has confirmed what it sets. Otherwise it
  uses the socket address. MCP uses the same helper instead of the first `X-Forwarded-For`
  entry.
- **MCP:** bad OAuth app tokens count as failures by IP too (today each one costs two Supabase
  Auth calls with no limit), and failures are no longer keyed by the token prefix the caller
  chose.
- Memory stays bounded (the existing `MAX_TRACKED_KEYS`).

**Done when** a burst test gets `429` on each kind of route and normal use never does, and a
spoofed `X-Forwarded-For` doesn't reset an MCP or sign-in limit.

### S12: Containers, backups and incidents

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

### S13: Account deletion and data export

- **Delete my account** in Settings → Account, with re-entering the password and a typed
  confirm. It removes the user's own data (expenses, tabs, investments, net worth, reminders,
  notifications, push devices, MCP tokens, avatar, import drafts), signs out every session and
  deletes the auth user through the admin client.
- **Family rules, using the existing functions:** a creator must hand over the creator role or
  delete the family first. A parent leaves the family first. A kid's account is deleted by a
  parent from Manage family.
- **Download my data:** a ZIP of JSON and CSV files with everything the user owns, streamed by
  the server.
- Any migration this needs (for example a `delete_my_data()` function) waits for the checkpoint.

**Done when** route and SQL tests cover each role, a deleted user can't sign in, and their rows
are gone. The export opens and contains every table's rows.

### S14: Enforce the CSP and the final review

- After at least a week of report-only with no unexplained violations, switch the CSP to
  `Content-Security-Policy`.
- `docs/security-review.md`: what was checked in S1–S13, what was found and fixed (including each
  audit finding above), what was accepted and why, and how to run the checks again.

**Done when** the CSP is enforced in production with no breakage, and the review is merged.

## Decisions for George

| Decision | Recommendation |
| --- | --- |
| What the proxy sets as the client IP | Check on the VPS whether Tailscale Serve (or whatever sits in front of the container) adds or overwrites `X-Forwarded-For`. S1 and S11 key limits on it; the audit couldn't see the VPS. |
| Supabase Auth settings | Look up, before S1 and S6: the Auth rate limits, whether "secure password change" is on, and the JWT signing key type. Paste them into the task. |
| How a password change is confirmed | Ask for the current password (no email round trip). Supabase's reauthentication nonce, a code sent by email, is the alternative, but kids' accounts have no real inbox. |
| Sign-in limits | 5 failures per name in 15 minutes and 20 per IP, then `429`. Tighten or loosen after phase 15's logs. |
| Backups if the Supabase plan has none | A nightly `pg_dump` from a GitHub Action, encrypted with a key only George holds, kept 14 days |
| HSTS | Turn it on once the production origin (the `*.ts.net` name or a domain) is final. Browsers remember it for a year. |
| Rewriting Git history if a secret is found | No: rotate the secret instead |
| Rate limit numbers for every route | Start generous (120 writes and 600 reads a minute per user) and tighten after phase 15's logs show real usage |

## Not in this plan

- **The audit's other findings.** Those mapped to phases 15–18 stay there: logging (P7, B9),
  performance (P9, D7, B11, P12, B4), UI (D6, D9, D10, B5, B8, B10), and clean-up (D1, D2, the
  shared error class from D3, D4, P11, B3).
- **Logging and the log viewer** (phase 15). Until then, CSP reports and security events are
  plain JSON lines in `docker logs`.
- **A web application firewall or a public HTTPS edge.** The app stays behind Tailscale.
- **Penetration testing by a third party.**
- **Two-factor authentication.** It's worth considering after this phase; Supabase supports TOTP.
