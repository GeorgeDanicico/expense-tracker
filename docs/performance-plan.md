# Performance plan (family hub phase 16)

This plan makes the app feel fast on a phone: pages show their content (or a skeleton shaped like
it) at once, nothing spins forever, every failure ends in an error with a retry, and taps answer
straight away. It replaces steps 16.1–16.7 in [family-hub-roadmap.md](family-hub-roadmap.md) and
closes the audit findings mapped to phase 16 ([codebase-audit.md](codebase-audit.md): P9, P12,
D7, B11 and B4).

**It measures first and measures last.** Phase 15 gave the app request lines with spans,
`web_vital` lines from real use and Obsy's container metrics. PF1 turns those into a baseline and
budgets, and PF13 checks the same numbers again. A change that doesn't move a number in the table
is not worth its risk.

**When it starts.** PF1 needs L12's few days of journald logs, so about 6 November 2026. S14
(enforcing the CSP, about 9 November) doesn't block any task here, but PF4–PF6 add server-rendered
pages, so whichever of S14 and PF4 merges second checks that the nonce still reaches every inline
script.

## Where the app stands (3 November 2026)

| Area | Today | Gap |
| --- | --- | --- |
| Pages | 17 of the 21 pages outside `/dev` are `"use client"`. The other four (Investments, Net worth, Login, OAuth consent) are server components that only wrap a client panel, which loads its own data. Every page fetches its data with SWR after the JavaScript has loaded. | First paint is a spinner, then a second wait for `/api/account`, then a third for the page's own data. |
| App shell | `src/app/(app)/layout.tsx` is a client component. It waits for `/api/account`, then redirects to `/login` on 401 or `/change-password` on the flag, and prefetches five routes by hand. `src/app/page.tsx` does the same just to redirect to `/dashboard`. | A signed-out visitor downloads the whole app to be told to sign in (audit P12). Every cold load waits for one round trip before anything else starts. |
| Loading states | `DataLoading` (`src/components/ui/data-state.tsx`) has skeleton cards and lines, but they're generic, not shaped like each page. No `loading.tsx` anywhere. | Content arriving moves the page (CLS). Navigation shows nothing until the next page's code has loaded. |
| Error states | `src/app/(app)/error.tsx`, `src/app/error.tsx` and `src/app/global-error.tsx` exist (L7). `DataError` gives a retry. `apiRequest` times out after 15 s. | One boundary for the whole `(app)` group, so an error in Investments replaces the shell. SWR has no `loadingTimeout`; a request that hangs for 14 s shows a spinner for 14 s. A 401 in the middle of a session only redirects when it's `/api/account` that got it. |
| SWR | One global `SWRConfig` in `src/components/ui/provider.tsx`: 2 retries, 15 s dedupe, no focus revalidation. Optimistic updates only in to-dos and reminders. | Account, family, member colours and categories are refetched like any other key. Expenses, investments, net worth and family writes wait for the server, then refetch (audit D6, B4). |
| Bundles | Builds use webpack (`next build --webpack`). `optimizePackageImports` covers Chakra and Lucide. No `next/dynamic` anywhere. dnd-kit loads with the to-do board; every dialog loads with its page. Charts are hand-built (no chart library). Fonts already use `next/font`. | No per-route size is known, so nothing can be budgeted. |
| Images | Avatars are resized to a square WebP by `src/lib/avatars/image.ts` (sharp) on upload. | Fine as they are; `next/image`'s optimiser would only add memory on the VPS. Only size and lazy loading are missing. |
| Server | Every route handler goes through `withUser`, with spans per Supabase call (L4). The project's JWTs are signed with a shared secret (its JWKS is empty), so each `getClaims()` is a round trip to Supabase Auth: once in the proxy, once in `withUser`. The AI budget check is already one atomic RPC (`reserveBudget`, S10), so that part of P9 is closed. | Two Auth calls per signed-in request before any data. `get_family()` runs several times per request; tab search loads every expense and filters in JS (audit P9). Some lists truncate silently (D7, B11). |
| Runtime | `scripts/deploy.sh` caps the web container at 768 MB and the worker at 256 MB (S12). | Node doesn't know the cap: its heap can grow until the container is killed instead of collecting garbage sooner. |

## Design

- **Keep the client components.** Phase 17 rebuilds the screens, so this phase doesn't rewrite
  them. A page becomes a thin server component that starts its first requests and hands the
  results to the same client component through SWR's `fallback`. The client code, its SWR keys and
  its cache updates stay as they are, and the first render already has data.
- **One loader per resource, shared by the route and the page.** The data logic that lives in a
  route file today (for example `accountData` in `src/app/api/account/route.ts`) moves into
  `src/lib/<feature>/load-*.ts`. The route calls it, the page calls it. Same permissions, same
  shape, so the SWR fallback is exactly what the browser would have fetched.
- **The shell never waits on page data.** The `(app)` layout checks the session and loads the
  account, which every page needs. A page's own data streams in behind a `<Suspense>` whose
  fallback is that page's skeleton. Per the installed Next docs (`loading.md`), runtime data in a
  layout blocks navigation, so the layout loads only the account, in parallel with the session
  check. Layouts don't re-render on client navigation, so this costs only the first load.
- **Every data state ends.** Loading turns into "This is taking longer than usual" with a retry
  after 8 s, and into an error with a retry by 15 s at the latest (the client timeout). A 401
  anywhere sends the user to sign in.
- **Skeletons are shaped like the content**, with the same heights, so nothing moves when data
  arrives. They live in `src/components/ui/skeletons.tsx` and are used by `loading.tsx`, the
  Suspense fallbacks and the client loading states alike.
- **No Cache Components, no static prerendering.** The CSP nonce (S7) makes every page dynamic,
  and the app's pages are personal anyway. The `instant` segment config and `"use cache"` need
  `cacheComponents`; they're out of scope (see Decisions).
- **No new runtime dependencies.** A pinned dev dependency (`@next/bundle-analyzer`) only if
  `next analyze` can't build the app.

## Tasks

Same workflow as phases 14 and 15: one task, one branch, one PR, one fresh agent per task, run
one at a time in the main checkout. Branches are `perf/<id>-<slug>` from `main`. Merge when
reviewed and green. **Merging to `main` deploys to production**, so each task must leave
production working on its own. Every task that changes what a page shows checks it in the browser
through `/dev/preview` and on a narrow viewport.

### Which agent picks each task

The rule from phase 14: **opus** for work where a subtle mistake leaks data, changes every
request's behaviour, or needs careful design across many files; **sonnet** for well-specified work
in one area with clear tests; **haiku** only for mechanical edits with no judgement. Effort is
`high` for every task unless noted.

| Task | What | Roadmap | Audit | Depends on | Agent | Why that agent |
| --- | --- | --- | --- | --- | --- | --- |
| PF1 | Baseline and budgets: real-use vitals, server p95, JS per route, memory | 16.1 | — | L12 | **sonnet**, effort medium | Measuring and writing up, plus one small script. |
| PF2 | No endless loading: slow and timeout states, 401 anywhere → sign-in | 16.2 | — | — | **sonnet** | The global SWR config and `data-state.tsx`, with a precise spec. |
| PF3 | Skeletons shaped like each page; `loading.tsx` and `error.tsx` per section | 16.2, 16.6 | P12 (part) | PF2 | **sonnet** | UI primitives and one file pair per section. |
| PF4 | Server-side session gate and account for the `(app)` shell | 16.3 | P12 | PF3 | **opus** | Turns the layout every page goes through into a server component that decides sign-in and password-change redirects. A mistake locks users out or shows a page to the wrong person. |
| PF5 | First data on the server for Home, with the loader pattern | 16.3 | — | PF4 | **opus** | Sets the server/client pattern the other pages copy: loaders moved out of routes, SWR keys matched exactly, viewing member and permissions respected. |
| PF6 | The same for Expenses, To-dos and Reminders | 16.3 | — | PF5 | **sonnet** | Applies PF5's pattern page by page, with its tests as the template. |
| PF7 | Prefetching, waterfalls, longer caching for stable data | 16.3 | — | PF6 | **sonnet** | Navigation and SWR options, measured with the request lines. |
| PF8 | Smaller bundles: dynamic imports, dependency check, a JS budget in CI | 16.4 | — | PF1 | **sonnet** | Splitting by the analyzer's numbers, plus a size check script. |
| PF9 | Fewer round trips in the app: one `getClaims`, request-scoped family, server search, paging helper | 16.5 | P9, D7, B11 | PF1 | **opus** | Changes the auth path and the repositories every route uses; B11 changes what reads return. |
| PF10 | SQL: indexes for the slow queries, from the spans and the performance advisor | 16.5 | — | PF9 | **sonnet** | A migration of indexes only, each tied to a measured query, with pgTAP and `explain` checks. No functions, no data changes. |
| — | **Checkpoint:** George approves applying PF10's migration live | | | PF10 | George | As in every phase: no migration goes live without his go-ahead. |
| PF11 | Smooth interaction: optimistic writes, B4, reduced motion, big lists | 16.6 | B4 | PF3 | **sonnet** | Cache updaters in `invalidate.ts` and a few components, with clear tests. |
| PF12 | Lean runtime: heap caps, `preloadEntriesOnStart`, memory in Obsy | 16.7 | — | PF1 | **sonnet** | Deploy script and config; production-facing, so not haiku. |
| PF13 | Measure and close: PF1's table again, the roadmap updated | — | — | all the above | **sonnet**, effort medium | Running checks and writing them up. |

PF2, PF8, PF9 and PF12 don't depend on each other; the order above is the order they run in,
one at a time. PF10 has the phase's only migration, and it adds indexes only. PF2 and PF3 don't
need PF1's numbers, so they could start before L12 if you want to move sooner.

### PF1: Baseline and budgets

**Files:** new `docs/performance.md`, new `scripts/route-js-size.mjs`, `package.json` (one
script), `docs/logging.md` (link only).

- **Real use, from the logs** (5 days of journald, so run it at least 3 days after L8 deployed):
  - p75 of LCP, INP, CLS, FCP and TTFB per page from `web_vital` lines, split by
    `navigationType` when there are enough samples. Write the `jq` command into the doc so PF13
    runs the same one.
  - p50, p95 and request count per route template from `request` lines, with the three slowest
    spans per route and `dbCalls` per request.
  - Pick these up from L12's report if it already has them; don't measure twice.
- **Lab runs** for the four target pages (Home, Expenses, To-dos, Reminders) on production with a
  seeded test account (one of the project's test users, never George's own): Lighthouse's mobile
  preset (`npx lighthouse@<pinned version> --preset=perf`, which emulates a mid-range phone on a
  slow 4G link), three runs each, median kept. Record LCP, TBT, CLS and the request waterfall's
  depth (how many requests start only after another finished).
- **JS per route:** try `npx next analyze` first (the Turbopack analyzer in Next 16.1+, see
  `node_modules/next/dist/docs/01-app/02-guides/package-bundling.md`). If the app doesn't build
  with Turbopack, add `@next/bundle-analyzer` (pinned) as a dev dependency behind `ANALYZE=true`
  for the webpack build. Either way, `scripts/route-js-size.mjs` reads the webpack build's
  manifests in `.next/` and prints the gzipped first-load JS per app route as a table and as JSON
  (`npm run size:routes`). PF8 turns it into a CI check.
- **Memory:** the web and worker containers' steady state and peak over a few days, from Obsy.
- **Budgets, proposed for George to agree** (in the doc, as a table):
  LCP p75 ≤ 2.5 s, INP p75 ≤ 200 ms, CLS p75 ≤ 0.1 on the four target pages; server p95 ≤ 300 ms
  per route (routes that call the AI or parse a statement excluded, listed by name); first-load
  JS per route at most its baseline, and the four target pages 20% under it; web steady-state
  memory under 60% of its container limit.

**Done when** `docs/performance.md` has the baseline table and the proposed budgets, the commands
to reproduce every number, and George has agreed the budgets (or changed them) in the PR.

### PF2: No endless loading

**Files:** `src/components/ui/provider.tsx`, `src/components/ui/data-state.tsx` (+ test),
`src/lib/api/client.ts` (+ test), new `src/lib/api/auth-redirect.ts` (+ test),
`src/hooks/use-account.ts`.

- **SWR:** add `loadingTimeout: 8_000` and `onLoadingSlow`, which marks the key slow in a small
  client store (`useSlowKeys()` or a context). `DataLoading` takes an optional `slowKey` (or the
  page passes `slow`) and, once slow, shows "This is taking longer than usual." with a Retry
  button that calls `mutate()`. Keep `errorRetryCount: 2`, but cap the whole retry sequence so the
  error shows within 15 s of the first try for a 5xx, and at once for a timeout (the request
  already waited 15 s; don't retry it).
- **401 anywhere:** `onError` sends the browser to `/login?next=<current path>` for any 401. The
  login page already cleans `next` with `safeNextPath` (`src/lib/http/origin.ts`); build the
  value with the same rule so a bad path is never sent. Skip it on `/login`, `/join/*`, `/oauth/consent` and `/change-password`, which
  handle their own 401s. The `(app)` layout's own 401 branch stays until PF4 replaces it.
- **Offline:** when `navigator.onLine` is false, the error says so ("You're offline") instead of
  the generic message; `src/components/pwa/offline-status.tsx` already knows the state, so reuse
  it.
- **Check every screen:** list every `useSWR` call (36 today) and the component that renders its
  states; each must show content, an empty state or `DataError` with a retry, never a spinner
  alone. Fix the ones that don't. `src/components/family-calendar/subscribe-dialog.tsx` loads in a
  raw `useEffect` (audit D6): give it the same three states, without converting it to SWR.

**Tests:** `DataLoading` turns slow after 8 s (fake timers); the retry calls `mutate`; a 401 from
any key redirects once with a safe `next`, and not on the excluded pages; a timeout isn't retried. In `/dev/preview`, a fixture
that never resolves and one that fails show the slow state and the error.

**Done when** with the API stopped (or every preview fixture failing), every screen shows an
error with a retry within 15 s, and no screen ever shows a spinner with no end.

### PF3: Skeletons and a boundary per section

**Files:** new `src/components/ui/skeletons.tsx` (+ test), `src/components/ui/data-state.tsx`,
new `loading.tsx` and `error.tsx` in each of `src/app/(app)/{dashboard,expenses,investments,net-worth,todos,reminders,calendar,settings}/`,
`src/components/ui/error-page.tsx`, the page components that render `DataLoading` today.

- **Skeletons shaped like content:** `PageHeaderSkeleton`, `StatRowSkeleton`, `ListSkeleton`
  (rows the height of `ListRow`), `ChartSkeleton` (the height of the dashboard charts),
  `BoardSkeleton` (to-do columns), `CalendarSkeleton`. Each matches its real component's height
  at the base and `md` breakpoints, so swapping one for the other moves nothing (check with the
  browser's layout-shift overlay or by comparing `getBoundingClientRect()` heights in the PR).
  All of them `aria-busy` with a visually hidden label, as `DataLoading` does now.
- **One skeleton per page:** each section's `loading.tsx` composes the page's skeleton, and the
  page's client loading state renders the same one, so the user sees one skeleton, not a skeleton
  then a spinner then content.
- **`error.tsx` per section** using `ErrorPage` with a retry (`reset`) and a link home, and the
  same `client_error` report as `src/app/(app)/error.tsx` (L7). An error in Investments now keeps
  the shell and its navigation.
- **Reduced motion:** the skeleton shimmer stops under `prefers-reduced-motion: reduce` (check
  what Chakra's `Skeleton` does already; add it in the theme recipe if not).

**Tests:** each skeleton renders with the label and `aria-busy`; a section error keeps the shell
mounted (render the layout with a throwing page); reduced motion turns the animation off.

**Done when** every section has a `loading.tsx` and an `error.tsx`, the client loading state of
each page is that page's skeleton, and switching from skeleton to content causes no visible shift
on the four target pages.

### PF4: The session gate and the account on the server

Closes P12.

**Files:** `src/app/(app)/layout.tsx` (server), new `src/app/(app)/app-shell-client.tsx`,
new `src/lib/account/load-account.ts` (+ test), `src/app/api/account/route.ts`,
`src/app/page.tsx` (server), `src/lib/supabase/auth.ts` (only if a page-side helper is missing),
`src/components/layout/app-shell.tsx`, layout tests.

- **Read first:** `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md`
  (its "interaction with loading.js" caveats), `…/loading.md`, `…/02-guides/streaming.md` and
  `…/02-guides/authentication-with-cache-components.md` (for the session-check advice that
  applies without Cache Components too).
- **`load-account.ts`:** move `accountData` and `accountMembership` out of the route into
  `loadAccount(user)`. The route calls it; its response doesn't change (the route's snapshot and
  response-shape tests must pass untouched).
- **The layout:** a server component that gets the user the same way `withUser` does
  (`getAuthenticatedUser`, inside `runWithSupabaseClient` with the request's cookie client), then:
  no user → `redirect("/login?next=…")`; `mustChangePassword` → `redirect("/change-password")`;
  otherwise render `AppShellClient` with the account passed as SWR `fallback` for
  `ACCOUNT_API_KEY`. The client part keeps everything that needs the browser: the shell, the
  account notice dialog, `useAccount()` revalidation. Drop the hand-written `router.prefetch`
  list; PF7 handles prefetching.
- **Same rules as the API:** a kid with `mustChangePassword`, a member removed from a family, a
  deleted account and an expired session each get the same result here as they'd get from
  `/api/account`. Test each.
- **Root page:** `src/app/page.tsx` becomes a server component that redirects to `/dashboard` or
  `/login` with no client JavaScript.
- **No double Auth call per page:** the proxy already refreshed the session; the layout's check
  should reuse the claims if the proxy can pass them (it can't share memory with the page, so
  measure instead: if the layout adds an Auth round trip to every cold load, note it for PF9 and
  for the JWT signing key decision below).
- **CSP:** the nonce from `proxy.ts` must still reach next-themes' script and Next's own inline
  scripts. Check the browser console shows no violations on a cold load of each section.

**Tests:** the layout redirects for no session, must-change-password and a kid's first sign-in;
renders with the account in the SWR cache (no `/api/account` request on first render, checked with
a fake fetcher that fails if called); `loadAccount` returns what the route returned before (snapshot).

**Done when** a signed-out visitor to any `(app)` page gets a redirect with no app JavaScript, a
signed-in cold load shows the shell without waiting for `/api/account`, and no route test changed.

### PF5: First data on the server for Home

**Files:** `src/app/(app)/dashboard/page.tsx` (server), new
`src/app/(app)/dashboard/dashboard-client.tsx` (the current page body), new
`src/lib/dashboard/load-*.ts` (+ tests), `src/app/api/dashboard/**/route.ts`,
`src/lib/api/keys.ts` (only to export key builders the server can import), `src/hooks/use-viewing.ts`
(only if the viewed member must be read on the server).

- **Loaders:** move the logic of the dashboard routes the first view needs (the summary view's
  data, and the family summary when the viewed member is "all") into loaders. Routes call them.
- **Keys must match exactly.** The server builds the SWR key with the same function the client
  uses (`dashboardApiKey` and friends in `src/lib/api/keys.ts`), from the same parsed search
  params (`parseAnalyticsFilters`, `dashboardView`, `dashboardMonth` in
  `src/lib/expenses/url-state.ts`). The month and "today" use `APPLICATION_TIMEZONE`, never the
  server's zone. A test renders the page for several URLs and asserts that the client asks for
  nothing on first render (a fetcher that throws if called).
- **The page:** a server component that awaits `searchParams`, works out the viewed member (with
  the same permission checks as `resolveViewedUser`), starts the loaders without awaiting them, and
  renders `<Suspense fallback={<DashboardSkeleton />}>` around a small async component that awaits
  them and renders `<SWRConfig value={{ fallback }}>` with the client page inside. Check whether
  SWR 2.4 accepts promises in `fallback` (it would let the shell stream before the data); if it
  does, prefer that and drop the async wrapper.
- **Errors:** a loader that throws must not break the page: the server catches it, leaves that key
  out of `fallback`, and the client fetches it as before (and shows its own error state if it
  fails again). Log it as `server_prefetch_failed` with the route template, never the data.
- **Views other than the first:** switching between Summary, Monthly and History stays client-side
  as today. Only the view in the URL is loaded on the server.
- **Document the pattern** at the top of the loader file and in `docs/performance.md`, so PF6 and
  phase 17 follow it.

**Tests:** loaders return what the routes returned before (route tests untouched); keys match
for the summary, monthly and history URLs, own view and family view; a kid without the
permission gets the same refusal as from the API; a failing loader falls back to the client.

**Done when** a cold load of Home shows real numbers in the first HTML (check with
`curl -b <test cookie>` or the browser's "view source"), no request to the dashboard API happens on
first render, and Home's lab LCP is under 2.5 s.

### PF6: The same for Expenses, To-dos and Reminders

**Files:** for each page, `page.tsx` (server), a `*-client.tsx` with the current body, loaders in
`src/lib/{expenses,todos,reminders}/load-*.ts` (+ tests), the routes they come from.

- Apply PF5's pattern unchanged. Expenses: the month's list and totals for the viewed member and
  the selected tab, read from the URL as `src/lib/expenses/url-state.ts` does. To-dos: the open
  board (the to-do board has optimistic updates in `use-todo-board.ts`; seeding its key must not
  change them). Reminders: the list and the badge count.
- One commit per page, so a problem in one can be reverted alone.
- Calendar, Investments and Net worth stay client-loaded in this phase; list them in
  `docs/performance.md` as "next" if PF1's numbers say they're slow too.

**Tests:** as PF5, per page.

**Done when** all three pages render their data in the first HTML, make no data request on first
render, and meet the LCP budget in the lab.

### PF7: Prefetching, waterfalls and stable data

**Files:** `src/components/layout/nav-item.tsx`, `mobile-tab-bar.tsx`, `src/components/ui/provider.tsx`,
the hooks for stable data (`src/hooks/use-account.ts`, `use-member-colors.ts`, `use-viewing.ts`),
`src/lib/api/invalidate.ts`.

- **Prefetching:** read `node_modules/next/dist/docs/01-app/02-guides/prefetching.md` and
  `optimizing-prefetching.md`. Navigation `Link`s keep their default prefetch; check in the
  production build that the RSC payloads for the main sections are fetched when the links appear,
  and that the mobile tab bar does it too. No prefetch for settings subpages.
- **Waterfalls:** from PF1's waterfall depths and the request lines (same user, same second),
  find requests that only start after another finishes. Fix by starting them together (the
  server loaders from PF5/PF6 already do on first load; this is for client navigation), or by a
  combined endpoint only where two requests always go together and the request lines show it.
- **Stable data cached longer:** account, family, member colours and categories get
  `revalidateIfStale: false` and a longer `dedupingInterval` (5 minutes) through their hooks, and
  every write that changes them already calls `mutate` on their keys (check each one in
  `invalidate.ts` and the settings dialogs; add the missing ones with tests).

**Tests:** each write that changes stable data updates its key; the hooks pass the longer options.

**Done when** moving between Home, Expenses, To-dos and Reminders makes no request for account,
family or colours, and the waterfall depth on each target page is at most 2.

### PF8: Smaller bundles

**Files:** the components named below, `scripts/route-js-size.mjs`, new
`docs/performance-budget.json` (or a section in `docs/performance.md` the script reads),
`.github/workflows/ci.yml`, `next.config.ts` (only if `optimizePackageImports` needs more
packages).

- **Dynamic imports** (`next/dynamic`, see `…/02-guides/lazy-loading.md`), each checked against the
  analyzer before and after; keep only those that save at least 10 KB gzipped on a target page:
  - dialogs that open on a tap (`AddExpenseDialog`, `ExpenseTabDialog`, the investment and net
    worth dialogs, the family dialogs), loaded when first opened, with the open button showing a
    pending state if the chunk isn't there yet; preload the chunk on hover or focus;
  - the statement import screen and its review step;
  - dnd-kit only if the board can render read-only first without a layout shift; otherwise leave
    it (the board is the to-dos page's main content).
- **Server-only code stays out of the client:** check that `openai`, `unpdf`, `web-push`,
  `sharp`, `fflate` and `@modelcontextprotocol/server` appear in no client chunk (the analyzer's
  client view). Any that does is a bug: fix the import.
- **Dependencies:** list unused ones (`npx knip --dependencies` without adding it, or a manual
  check); remove only those clearly unused, and leave the full dead-code pass to phase 18.1.
- **Images:** avatars are already resized on upload, so no `next/image` optimiser (it would run
  sharp in the web container on every new size). Give `Avatar` explicit width and height and
  `loading="lazy"` outside the header, and check the avatar response's `Cache-Control`.
- **CI budget:** `npm run size:routes -- --check` fails when a route's first-load JS is over its
  budget (from PF1) by more than 2%, printing the table. Add it to CI after the build step.

**Tests:** the size script's parsing against a fixture manifest; the dynamic dialogs still open,
focus their first field and close (existing dialog tests must pass).

**Done when** each target page's first-load JS is within its budget, the CI check runs, and no
server-only package is in a client chunk.

### PF9: Fewer round trips in the app

Closes P9 (its budget item was already closed by S10), D7 and B11.

**Files:** `src/lib/supabase/proxy.ts`, `src/proxy.ts`, `src/lib/http/proxy-matcher.ts`,
`src/lib/supabase/auth.ts`, `src/lib/family/viewed-user.ts`, `src/lib/family/current-member.ts`,
the to-do and calendar repositories, `src/lib/supabase/repositories/expenses.ts`, `imports.ts`,
`investments.ts`, `net-worth.ts`, `calendar.ts`, `todos.ts`, `reminders.ts`, new
`src/lib/supabase/fetch-all-pages.ts` (+ test), the matching tests and fakes.

- **One `getClaims` per request.** Today the proxy refreshes the session and `withUser` verifies
  it again: two Auth round trips while the JWT secret is shared. Options, in order of preference:
  1. George moves the project to asymmetric JWT signing keys (see Decisions); `getClaims` then
     verifies locally and both calls are free. Nothing to build; check that `getClaims` stops
     calling Auth (L4's `auth.*` spans disappear from `request` lines).
  2. Otherwise, skip the proxy's refresh for `/api/*` requests that carry a valid, unexpired
     access token (decode only, no verification, in the proxy), and let `withUser` verify and
     refresh it. Pages keep the proxy refresh. This changes session handling: test an expired
     access token with a valid refresh token on both an API call and a page load.
  Build option 2 only if George declines option 1.
- **Request-scoped family:** `get_family()` once per request. Put the result on L2's request
  context (or a small `AsyncLocalStorage` next to the scoped Supabase client) keyed by user id,
  read by `getCurrentMember` and the to-do and calendar repositories. Writes that change the
  family (role, permissions, members) clear it. Remove the `cache()` that does nothing in route
  handlers (audit P11 names it).
- **Search on the server:** the tab ledger search filters with `ilike` (escape `%`, `_` and `\` in
  the user's text) and pages like the rest, instead of loading every expense and filtering with
  `matchesExpenseSearch` in JS. The results must stay the same: search the same fields with an
  `or()`, and keep the existing search tests passing against the new query.
- **One paging helper (D7):** move `fetchAllPages` to `src/lib/supabase/fetch-all-pages.ts`, fix
  its short-read failure, and use it for every list that must be complete (calendar, open to-dos,
  reminders, the import expense counts). **Caps that refuse (B11):** where a cap is wanted
  (investment transactions, net-worth items), read `cap + 1` and answer a clear 409/422 ("This
  account has more than 5,000 orders; contact …") instead of truncating; the investment read
  also orders so that nothing newest is ever the one dropped.
- **Measure:** `dbCalls` and `dbMs` per route before and after, from the request lines, in the PR.

**Tests:** family read once per request across two repository calls; cleared after a family
write; `ilike` escaping; paging over several pages and a short page; the cap refusals; session
refresh paths if option 2 is built.

**Done when** no route makes more than one `get_family()` call or (with option 1) any Auth call
for a signed-in request, search no longer reads all matches, and no list truncates silently.

### PF10: SQL: indexes for the slow queries

**Files:** new migration `supabase/migrations/<timestamp>_performance_indexes.sql`,
`supabase/tests/*.sql` (pgTAP), `docs/performance.md`.

- **Find them:** PF1's and PF9's slowest `db.*` and `rpc.*` spans, the Supabase performance
  advisor (`get_advisors` with type performance, read-only), and `explain (analyze, buffers)` on
  the queries behind them, run against a local database seeded to a realistic size (a few years of
  expenses for a family of four), never against the live project.
- **Add only what a slow query uses.** Each index is listed in the migration with a comment
  naming the query it serves and its `explain` before and after. Unused-index warnings from the
  advisor are listed in `docs/performance.md` for George; drop none in this task.
- **No functions and no data changes**, so the app works the same before and after the migration
  is applied, and the PR can merge before it goes live.
- **Checks:** a pgTAP test per index that it exists, and `npm run test:db`. Strip `begin;`/`commit;`
  when applying through MCP (as in S10), then check each index with `pg_indexes`.
- **Checkpoint:** ask George before the migration goes live.

**Done when** the migration is applied on George's go-ahead and no route's server p95 is over
300 ms in the next few days of request lines (or the ones that are have a reason in
`docs/performance.md`).

### PF11: Smooth interaction

Closes B4.

**Files:** `src/lib/api/invalidate.ts` (+ test), the expense, net worth and investment dialogs
that call it, `src/components/expenses/*-panel.tsx` (big lists), the theme's transition tokens.

- **Optimistic writes** where the write nearly always succeeds: adding, editing and deleting an
  expense; adding a net-worth valuation; renaming a tab. Use SWR's `optimisticData` with
  `rollbackOnError: true` and the existing updaters (`withExpenseAdded`, `withExpenseRemoved`), so
  the list changes on the tap and goes back with an error message if the server refuses. Leave
  investment orders as they are (the server validates the position, so they fail more often).
  Converting these modules to the API-object-plus-hook style (D6) is phase 17's job; this task
  only uses SWR's options where the calls already are.
- **B4:** the updaters skip keys with `member=` (the family view) and revalidate them instead, so
  the family list and its totals never disagree.
- **Big lists:** measure the expenses list's INP with a month of 300 expenses in `/dev/preview`
  (React profiler or the browser's INP readout). Memoise rows (`React.memo` with stable props) only
  if the numbers show re-renders cost; windowing only if a month can realistically pass 1,000
  rows.
- **Motion:** every transition in the theme and components respects `prefers-reduced-motion`
  (check the Chakra recipes and any `transition` in components).

**Tests:** optimistic add and delete update the list at once and roll back on a 4xx and a 5xx;
the family key is revalidated, not rewritten (B4's scenario as a test).

**Done when** adding or deleting an expense updates the list at once, B4's scenario passes, and
INP p75 on the target pages is under 200 ms in the lab.

### PF12: Lean runtime on the VPS

**Files:** `scripts/deploy.sh`, `Dockerfile` (only if the start command needs it), `next.config.ts`,
`docs/performance.md`, a note for the vps-apps README (as text in the PR for George to paste).

- **Heap caps:** set `NODE_OPTIONS=--max-old-space-size=<n>` for each container from its memory
  limit: about 70% of `WEB_MEMORY_LIMIT` and 70% of `WORKER_MEMORY_LIMIT`, worked out in
  `deploy.sh` from the same variables (so overriding the limit moves the cap), with
  `WEB_HEAP_MB`/`WORKER_HEAP_MB` as overrides. Validate like the other inputs.
- **`experimental.preloadEntriesOnStart`** (see `…/02-guides/memory-usage.md`, "Preloading
  Entries"): measure the web container's memory after start and the first request's time with it
  on and off, on the VPS or a container with the same limit. Turn it off only if it saves more
  than 50 MB and the first request after a deploy stays under 2 s. Record both numbers.
- **Memory in Obsy:** Obsy already shows container memory; check it shows the limit next to the
  use, and note in `docs/performance.md` what steady state and peak look like after this task.
- **Checks:** `bash -n` and `shellcheck`, a dry run described in the PR (as S12 and L8 did).

**Done when** both containers run with a heap cap, the preload decision is recorded with its
numbers, and steady-state memory is within PF1's budget.

### PF13: Measure and close

**Files:** `docs/performance.md`, `docs/family-hub-roadmap.md`.

- Run every PF1 measurement again with the same commands, at least 3 days after the last
  deploy, and put the numbers next to the baseline with the budget and a pass/fail column.
- A short production smoke test, as a checklist with results: signed-out redirect with no app
  JavaScript; each target page's first HTML has data; the API stopped (or blocked in the browser)
  gives errors with retry within 15 s; an optimistic add rolls back on a refused write; a section
  error keeps the shell; no CSP violations.
- Anything over budget gets a line saying why and whether it moves to phase 17 or 18.
- Update the roadmap's phase 16 section to "done", linking this plan and `docs/performance.md`,
  and correct its out-of-date starting point (the global `SWRConfig` exists).

**Done when** the comparison table and the checklist are merged and each budget is met or has
a reason and a home.

## Decisions for George

| Decision | Recommendation |
| --- | --- |
| Budgets | As proposed in PF1 (LCP 2.5 s, INP 200 ms, CLS 0.1 at p75; server p95 300 ms; JS at most the baseline, target pages 20% under). Agree or change them in PF1's PR. |
| Supabase JWT signing keys | **Move the project to asymmetric signing keys** (Supabase dashboard → JWT Signing Keys, rotate to an ES256/RS256 key; the old shared secret stays valid until existing tokens expire). `getClaims` then verifies locally: one to two fewer Auth round trips on every signed-in request and every cold page load, with nothing to build. It's a project setting, so it's yours to change; PF9 only checks the effect. |
| Server loading for which pages | Home, Expenses, To-dos and Reminders (the roadmap's targets). Calendar, Investments, Net worth and Settings stay client-loaded until phase 17 rebuilds them, unless PF1 shows they're slow. |
| Cache Components (`cacheComponents`, `"use cache"`, `instant`) | Not in this phase. Every page is dynamic because of the CSP nonce and personal data, so the static shell would be small, and turning it on changes how every layout and page is checked at build time. Revisit with phase 17. |
| `next/image` for avatars | No. Avatars are already small WebP squares; the optimiser would run sharp in the web container for no gain. |
| Optimistic investment orders | No. The server checks the position, so a refused order would flash in and out. Expenses, valuations and tab renames only. |
| `preloadEntriesOnStart` | Decide from PF12's two numbers (memory saved vs. first request after a deploy). |
| Bundle analyzer | `next analyze` if the app builds with Turbopack; otherwise `@next/bundle-analyzer` as a pinned dev dependency, used only on demand. |

## Not in this plan

- **Rebuilding screens or changing what they show:** phase 17. This phase keeps the client
  components and their SWR keys so phase 17 can restyle them freely.
- **Converting older modules to the API-object-plus-hook style (D6):** phase 17, screen by screen.
- **Money as decimals, one error type, dead code (D1–D4, P11):** phase 18. PF9 only removes the
  `cache()` it replaces.
- **A CDN or edge caching.** The app is personal and behind Tailscale; there's nothing shared to
  cache at the edge.
- **Service-worker caching of API responses** for offline use. Worth its own plan with the native
  apps (phase 9), which need an offline story anyway.
- **Performance work on Obsy.**
