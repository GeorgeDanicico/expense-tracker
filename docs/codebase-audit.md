# Codebase audit (31 October 2026)

An audit of `src/**`, `supabase/**`, `scripts/**`, the `Dockerfile` and `.github/workflows`, written before roadmap phases 14 to 18. It changes no code. Each finding has an id, a severity, a confidence, links to the code, what is wrong, a concrete scenario, and a suggested fix.

Links show the path from the repo root. They point one level up (`../`) so they also work from inside `docs/`.

## Summary

| Section | High | Medium | Low | Total |
| --- | --- | --- | --- | --- |
| Same thing, several ways (D) | 0 | 4 | 6 | 10 |
| Bad practices (P) | 1 | 5 | 6 | 12 |
| Possible bugs (B) | 0 | 3 | 9 | 12 |
| **All** | **1** | **12** | **21** | **34** |

Checks run: `npm run lint` (clean), `npm run typecheck` (clean), `npx vitest run` (4,674 of 4,675 tests pass; the one failure is a 5-second timeout, see "What I could not verify").

### Top 10 to fix first

1. **P1**: Sign-in, sign-up, password change and email change have no rate limit of our own. Every Supabase auth call comes from the server's one IP, so Supabase's per-IP limits are shared by all users.
2. **P4**: "Must change password" is enforced only in the browser. The API and MCP keep working with the temporary password.
3. **B1**: An expense amount with more than two decimals (`0.004`) passes validation, is rounded to `0.00` by the database, fails the check constraint and answers 500.
4. **P2**: `translateDatabaseError` passes Postgres' own messages (RLS and constraint text, with table names) to clients.
5. **B2**: When the VAPID keys are missing, the worker skips the purge of expired import drafts, so bank statement rows are never deleted.
6. **P6 / B6**: Check-then-write races with no database guard: investment sells can oversell, the AI budget can be overspent.
7. **P3**: CSRF protection rests only on `SameSite=Lax` cookies. JSON routes accept any `Content-Type` and never check `Origin`.
8. **P5**: Changing a password needs no current password and signs no other session out. A parent's reset of a kid's password leaves the kid's sessions alive.
9. **D1**: Expense money is a JS `number` added with floats; investments and net worth use decimal strings and `Decimal`. Pick one.
10. **D2 / D3**: Validation, field errors and error classes come in several shapes. One helper and one error type would remove most of the special cases.

### What is already consistent (no action needed)

These were checked and are in good shape, so they don't need tasks:
- Every `/api` route except the five deliberately public ones (`auth`, `auth/google`, `calendar/feed/[token]`, `mcp`, `health`) uses `withUser` or `withPermission` from [src/lib/http/route.ts](../src/lib/http/route.ts) and [src/lib/http/permission.ts](../src/lib/http/permission.ts). Every family route calls `requireFamilyFeature()`.
- Supabase is only reached through repositories, enforced by the `supabaseBoundary` lint rule in [eslint.config.mjs](../eslint.config.mjs). There are no direct Supabase calls in routes or components.
- Every `security definer` function in `supabase/migrations` sets `search_path = ''`, and grants are revoked and re-granted explicitly. RPCs that race (invites, imports, to-do positions, MCP tokens) lock rows with `for update`.
- The one string-built PostgREST filter, the tab membership `.or()` in [src/lib/supabase/repositories/expenses.ts:57](../src/lib/supabase/repositories/expenses.ts#L57), only ever sees keys that the `expense_tabs` check constraint whitelists.
- Dialogs use `AppDialog` / `ConfirmDialog` from `src/components/ui`, and forms use `useApiForm` from [src/hooks/use-api-form.ts](../src/hooks/use-api-form.ts) (39 files). There is one global `SWRConfig` in [src/components/ui/provider.tsx](../src/components/ui/provider.tsx). (The roadmap's phase 16 "starting point" says there is none; that is out of date.)
- Avatar decoding caps pixels (`limitInputPixels`) and upload bodies are read with a byte limit ([src/lib/http/body.ts](../src/lib/http/body.ts)).

---

## Same thing, several ways

### D1. Money is a float in expenses and a decimal everywhere else
- **Severity:** medium. **Confidence:** high.
- **Where:** [src/lib/supabase/repositories/expenses.ts:27](../src/lib/supabase/repositories/expenses.ts#L27) (`Number(row.amount)`), [src/lib/expenses/summary.ts:4](../src/lib/expenses/summary.ts#L4), [src/lib/api/invalidate.ts:38](../src/lib/api/invalidate.ts#L38) and [:47](../src/lib/api/invalidate.ts#L47), [src/lib/export/xlsx.ts:39](../src/lib/export/xlsx.ts#L39), [src/lib/supabase/repositories/imports.ts:96](../src/lib/supabase/repositories/imports.ts#L96). Compare [src/lib/expenses/analytics.ts:1](../src/lib/expenses/analytics.ts#L1), [src/lib/validation/primitives.ts:17](../src/lib/validation/primitives.ts#L17), [src/lib/investments/aggregate.ts](../src/lib/investments/aggregate.ts), [src/lib/net-worth/calculation.ts](../src/lib/net-worth/calculation.ts).
- **What's wrong:** Investments and net worth keep amounts as decimal strings and add them with `decimal.js`. Expenses turn `numeric(12,2)` into a JS number and add with `+`. Even inside expenses, the analytics totals use `Decimal` while the ledger total, the average, the optimistic cache updates and the spreadsheet total use floats.
- **Scenario:** A month with expenses 0.10, 0.20 and 0.70 gives a ledger total of `0.9999999999999999`. The display rounds it, so it looks right, but the number in the JSON is wrong, and the ledger total and the analytics total for the same month can differ in the last digit.
- **Fix:** Standardise on the investments pattern: amounts cross the wire as decimal strings, sums use `Decimal`, and only formatting turns them into numbers. Do it in phase 18 as a move-only refactor, starting with `summarizeExpenses` and `withExpenseAdded` / `withExpenseRemoved`.

### D2. Input validation and field errors come in four shapes
- **Severity:** medium. **Confidence:** high.
- **Where:**
  - Route helper: `parseBody` / `parseInput` with the deprecated `error.flatten()` at [src/lib/http/route.ts:59](../src/lib/http/route.ts#L59) (also [src/app/api/auth/route.ts:43](../src/app/api/auth/route.ts#L43), [src/lib/family/service.ts:22](../src/lib/family/service.ts#L22), [src/lib/family-calendar/form.ts:195](../src/lib/family-calendar/form.ts#L195)).
  - Hand checks in routes: the currency in [src/app/api/account/route.ts:47](../src/app/api/account/route.ts#L47), and `selectedMonth` in [src/app/api/expenses/route.ts:44](../src/app/api/expenses/route.ts#L44), which is read outside the schema.
  - Raw bodies passed to services that validate themselves: [src/app/api/family/kids/route.ts:11](../src/app/api/family/kids/route.ts#L11) → [src/lib/family/service.ts:41](../src/lib/family/service.ts#L41), and [src/lib/imports/service.ts:191](../src/lib/imports/service.ts#L191), which builds dotted keys (`rows.0.description`).
  - MCP uses `z.flattenError` in [src/lib/mcp/define-tool.ts:42](../src/lib/mcp/define-tool.ts#L42).
- **What's wrong:** The same zod failure gives different `fieldErrors` keys depending on the route. `flatten()` keeps only top-level keys, so nested errors are lost, except in imports, which joins paths. `withUser` doesn't map a `ZodError` at all, so a `schema.parse()` inside a service (for example `expenseSchema.parse` in [src/lib/reminders/service.ts:201](../src/lib/reminders/service.ts#L201)) becomes a 500. In MCP the same error becomes a field error.
- **Scenario:** `POST /api/account` with `{ "currency": "eur " }` gets a 422 with no `fieldErrors`. `PATCH /api/family/members/x/permissions` with a bad level gets `fieldErrors.permissions`. A bad row in an import confirm gets `fieldErrors["rows.3.amount"]`. The client has to know all three.
- **Fix:** Keep `parseBody` in the route as the one entry point. Give it one `fieldErrorsOf(error)` helper built on `z.flattenError` (or `z.treeifyError` for nested bodies) that always uses dotted paths. Make `withUser` map `ZodError` to 422 the way `defineTool` does. Move the `selectedMonth` and currency checks into schemas.

### D3. Three error classes, and repositories translate database errors in three ways
- **Severity:** medium. **Confidence:** high.
- **Where:** `HttpError` ([src/lib/http/route.ts:34](../src/lib/http/route.ts#L34)), `DomainError` ([src/lib/errors.ts:2](../src/lib/errors.ts#L2)), `ImportError` ([src/lib/imports/types.ts](../src/lib/imports/types.ts)). In repositories: `translateDatabaseError` (family, reminders, todos, calendar, notification settings), plain `throw new Error(...)` (expenses, expense tabs, investments, avatars), and hand-written `DomainError`s on specific codes (net worth, imports, MCP tokens).
- **What's wrong:** `HttpError` allows 400/404/413/415/422/429 and `DomainError` allows 403/404/409/422, so the same "not found" is thrown both ways (`notFound()` in routes, local `notFound()` helpers returning `DomainError` in [src/lib/reminders/service.ts:57](../src/lib/reminders/service.ts#L57) and [src/lib/family-calendar/service.ts:40](../src/lib/family-calendar/service.ts#L40)). A unique violation is a 409 in family code, a `PositionTakenError` in to-dos and a 500 in expenses. MCP's `toolError` doesn't know `HttpError` or `ImportError`, so those are logged as crashes.
- **Scenario:** An MCP tool that reaches `resolveViewedUser` with a bad member id would log `MCP tool … failed` and answer "The request could not be completed" instead of "Member not found."
- **Fix:** One `AppError` with `status`, `code` and optional `fieldErrors`, used by routes, services and MCP alike. Every repository calls one translator, which also fixes P2. Phase 18, move-only.

### D4. DELETE routes answer in four ways
- **Severity:** low. **Confidence:** high.
- **Where:** 204 in [src/app/api/imports/[id]/route.ts](../src/app/api/imports/[id]/route.ts), [src/app/api/investment-transactions/[id]/route.ts](../src/app/api/investment-transactions/[id]/route.ts) and the family routes; `{ success: true }` in [src/app/api/expenses/[id]/route.ts:8](../src/app/api/expenses/[id]/route.ts#L8), [src/app/api/todos/[id]/route.ts](../src/app/api/todos/[id]/route.ts), [src/app/api/reminders/[id]/route.ts:16](../src/app/api/reminders/[id]/route.ts#L16), [src/app/api/expense-tabs/[id]/route.ts](../src/app/api/expense-tabs/[id]/route.ts); `{ deletedIds }` for calendar events; the settings object for `DELETE /api/notifications/push-subscriptions`. Most answer 404 for a missing row; expenses don't (B3).
- **Fix:** 204 and 404 everywhere, except where the client needs data back (calendar series). Phase 18.

### D5. Permission checks live in four places
- **Severity:** medium. **Confidence:** high.
- **Where:**
  1. Route wrapper `withPermission(module, level)` ([src/lib/http/permission.ts:23](../src/lib/http/permission.ts#L23)) for finance and import routes.
  2. MCP's `module` field in `defineTool` ([src/lib/mcp/define-tool.ts:71](../src/lib/mcp/define-tool.ts#L71)), which always checks `edit`.
  3. Services: `createKidAccount` checks `role === "parent"` itself ([src/lib/family/service.ts:39](../src/lib/family/service.ts#L39)); `completeReminderWithExpense` calls `can(..., "expenses", "edit")` itself ([src/lib/reminders/service.ts:186](../src/lib/reminders/service.ts#L186)).
  4. SQL: family writes (`set_member_permissions`, `require_password_change`, invites) refuse non-parents inside the RPC, so their routes use plain `withUser`.
- **What's wrong:** Each place is correct today, but there is no single list of "which operation needs which module and role". A new route or tool can easily pick the wrong one, and the forbidden message differs ("You don't have access to this." vs "Only parents can add a kid.").
- **Fix:** Keep module checks in `withPermission` and `defineTool`, keep role checks in SQL, and move the two service checks into those layers. Add a table-driven test that lists every route and tool with its module, so a new one fails until it's added. Phase 14.

### D6. Two client data-layer styles
- **Severity:** low. **Confidence:** high.
- **Where:** Newer modules have an injectable API object plus a hook with optimistic updates: [src/components/todos/todo-api.tsx](../src/components/todos/todo-api.tsx) + [use-todo-board.ts](../src/components/todos/use-todo-board.ts), reminders, calendar, imports. Older modules call `apiRequest` inline in each dialog and refresh through [src/lib/api/invalidate.ts](../src/lib/api/invalidate.ts): expenses, investments, net worth, family, settings. Smaller variations: [src/components/family-calendar/subscribe-dialog.tsx:202](../src/components/family-calendar/subscribe-dialog.tsx#L202) loads in a raw `useEffect` instead of SWR; five `useSWR` calls pass `apiFetcher` although it is the global fetcher ([src/components/net-worth/net-worth-panel.tsx:54](../src/components/net-worth/net-worth-panel.tsx#L54), [:110](../src/components/net-worth/net-worth-panel.tsx#L110), [src/components/investments/investments-panel.tsx:47](../src/components/investments/investments-panel.tsx#L47), [:143](../src/components/investments/investments-panel.tsx#L143), [src/components/investments/asset-detail.tsx:75](../src/components/investments/asset-detail.tsx#L75)); the OAuth consent screen keeps its own pending state instead of `useApiForm` ([src/components/oauth/consent-screen.tsx:105](../src/components/oauth/consent-screen.tsx#L105)).
- **Fix:** Standardise on the API-object-plus-hook style. It is the one `/dev/preview` can drive with fixtures, and it keeps cache updates next to the writes. Convert expenses first in phase 17, when those screens are rebuilt anyway.

### D7. Four ways to deal with "how many rows"
- **Severity:** low. **Confidence:** high.
- **Where:**
  - A paging loop that fails on short reads: `fetchAllPages` in [src/lib/supabase/repositories/expenses.ts:72](../src/lib/supabase/repositories/expenses.ts#L72).
  - A second, separate paging loop: `expenseCounts` in [src/lib/supabase/repositories/imports.ts:174](../src/lib/supabase/repositories/imports.ts#L174).
  - A hard `.limit()` that truncates without telling anyone: 500 net-worth items ([src/lib/supabase/repositories/net-worth.ts:83](../src/lib/supabase/repositories/net-worth.ts#L83)), 5,000 transactions per account ([src/lib/supabase/repositories/investments.ts:115](../src/lib/supabase/repositories/investments.ts#L115), [:162](../src/lib/supabase/repositories/investments.ts#L162)).
  - No limit at all, which relies on PostgREST's `max-rows` (1,000 by default on Supabase): calendar ([src/lib/supabase/repositories/calendar.ts:135](../src/lib/supabase/repositories/calendar.ts#L135)), open to-dos ([src/lib/supabase/repositories/todos.ts:105](../src/lib/supabase/repositories/todos.ts#L105)), reminders ([src/lib/supabase/repositories/reminders.ts:118](../src/lib/supabase/repositories/reminders.ts#L118)).
- **Fix:** Move `fetchAllPages` to `src/lib/supabase/` and use it for every list that must be complete. Where a cap is wanted, read `cap + 1` rows and throw (or return `truncated: true`) instead of truncating silently. See B11.

### D8. Two rate limiters
- **Severity:** low. **Confidence:** high.
- **Where:** `createFailureLimiter` in [src/lib/http/rate-limit.ts:26](../src/lib/http/rate-limit.ts#L26) (bounded to 10,000 keys, per-key lists trimmed) and a separate one in [src/lib/mcp/auth.ts:31](../src/lib/mcp/auth.ts#L31) (`failures` map with no key cap; `recordFailure` at [:63](../src/lib/mcp/auth.ts#L63) appends without trimming). Avatar, import and token limiters call `recordFailure` to count every attempt, which reads as if they counted failures.
- **Fix:** Use `createFailureLimiter` in MCP auth too, and add a `recordAttempt` alias. Phase 14.7 will extend limits anyway; do it on one limiter.

### D9. Dates are shown in three time zones
- **Severity:** low. **Confidence:** high.
- **Where:** Bucharest for "today", months and last-active labels ([src/lib/calendar.ts:99](../src/lib/calendar.ts#L99), [src/lib/family/last-active-label.ts](../src/lib/family/last-active-label.ts)); the row's own `timezone` for events and reminders ([src/lib/time-zone.ts](../src/lib/time-zone.ts)); the browser's zone for `formatDateTime` ([src/lib/calendar.ts:180](../src/lib/calendar.ts#L180)), used for invite expiry, token last use and investment order times. Locales mix `en-US` and `en-GB`. One form does local `Date` maths ([src/components/expenses/expense-form.tsx:36](../src/components/expenses/expense-form.tsx#L36), see B5).
- **What's wrong:** Both helper modules are sound. The problem is that callers pick a zone implicitly. A family member abroad sees order times in their zone but "due today" in Bucharest.
- **Fix:** Make `formatDateTime` take the zone (default `APPLICATION_TIMEZONE`), pick one locale, and ban `toISOString().slice(0, 10)` on local dates with a lint rule. Phase 17.

### D10. REST and MCP apply different rules to the same expense write
- **Severity:** low. **Confidence:** high.
- **Where:** `POST /api/expenses` requires a `selectedMonth` and a date inside it ([src/app/api/expenses/route.ts:48](../src/app/api/expenses/route.ts#L48)). MCP `add_expense` accepts any date and defaults to today ([src/lib/mcp/tools/expenses.ts:31](../src/lib/mcp/tools/expenses.ts#L31)). Editing an expense exists only in MCP (`update_expense`, [src/lib/mcp/tools/expenses.ts:82](../src/lib/mcp/tools/expenses.ts#L82)); there is no `PATCH /api/expenses/[id]`.
- **What's wrong:** Business rules live in the route instead of the shared service, so the two transports drift.
- **Fix:** Put `createExpense` / `updateExpense` use cases in [src/lib/expenses/service.ts](../src/lib/expenses/service.ts) and call them from both. Decide whether the month rule is a UI concern (then drop it from the API) or a real rule (then MCP needs it too).

---

## Bad practices

### P1. No rate limit on sign-in, sign-up, password or email changes
- **Severity:** high. **Confidence:** high for the missing limiter; medium for the shared-IP effect (it depends on Supabase settings I couldn't see).
- **Where:** [src/app/api/auth/route.ts:62](../src/app/api/auth/route.ts#L62), [src/app/api/account/password/route.ts:11](../src/app/api/account/password/route.ts#L11), [src/app/api/account/email/route.ts:12](../src/app/api/account/email/route.ts#L12). The only limiters are for invite codes, avatars, imports and MCP tokens ([src/lib/http/rate-limit.ts](../src/lib/http/rate-limit.ts)).
- **What's wrong:** The roadmap's phase 14 starting point says sign-in is rate-limited in memory. It isn't. Sign-in relies on Supabase alone. The server calls Supabase Auth itself, without forwarding the client's IP, so every user's sign-in shares one IP bucket.
- **Scenario:** Someone on the tailnet scripts `POST /api/auth` with a kid's username and guesses 8-character passwords. Nothing in the app stops them. When Supabase's per-IP limit kicks in, it blocks sign-in for the whole family at once, not just the attacker.
- **Fix:** A `createFailureLimiter` keyed by the sign-in name and by client IP (from a trusted proxy header), checked before Supabase is called, with 429 and `Retry-After`. Same for password and email changes per user. Phase 14.7, first item.

### P2. Database messages reach the client
- **Severity:** medium. **Confidence:** high for the mechanism; low that it triggers often.
- **Where:** [src/lib/supabase/errors.ts:18](../src/lib/supabase/errors.ts#L18), used for direct table writes in [src/lib/supabase/repositories/reminders.ts:151](../src/lib/supabase/repositories/reminders.ts#L151), [src/lib/supabase/repositories/notification-settings.ts:61](../src/lib/supabase/repositories/notification-settings.ts#L61), calendar and others.
- **What's wrong:** Any error with code 42501, 23514, 23505 or P0002 becomes a `DomainError` that keeps the database's message. That is right for messages our own SQL raises. It is wrong for messages Postgres raises itself, such as `new row violates row-level security policy for table "reminders"` or `new row for relation "x" violates check constraint "y"`. Phase 14.6 says errors must never include database messages. The to-dos repository already works around this for 23514 ([src/lib/supabase/repositories/todos.ts:68](../src/lib/supabase/repositories/todos.ts#L68)).
- **Fix:** Pass a message through only when our SQL marked it as user-facing, for example with a custom SQLSTATE class (`P0001` with a `HINT`, or codes like `UA001`). Everything else gets the fallback.

### P3. CSRF protection rests on SameSite alone
- **Severity:** medium. **Confidence:** high.
- **Where:** [src/lib/http/route.ts:64](../src/lib/http/route.ts#L64) (`readJson` parses any body); cookie defaults in `@supabase/ssr` are `sameSite: "lax"`, `httpOnly: false`.
- **What's wrong:** JSON routes don't require `Content-Type: application/json` and don't check `Origin`. Today `SameSite=Lax` stops a cross-site POST from carrying the session. That breaks for any same-site origin (another app served under the same registrable domain) or if a cookie option changes. The imports route documents this reasoning for its own body ([src/app/api/imports/route.ts:23](../src/app/api/imports/route.ts#L23)); JSON routes don't have it.
- **Scenario:** A page on a same-site origin sends `fetch("/api/family/members/<id>/permissions", { method: "PATCH", mode: "no-cors", credentials: "include", body: '{"permissions":…}' })` with `text/plain`. Lax cookies are sent same-site, the body parses, and the change applies.
- **Fix:** In `withUser`, refuse mutating methods whose `Sec-Fetch-Site` is `cross-site` or whose `Origin` isn't the app's; in `parseBody`, require `application/json`. Phase 14.4 already plans the `Origin` check; add the content-type rule there too.

### P4. "Must change password" is only enforced in the browser
- **Severity:** medium. **Confidence:** high.
- **Where:** [src/app/(app)/layout.tsx:22](../src/app/(app)/layout.tsx#L22) is the only check. `withUser` doesn't look at the flag.
- **Scenario:** A parent resets a kid's password to a temporary one ([src/app/api/family/members/[id]/password/route.ts](../src/app/api/family/members/[id]/password/route.ts)). Anyone who knows it (the parent included) can sign in and call every API, or create MCP access, without ever choosing a new password. The flag exists so that only the kid knows the final password.
- **Fix:** In `withUser`, answer 403 with a `password_change_required` code for every route except `GET /api/account`, `POST /api/account/password` and sign-out, while the flag is set. MCP sessions for such a user should be refused too.

### P5. Password changes don't re-authenticate or end other sessions
- **Severity:** medium. **Confidence:** high for our code; I couldn't check the Supabase "secure password change" setting.
- **Where:** [src/app/api/account/password/route.ts:11](../src/app/api/account/password/route.ts#L11), [src/lib/supabase/auth.ts](../src/lib/supabase/auth.ts) `updatePassword`; the parent reset in [src/app/api/family/members/[id]/password/route.ts:16](../src/app/api/family/members/[id]/password/route.ts#L16).
- **What's wrong:** The current password isn't asked for, so an unlocked phone or a stolen cookie is enough to take the account over. After a change, other sessions stay signed in. The parent's reset sets a new password but doesn't sign the kid out anywhere.
- **Fix:** Ask for the current password (verify with a sign-in on a throwaway session client) or use Supabase's reauthentication nonce. After a change or reset, sign out other sessions (`signOut({ scope: "others" })` for the user, an admin sign-out for the kid). Phase 14.4.

### P6. Check-then-write races without a database guard
- **Severity:** medium. **Confidence:** medium (each needs two requests at nearly the same time).
- **Where:**
  - Investments: [src/lib/investments/service.ts:105](../src/lib/investments/service.ts#L105) reads the asset's history, checks for oversell in JS, then inserts at [:129](../src/lib/investments/service.ts#L129). Delete does the same at [:143](../src/lib/investments/service.ts#L143). See B6.
  - Expense update: read, merge, write as two statements in [src/lib/supabase/repositories/expenses.ts:198](../src/lib/supabase/repositories/expenses.ts#L198). Two MCP edits to different fields can lose one.
  - AI budget: `checkBudget` reads the month's spend ([src/lib/ai/gate.ts:120](../src/lib/ai/gate.ts#L120)); usage is recorded only after the call, so parallel uploads all pass the same check.
- **Fix:** Follow the pattern the codebase already uses for imports, invites and to-do moves: one SQL function that locks the parent row (`for update` on the investment account, or the family's AI month) and checks inside the transaction. For expenses, a single `update … returning` with the merged fields.

### P7. Background work as a floating promise
- **Severity:** low. **Confidence:** high.
- **Where:** [src/lib/family/last-active.ts:45](../src/lib/family/last-active.ts#L45), started from `withUser` before the handler runs.
- **What's wrong:** The touch runs alongside the request and may still be reading cookies when the response is finished. Next 16 has `after()` for this, and its docs (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`) say `cookies()` and `headers()` work inside `after` in route handlers. Failures are swallowed with no log line.
- **Fix:** Wrap the touch in `after(() => …)` and log failures at debug level once phase 15's logger exists.

### P8. MCP throttling can be sidestepped, and app tokens aren't throttled
- **Severity:** low. **Confidence:** medium.
- **Where:** [src/app/api/mcp/route.ts:32](../src/app/api/mcp/route.ts#L32) takes the client IP from the first `X-Forwarded-For` entry; [src/lib/mcp/auth.ts:116](../src/lib/mcp/auth.ts#L116) keys failures by that IP and by the token's display prefix, both chosen by the caller; [src/lib/mcp/auth.ts:161](../src/lib/mcp/auth.ts#L161) records no failure for bad OAuth app tokens.
- **What's wrong:** Unless the reverse proxy overwrites `X-Forwarded-For`, a guesser picks a new IP and prefix per request and is never throttled. Personal tokens are 256 random bits, so guessing them is hopeless; the real cost is that every bad app token makes two calls to Supabase Auth (`getClaims` and `getUser`) with no limit.
- **Fix:** Read the IP from a header only the proxy sets (or the socket), throttle app-token failures by IP, and use the shared limiter (D8).

### P9. Unbounded reads and repeated reads per request
- **Severity:** low. **Confidence:** high.
- **Where:**
  - Tab ledger search loads every matching expense, then filters in JS ([src/lib/supabase/repositories/expenses.ts:102](../src/lib/supabase/repositories/expenses.ts#L102)).
  - `get_family()` is called by `resolveViewedUser`, and again inside each to-do and calendar repository method (for example [src/lib/supabase/repositories/todos.ts:104](../src/lib/supabase/repositories/todos.ts#L104)), because `getCurrentMember`'s React `cache` doesn't dedupe inside route handlers ([src/lib/family/viewed-user.ts:46](../src/lib/family/viewed-user.ts#L46)).
  - The proxy calls `getClaims()` on every request, `/api` included ([src/lib/supabase/proxy.ts:40](../src/lib/supabase/proxy.ts#L40)), and `withUser` calls it again. With a symmetric JWT secret that is two Auth round trips per request.
  - `checkBudget` makes four sequential queries ([src/lib/ai/gate.ts:129](../src/lib/ai/gate.ts#L129)).
- **Fix:** Phase 16.5: an `ilike` filter on the server for search, a request-scoped cache (AsyncLocalStorage, like the Supabase client) for the family, a narrower proxy matcher or a check that the JWT is asymmetric, and one RPC for the budget check.

### P10. The image is published without waiting for CI, and the build context is too wide
- **Severity:** low. **Confidence:** high.
- **Where:** [.github/workflows/image.yml](../.github/workflows/image.yml) runs on every push to `main` and pushes `:latest`, independent of [.github/workflows/ci.yml](../.github/workflows/ci.yml). Actions are pinned by tag, not SHA. [.dockerignore](../.dockerignore) doesn't exclude `.claude/` (which holds a stale full copy of the repo in `worktrees`), `tmp/` or `eval-results/`, and the Dockerfile's builder stage runs `COPY . .`.
- **Scenario:** A merge whose tests fail on `main` (for example after a bad rebase) still becomes `:latest` and is pulled by the VPS.
- **Fix:** Make the image job depend on CI (`workflow_run` on CI success, or one workflow with `needs:`). Pin actions by SHA (already in 14.2). Add the three folders to `.dockerignore`.

### P11. Dead code and leftovers
- **Severity:** low. **Confidence:** high.
- **Where:**
  - Legacy schema: `public.categories`, `expenses.category_id` and `reset_daily_tokens()` from the old starter ([supabase/tests/support/legacy-bootstrap.sql](../supabase/tests/support/legacy-bootstrap.sql), still in [src/lib/database.types.ts:535](../src/lib/database.types.ts#L535)). Nothing in `src` uses them.
  - The `23505` branch in `saveValuation` ([src/lib/supabase/repositories/net-worth.ts:161](../src/lib/supabase/repositories/net-worth.ts#L161)) can't run: the write is an upsert on that same unique key, so a duplicate date overwrites instead.
  - The empty folder `src/app/ui-preview`.
  - `getCurrentMember`'s `cache()` ([src/lib/family/current-member.ts:13](../src/lib/family/current-member.ts#L13)) does nothing in route handlers, as its caller's comment says.
  - zod's deprecated `error.flatten()` in six places (D2).
- **Fix:** Phase 18.1 (`knip`) plus one migration that drops the legacy objects after a backup.

### P12. The app shell decides everything in the browser
- **Severity:** low. **Confidence:** high.
- **Where:** [src/app/(app)/layout.tsx](../src/app/(app)/layout.tsx) is a client component; the only error boundary is [src/app/(app)/error.tsx](../src/app/(app)/error.tsx); there is no `loading.tsx` and no `global-error.tsx`.
- **What's wrong:** A signed-out visitor downloads the app's JavaScript and sees a spinner until `/api/account` answers 401. Errors thrown outside `(app)` (login, join, consent) have no boundary. This isn't a security hole (every API checks the session); it's phase 16's "no endless loading" work.
- **Fix:** A server-side redirect for missing sessions in a server layout, plus `loading.tsx` / `error.tsx` per section, as 16.2 and 16.3 plan.

---

## Possible bugs

### B1. Amounts with more than two decimals give a 500 or are silently rounded
- **Severity:** medium. **Confidence:** high.
- **Where:** [src/lib/validation/expense.ts:15](../src/lib/validation/expense.ts#L15) (`z.coerce.number().positive()`), the column `numeric(12, 2)` and the check `amount > 0` ([supabase/migrations/20260823151309_create_expenses_schema.sql:88](../supabase/migrations/20260823151309_create_expenses_schema.sql#L88)), the plain `Error` in [src/lib/supabase/repositories/expenses.ts:194](../src/lib/supabase/repositories/expenses.ts#L194).
- **Scenario:** MCP `add_expense` with `amount: 0.004` (or `POST /api/expenses` from any client without the browser's `step` check). Zod accepts it. Postgres rounds it to `0.00`, the check constraint fails with 23514, the repository throws a plain `Error`, and the caller gets a 500 "The expense could not be saved." With `0.005`, the expense is saved as `0.01` and the caller isn't told. The same schema backs reminder templates and import confirms.
- **Fix:** Refine the amount to at most two decimal places (or use `decimalString` with a 2-place option) so it's a 422 with a field error.

### B2. Without VAPID keys, the worker never purges expired import drafts
- **Severity:** medium. **Confidence:** high.
- **Where:** [src/lib/notifications/worker.ts:500](../src/lib/notifications/worker.ts#L500) returns before `cleanUpNotifications` and `purgeImportDrafts` ([:510](../src/lib/notifications/worker.ts#L510)).
- **Scenario:** The VPS env loses `VAPID_PRIVATE_KEY` (or a new environment never had it). The worker logs `push_not_configured` every tick and returns. Expired drafts, which hold parsed bank statement rows, stay in `import_rows` forever. The app hides them (`isExpiredDraft`), so nobody notices.
- **Fix:** Run the clean-up and purge steps before the push check; only delivery needs push.

### B3. Deleting an expense that doesn't exist answers 200
- **Severity:** low. **Confidence:** high.
- **Where:** [src/app/api/expenses/[id]/route.ts:7](../src/app/api/expenses/[id]/route.ts#L7) ignores the `false` from `expenses.delete`.
- **Scenario:** `DELETE /api/expenses/<another user's id or a deleted id>` answers `{ success: true }`. MCP `delete_expense` for the same id answers "Expense not found." Every other delete route answers 404.
- **Fix:** `if (!(await …delete(user.id, id))) notFound("Expense not found.")`.

### B4. Deleting an expense corrupts the cached family view
- **Severity:** low. **Confidence:** high.
- **Where:** [src/lib/api/invalidate.ts:89](../src/lib/api/invalidate.ts#L89) applies `withExpenseRemoved` ([:43](../src/lib/api/invalidate.ts#L43)) to every key starting with `/api/expenses?`, which includes the family view `…&member=all` ([src/components/expenses/family-expenses-panel.tsx:21](../src/components/expenses/family-expenses-panel.tsx#L21)).
- **Scenario:** A parent opens Expenses → Everyone, then switches to their own ledger and deletes an expense. The family cache loses the row, but its `totals` (per currency) stay the same, and stray `total` and `average` fields are added. Going back to Everyone shows a list and a total that disagree until the refetch finishes. Adding an expense doesn't touch the family view at all, so the two paths differ.
- **Fix:** Skip keys with `member=` in the updater and revalidate them instead.

### B5. The expense date picker's maximum is a day early east of UTC+12
- **Severity:** low. **Confidence:** medium.
- **Where:** [src/components/expenses/expense-form.tsx:36](../src/components/expenses/expense-form.tsx#L36).
- **Scenario:** In Pacific/Auckland during daylight time (UTC+13), the selected month is October. `new Date("2026-11-01T12:00:00")` is local noon, minus one day is 31 October 12:00 local, and `toISOString()` turns that into `2026-10-30T23:00Z`. The picker's `max` becomes 30 October, so 31 October can't be chosen. Bucharest is not affected.
- **Fix:** `lastDayOfMonth(selectedMonth)` from [src/lib/calendar.ts:67](../src/lib/calendar.ts#L67).

### B6. Two sells at the same time can oversell a position
- **Severity:** medium. **Confidence:** medium.
- **Where:** [src/lib/investments/service.ts:100](../src/lib/investments/service.ts#L100) (see P6).
- **Scenario:** You hold 10 shares. You record "sell 10" on the phone and, a moment later, an MCP client records "sell 10" too. Both read the same 10-share history, both pass `calculateInvestmentPosition`, both insert. The asset now has −10 shares, its history no longer calculates, and it shows as an issue on Investments and Net worth until one sell is removed.
- **Fix:** As P6: one SQL function that locks the account row, re-reads the asset's orders and inserts, or a deferred constraint trigger that recalculates the position.

### B7. Response time reveals which usernames exist
- **Severity:** low. **Confidence:** medium.
- **Where:** [src/app/api/auth/route.ts:71](../src/app/api/auth/route.ts#L71).
- **Scenario:** For an unknown username, `emailForUsername` returns `null` after one query and the route answers 401 at once. For a real one, it also calls `getUserById` and `signInWithPassword`. The 401 body is the same, but the second answer is a few hundred milliseconds slower, so a script can list kid usernames, which the comment says must not be possible.
- **Fix:** For an unknown username, still call `signInWithPassword` with a fixed dummy address, or pad every failure to a fixed minimum time. Combine with P1.

### B8. Control characters in a description break the spreadsheet export
- **Severity:** low. **Confidence:** medium (possible).
- **Where:** [src/lib/export/xlsx.ts:8](../src/lib/export/xlsx.ts#L8) escapes `& < > " '` only; [src/lib/validation/expense.ts:14](../src/lib/validation/expense.ts#L14) allows any characters.
- **Scenario:** An imported statement line or an MCP call stores a description with `\u0002` (some bank exports contain these). XML 1.0 forbids that character, so Excel reports the downloaded `.xlsx` as damaged.
- **Fix:** Strip `[\u0000-\u0008\u000B\u000C\u000E-\u001F]` in `escapeXml`, or reject control characters in the description schema.

### B9. The worker can send a notification twice, and one failing claim skips a tick's deliveries
- **Severity:** low. **Confidence:** medium (possible).
- **Where:** [src/lib/notifications/worker.ts:268](../src/lib/notifications/worker.ts#L268) to [:286](../src/lib/notifications/worker.ts#L286); [:328](../src/lib/notifications/worker.ts#L328).
- **Scenario 1:** Push succeeds for a device, then `markDevicesDelivered` or `finishNotification` fails (a brief database error). `deliver` throws, the row's lease runs out, and two minutes later the same notification is pushed again.
- **Scenario 2:** `claimDueReminders` fails. Unlike `claimDueCalendarEvents`, nothing catches it locally, so the whole tick ends and no outbox row is delivered that tick.
- **Fix:** Catch errors from the bookkeeping writes after a successful send and still mark the row `sent`. Wrap `claimDueReminders` the way the events claim is wrapped.

### B10. Changing the account currency relabels every past expense
- **Severity:** low. **Confidence:** high for the behaviour; whether it's a bug is a product call.
- **Where:** [src/app/api/account/route.ts:46](../src/app/api/account/route.ts#L46); `expenses` has no currency column.
- **Scenario:** A user with a year of RON expenses switches to EUR. Every past amount is now shown and summed as EUR, family totals move them to the EUR group, and open import drafts in RON become "not importable".
- **Fix:** Warn and confirm in Settings when expenses exist, or store the currency per expense. Decide in phase 17.

### B11. Large histories are silently cut
- **Severity:** low. **Confidence:** high (but only above the caps).
- **Where:** [src/lib/supabase/repositories/investments.ts:99](../src/lib/supabase/repositories/investments.ts#L99) to [:115](../src/lib/supabase/repositories/investments.ts#L115) and [:151](../src/lib/supabase/repositories/investments.ts#L151) to [:162](../src/lib/supabase/repositories/investments.ts#L162); [src/lib/supabase/repositories/net-worth.ts:83](../src/lib/supabase/repositories/net-worth.ts#L83).
- **Scenario:** An account with 5,001 orders: the read is ordered oldest first and limited to 5,000, so the newest order is dropped. The position is wrong, and a new sell is validated against an incomplete history. With 501 active net-worth items, the 501st (alphabetically by category and name) is missing from the total. No error is shown.
- **Fix:** As D7: page through, or read `cap + 1` and refuse with a clear message.

### B12. A failed kid password reset still forces a password change
- **Severity:** low. **Confidence:** high.
- **Where:** [src/app/api/family/members/[id]/password/route.ts:16](../src/app/api/family/members/[id]/password/route.ts#L16) to [:18](../src/app/api/family/members/[id]/password/route.ts#L18).
- **Scenario:** Step 1 (`require_password_change`) succeeds, then the admin `setPassword` fails (secret key missing, provider error). The parent sees "Unable to reset the password", but the kid's account is already flagged. The kid signs in with their old password and is sent to "Change password" without knowing why.
- **Fix:** Set the password first and the flag second, or clear the flag again when `setPassword` fails.

---

## Mapping to the roadmap phases

| Phase | Findings | Suggested task |
| --- | --- | --- |
| **14, security** | P1 | 14.7: limiter on sign-in (name + IP), sign-up, password and email changes. First task of the phase. |
| | P4, P5, B12 | 14.4: enforce "must change password" in `withUser`; re-authenticate and end other sessions on password change and parent reset. |
| | P3 | 14.4: `Origin` / `Sec-Fetch-Site` check in `withUser` and `application/json` in `parseBody`. |
| | P2, D3 | 14.6: user-facing SQL messages only through a marked code; one translator for every repository. |
| | P8, D8 | 14.7: trusted client IP, app-token throttling, one shared limiter. |
| | P6, B6 | 14.5 (or a new 14.10 "races"): SQL functions with row locks for investment orders and the AI budget; atomic expense update. |
| | D5 | 14.6: a table-driven test listing every route and MCP tool with its module and role. |
| | B7 | 14.7: constant-time username sign-in failures. |
| | B2 | 14.9 (privacy): purge expired drafts whatever the push config. |
| | P10 | 14.2: CI gate before the image is published; SHA-pinned actions; wider `.dockerignore`. |
| **15, logging** | P7 | 15.1: `after()` for background work, with a log line on failure. |
| | B9 | 15.1 / 15.2: worker bookkeeping errors logged and handled after a successful send. |
| | D3 | 15.1: one error type gives the logger one place to read `status` and `code`. |
| **16, performance** | P9 | 16.5: server-side search, a request-scoped family cache, one budget RPC, one `getClaims` per request. |
| | D7, B11 | 16.5: one paging helper; caps that refuse instead of truncating. |
| | P12 | 16.2 / 16.3: server-side session redirect, `loading.tsx` and `error.tsx` per section. |
| | B4 | 16.6: cache updates that don't touch family-view keys. |
| **17, UI** | D6 | 17.5: move expenses, investments, net worth and family screens to the API-object-plus-hook style as each is rebuilt. |
| | D9, B5 | 17.5: one date-display rule and one locale; fix the expense date picker. |
| | D10, B10 | 17.5: decide the expense month rule and the currency-change warning with George. |
| | B1, B8 | 17.5 (expenses screen): two-decimal amounts and clean descriptions, in the shared schema so MCP gets it too. |
| **18, clean-up** | D1 | 18.4: money as decimal strings and `Decimal` throughout expenses. |
| | D2, D3, D4 | 18.4: one validation helper, one error type, one DELETE convention. |
| | P11, B3 | 18.1 / 18.4: drop legacy schema, dead branches and the empty folder; 404 on missing expense delete. |

## What I could not verify

- **Supabase project settings.** I didn't touch the live project, so I couldn't see the Auth rate limits, whether "secure password change" is on, the JWT signing key type (which decides whether `getClaims` is local), or `max-rows`. P1, P5, P9 and D7 depend on them.
- **The reverse proxy.** Whether Tailscale Serve or the proxy in front of the container overwrites `X-Forwarded-For` (P8, and the IP key P1 would need).
- **Production cookies.** I read `@supabase/ssr`'s defaults (`sameSite: "lax"`, `httpOnly: false`) but didn't inspect a live response (P3).
- **Concurrency bugs (P6, B6, B9)** were found by reading the code paths. I didn't reproduce them.
- **The SQL in depth.** I read the policies, grants, guards and the import, invite and to-do locking. I didn't run `npm run test:db` (it needs Docker) or review every function body line by line.
- **One test timed out.** `src/app/dev/preview/import-fixtures.test.ts` ("lists a new draft first, then the confirmed import…") failed with the 5-second timeout. The whole suite took 18 minutes because other agents were working in the same checkout, so this looks like load, not a product bug. Worth a re-run on an idle machine; if it repeats, raise its timeout or split it.
