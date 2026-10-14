# Streaming MCP endpoint in Next.js (`/api/mcp`), signed in with app credentials

## Context

You want Claude (Claude Code and Claude Desktop) to read and change expense-tracker data in plain language, for example "what did I spend on groceries this month?", "add 45 RON fuel today" or "add a valuation for my apartment". The MCP server lives **inside the Next.js app** as a Streamable HTTP route.

It authenticates with your existing app email and password. The server signs in once, then caches and refreshes that session. There are **no database or Supabase configuration changes**: the existing login, RLS policies and SQL functions keep doing their job unchanged.

Decisions already made with you:
- **Clients:** Claude Code (connects directly) and Claude Desktop (connects through the `mcp-remote` bridge).
- **Scope:** expenses, expense tabs, investments, net worth.
- **Expense writes:** add, update and delete. Delete tools carry `destructiveHint`.
- **Auth:** an `Authorization: Basic base64(email:password)` header, sent over HTTPS.

## Architecture

```
Claude Code ──(Streamable HTTP, SSE responses)──► POST /api/mcp
Claude Desktop ──mcp-remote──┘                        │
                                                      │ 1. check Origin, parse Basic credentials
                                                      │ 2. getMcpSession(): in-memory session cache
                                                      │    miss → supabase.auth.signInWithPassword (once)
                                                      │    hit  → reuse client; supabase-js refreshes the token
                                                      │ 3. runWithSupabaseClient(session.client, …)
                                                      ▼
                       McpServer tools ──► existing src/lib/data/* + src/lib/validation/* (one source of rules)
                                                      ▼
                                       Supabase: RLS + auth.uid() exactly as for the web UI
```

Key choices:
- **Stateless Streamable HTTP.** Each POST gets a fresh `McpServer` and transport, and the response streams back over SSE. There are no MCP sessions, no sticky routing and no Redis, which fits the single Docker container.
- **The login session is cached, not re-created.** `signInWithPassword` runs once per credential set while the process lives. After that, supabase-js refreshes the access token from the refresh token. A container restart just means one new sign-in.
- **The data layer stays as it is.** Every `src/lib/data/*` function calls `createClient()`. A request-scoped override using AsyncLocalStorage in `src/lib/supabase/server.ts` makes those calls use the MCP session's client. About 20 call sites need no signature changes, and RLS applies automatically.
- **Tools call functions, not HTTP.** They reuse the same Zod schemas and data functions as the routes, so there is no internal HTTP round-trip and no duplicated rules.

---

## Task 0 — Preparation

- 0.1 Read the bundled Next 16 docs, as `AGENTS.md` requires: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and `proxy.md`.
- 0.2 Install the MCP TypeScript SDK at an exact version, like the other dependencies. The stable line is v2, so the app uses `@modelcontextprotocol/server` (pinned at 2.3.0), not `@modelcontextprotocol/sdk`. Confirm that it:
  - supports Zod 4, which the project pins at 4.4.3;
  - provides `McpServer.registerTool`;
  - provides `WebStandardStreamableHTTPServerTransport` (Fetch `Request`/`Response`, which fits App Router handlers).
- 0.3 Copy this plan to `docs/mcp-server-plan.md`, the same way the other feature plans are kept in `docs/`.

## Task 1 — Request-scoped Supabase client

In `src/lib/supabase/server.ts`:

- 1.1 Add `const scopedClient = new AsyncLocalStorage<SupabaseClient<Database>>()` and export `runWithSupabaseClient(client, fn)`.
- 1.2 `createClient()` returns `scopedClient.getStore()` when one is set. Otherwise it keeps the current cookie-based behaviour, so the web app is unaffected.
- 1.3 Test: inside `run…`, `createClient()` returns the scoped client; outside it, it returns the cookie client.

## Task 2 — MCP authentication (`src/lib/mcp/auth.ts`, `server-only`)

- 2.1 `parseBasicCredentials(request)`:
  - decode `Authorization: Basic …`;
  - validate it with a Zod schema that matches the login route's `authSchema` limits (valid email, 8–128 char password);
  - return null when the header is missing or malformed.
- 2.2 `getMcpSession(credentials) → { client, userId, email } | null`:
  - **Cache:**
    - a module-level `Map<key, Promise<Session>>`, where `key = sha256(email + "\0" + password)`;
    - storing the promise means concurrent first calls share one sign-in;
    - capped at about 20 entries;
    - a failed sign-in removes its entry.
  - **On a miss:**
    - create a supabase-js client with the existing `getSupabaseConfig()` (`persistSession: false`, `autoRefreshToken: true`, in memory only);
    - call `signInWithPassword` once.
  - **On a hit:** call `client.auth.getSession()`, which refreshes the token if it is near expiry.
  - **If a refresh fails** (the refresh token was revoked or the password changed): drop the entry and sign in once more. If that also fails, return null.
- 2.3 Failed-login throttle: an in-memory counter per credential key and client IP. After 5 failures in 15 minutes, return 429 without contacting Supabase. This protects the account and Supabase's auth rate limits.
- 2.4 Never log credentials. Errors carry only generic messages.

## Task 3 — Streaming route (`src/app/api/mcp/route.ts`)

- 3.1 One `handle(request)` function, exported as `POST`, `GET` and `DELETE`. It runs these steps in order:
  1. If an `Origin` header is present and is not the `SITE_URL` origin, return 403. This is the MCP spec's DNS-rebinding guard; Claude Code and `mcp-remote` send no Origin.
  2. Parse the credentials and get the session. On failure, return 401 with `WWW-Authenticate: Basic realm="expense-tracker"`, or 429 when the throttle triggers.
  3. `const server = createMcpServer({ userId, email })`.
  4. Create a `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined })` in stateless mode. Responses stream over SSE. Only POST reaches the transport: after the auth check, the route itself answers GET and DELETE with 405 (`Allow: POST`), because in stateless mode the raw transport would otherwise hold a GET stream open.
  5. `await server.connect(transport)`.
  6. `return runWithSupabaseClient(session.client, () => transport.handleRequest(request))`.
- 3.2 Responses send `Cache-Control: private, no-store`, matching the existing `PRIVATE_HEADERS`.
- 3.3 `src/proxy.ts`: exclude `api/mcp` from the matcher. MCP requests carry no cookies, so `updateSession()` → `getClaims()` would be wasted work on every call.

## Task 4 — DRY the expense data layer (shared by the routes and MCP)

At the moment the expense insert lives inline in the POST of `src/app/api/expenses/route.ts`, and the delete in `src/app/api/expenses/[id]/route.ts`.

- 4.1 `src/lib/data/expenses.ts`:
  - add `createExpenseForUser(userId, input)` and `deleteExpenseForUser(userId, id)`;
  - add `updateExpenseForUser(userId, id, patch)`, which loads the owned row, merges the patch, **re-validates with the existing `expenseSchema`** (one rule set), updates, and returns the stored row (a DB classifier may rewrite the category);
  - add one `EXPENSE_COLUMNS` constant, since the column list currently appears 3 times.
- 4.2 Extract `summarizeExpenses(expenses) → { total, count, average }`. The expenses GET and the expense-tab expenses GET both compute this inline today, and MCP needs it too.
- 4.3 Point the POST and DELETE routes at the new functions without changing their behaviour. Update `src/app/api/expenses/route.test.ts` to mock the data function.
- 4.4 `src/lib/utils/dates.ts`: add `getApplicationToday()`, the Europe/Bucharest date, using the same pattern as `getApplicationCurrentMonth`. It is the default date for `add_expense`.
- 4.5 No new web PATCH route and no UI changes. Editing in the UI is out of scope (YAGNI).

## Task 5 — MCP server and tool helper

- 5.1 `src/lib/mcp/define-tool.ts`: `defineTool({ name, title, description, schema, annotations, run })`. It:
  - passes `schema.shape` as `inputSchema`;
  - **re-parses with the full schema** in the handler, because `superRefine`/`refine` rules are not part of the shape;
  - maps errors:
    - `ZodError` → `isError` plus flattened `fieldErrors`;
    - `InvestmentMutationError` and `NetWorthMutationError` → their message;
    - anything else → a generic message plus `console.error` on the server;
  - on success returns `{ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data }`.
- 5.2 `src/lib/mcp/server.ts`: `createMcpServer({ userId, email })` builds an `McpServer` with the name `expense-tracker` and short `instructions`:
  - amounts are in the account currency;
  - dates are YYYY-MM-DD in Europe/Bucharest;
  - call `get_account` first.

  It then registers the tool modules. `userId` comes **only** from the authenticated session and is never accepted as tool input.

## Task 6 — Tools (`src/lib/mcp/tools/{account,expenses,expense-tabs,investments,net-worth}.ts`)

Annotations: reads get `readOnlyHint`, 🔴 tools get `destructiveHint`, and updates or upserts get `idempotentHint`.

| Tool | Reuses |
|---|---|
| `get_account` (email, currency, category→subtype map, today) | `getAccountCurrencyForUser`, `EXPENSE_CATEGORIES`/`CATEGORY_LABELS`/`SUBTYPE_CATEGORIES`, `getApplicationToday` |
| `list_expenses` `{ month }` | `getMonthlyExpensesForUser` + `summarizeExpenses` |
| `get_spending_summary` `{ period, granularity?, date? }` | `getDashboardDataForUser` + `parseAnalyticsFilters` (`src/lib/utils/analytics.ts`) |
| `add_expense` (`expenseDate` defaults to today) | `expenseSchema`, `createExpenseForUser` |
| `update_expense` `{ id, …partial }` | `updateExpenseForUser` |
| `delete_expense` 🔴 | `deleteExpenseForUser` |
| `list_expense_tabs` | `getExpenseTabsForUser` |
| `get_expense_tab_expenses` `{ tabId, filters? }` | `getExpenseTabForUser` + `getExpenseTabExpensesForUser`, `expenseTabFiltersSchema` (default `DEFAULT_EXPENSE_TAB_FILTERS`) |
| `create_expense_tab` / `update_expense_tab` | `expenseTabSchema`, `createExpenseTabForUser` / `updateExpenseTabForUser` |
| `delete_expense_tab` 🔴 | `deleteExpenseTabForUser` |
| `get_investments` | `getInvestmentsOverviewForUser` |
| `list_investment_transactions` | `investmentTransactionQuerySchema`, `getInvestmentTransactionsForUser` |
| `add_investment_transaction` | `investmentTransactionSchema`, `createInvestmentTransactionForUser` |
| `delete_investment_transaction` 🔴 | `deleteInvestmentTransactionForUser` |
| `get_net_worth` | `getNetWorthOverviewForUser` |
| `add_net_worth_item` | `netWorthItemSchema`, `createNetWorthItemForUser` |
| `update_net_worth_item` (rename, recategorize, archive) | `netWorthItemPatchSchema`, `updateNetWorthItemForUser` |
| `add_net_worth_valuation` | `netWorthValuationSchema`, `addNetWorthValuationForUser` |
| `update_net_worth_valuation` | `netWorthValuationSchema`, `updateNetWorthValuationForUser` |

- 6.1 Keep descriptions short (the tool list costs context on every turn). Allowed values come from the schema enums, not from prose.
- 6.2 Return the existing domain DTOs as they are; never raw DB rows.

## Task 7 — Tests (Vitest, in the mocking style of `src/app/api/expenses/route.test.ts`)

- 7.1 `src/lib/mcp/auth.test.ts`:
  - Basic header parsing: valid, malformed, missing;
  - one sign-in shared by concurrent calls;
  - cache reuse;
  - a refresh failure leads to exactly one new sign-in;
  - bad credentials → null and the cache entry is cleared;
  - throttle → 429 after 5 failures.
- 7.2 `src/app/api/mcp/route.test.ts`:
  - 401 plus `WWW-Authenticate` without credentials;
  - 403 for a foreign Origin;
  - `tools/list` returns 20 tools with the right annotations;
  - `tools/call add_expense` uses the **session's** userId even when the arguments include `user_id`;
  - a validation failure comes back as `isError` with field errors.
- 7.3 `src/lib/supabase/server` scoping test (Task 1.3).
- 7.4 Data layer:
  - `updateExpenseForUser` rejects a subtype that doesn't match the category;
  - it returns null for a foreign or missing id;
  - it returns the stored classification.

## Task 8 — Docs and client setup

- 8.1 Add an "MCP / Claude" section to the README covering the endpoint, the auth header, the tool list and the security notes below.
- 8.2 Claude Code:
  ```bash
  claude mcp add --transport http expense-tracker https://<app>/api/mcp -s user --header "Authorization: Basic $(printf '%s' 'you@example.com:password' | base64)"
  ```
- 8.3 Claude Desktop (`claude_desktop_config.json`):
  `{"command":"npx","args":["-y","mcp-remote","https://<app>/api/mcp","--header","Authorization:${AUTH}"],"env":{"AUTH":"Basic <base64>"}}`
- 8.4 Security notes:
  - Production must sit behind HTTPS, because a Basic header over plain HTTP exposes the password.
  - The credentials live in the local Claude config, so keep those files private.
  - Changing your password invalidates the cached session; update the header afterwards.

## Files

- **New:**
  - `src/app/api/mcp/route.ts`
  - `src/lib/mcp/{auth,define-tool,server}.ts`
  - `src/lib/mcp/tools/*.ts`
  - tests next to each
  - `docs/mcp-server-plan.md`
- **Modified:**
  - `src/lib/supabase/server.ts`
  - `src/lib/data/expenses.ts`
  - `src/app/api/expenses/route.ts`, `src/app/api/expenses/[id]/route.ts`, and the expense-tab expenses route (for `summarizeExpenses`)
  - `src/lib/utils/dates.ts`
  - `src/proxy.ts`
  - `package.json`, `README.md`

## Verification

1. Run `npm run test`, then `npm run check` (lint, typecheck and build).
2. With `npm run dev` running, send an `initialize` request with `curl -N -X POST localhost:3000/api/mcp`, using an `Accept: application/json, text/event-stream` header:
   - without the header → 401;
   - with it → an SSE stream that contains the server's capabilities.
3. `npx @modelcontextprotocol/inspector`, using Streamable HTTP to `http://localhost:3000/api/mcp` with the Basic header:
   - run every read tool;
   - run `add_expense` → `update_expense` → `delete_expense` on a test row and watch the ledger page update after an SWR refocus;
   - send a wrong subtype and check that the field error comes back.
4. Claude Code: run `claude mcp add …` (8.2), then use `/mcp` to confirm it is connected. Then:
   - ask "add 12.50 groceries today, then show this month's grocery total";
   - ask it to delete that expense and confirm Claude asks for approval first.
5. Restart the dev server and call a tool again. It should sign in once more and work. Send 6 bad passwords in a row and check for a 429.
