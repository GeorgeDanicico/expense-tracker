# Performance plan (family hub phase 16)

This plan makes the app feel fast on a phone. Pages show their content, or a skeleton shaped like
it, at once. Nothing spins forever, every failure ends in an error with a retry, and taps respond
straight away. It replaces steps 16.1–16.7 in [family-hub-roadmap.md](family-hub-roadmap.md) and
closes the audit findings mapped to phase 16 ([codebase-audit.md](codebase-audit.md): P9, P12, D7
and B11; B4 was closed by phase 17's U8).

**Revised 8 November 2026** after phase 17 (U1–U13) merged. What changed since the first draft of
3 November:

- Phase 17 already made expense writes optimistic and fixed B4 (U8), added motion tokens that
  respect reduced motion (U4) and rebuilt every screen. Those parts are gone from PF11.
- The installed Next docs (16.4) now document **passing unawaited promises in SWR's `fallback`**
  (SWR 2.3+ with React 19). That answers the first draft's open question and makes the
  server-data pattern smaller (PF6).
- The Supabase project **still signs JWTs with a shared secret** (its JWKS was empty on
  8 November 2026), so every signed-in request still pays one or two Auth round trips. This is now
  the first decision, because it costs nothing to build.
- Node 24 (the Docker image) already sizes its heap from the container's memory limit. PF12 now
  measures before it sets anything.
- The React Compiler is stable and Next 16 supports it. PF11 tries it and measures the result.
- The first draft waited for L12. PF1 now does its own measuring, so L12 isn't needed first.
- Each choice now cites a source. The sources are listed at the end, numbered like `[S3]`.

## Principles

1. **Measure first and last.** Phase 15 gave the app `request` lines with spans, `web_vital` lines
   from real use and Obsy's container metrics. PF1 turns those into a baseline and budgets, and
   PF13 checks the same numbers again. If a change doesn't move a number in the table, it isn't
   worth its risk.
2. **Real use decides, the lab explains.** The budgets are p75 of real visits, the same percentile
   Google uses for Core Web Vitals [S1]. Lighthouse runs on an emulated slow phone [S14] and is
   only for comparing a branch before and after, because lab numbers differ from what real users
   get [S15].
3. **Fix the biggest wait first.** A cold load of Home today goes: download all the JS → run it →
   `/api/account` (which waits on Auth) → the page's own requests (each also waiting on Auth) →
   paint. That chain of requests is the biggest cost, more than bundle size. Most of this plan
   shortens it: fewer Auth calls (PF4), the session check and data on the server (PF5–PF7), and
   prefetching (PF3, PF8).
4. **Keep the client components and their SWR keys.** Phase 17 just rebuilt and signed off every
   screen. This phase changes where data first comes from, not what screens show.

## Where the app stands (8 November 2026)

| Area | Today | Gap |
| --- | --- | --- |
| Pages | 19 of the 23 pages outside `/dev` are `"use client"`. The other four (Investments, Net worth, Login, OAuth consent) are server components that only wrap a client panel, which loads its own data. Every page loads its data with SWR once its JavaScript has loaded (62 `useSWR` call sites). | First paint is a spinner. Then there's a wait for `/api/account`, then another for the page's own data. |
| App shell | `src/app/(app)/layout.tsx` is a client component. It waits for `/api/account`, then redirects to `/login` on a 401 or to `/change-password` when the account has that flag, and prefetches five routes by hand. `src/app/page.tsx` does the same just to redirect to `/dashboard`. | A signed-out visitor downloads the whole app only to be told to sign in (audit P12). Every cold load waits for one round trip before anything else starts. |
| Auth | The project's JWTs are signed with a shared secret (its JWKS is `{"keys":[]}`), so `getClaims()` has to ask Supabase Auth: once in the proxy (`src/lib/supabase/proxy.ts`), once in `withUser`. | Two Auth round trips per signed-in request before any data [S4]. |
| Loading states | `DataLoading` (`src/components/ui/data-state.tsx`) gives generic skeleton cards and lines, not shapes that match each page. There's no `loading.tsx` anywhere. | Data arriving moves the page (CLS). Next doesn't prefetch dynamic routes that have no `loading.js` [N3], so every tap on a tab waits for the server. |
| Error states | `src/app/(app)/error.tsx`, `src/app/error.tsx` and `src/app/global-error.tsx` exist (L7). `DataError` has a retry. `apiRequest` times out after 15 s. | One boundary for the whole `(app)` group, so an error in Investments replaces the shell. SWR has no `loadingTimeout`. A 401 in the middle of a session only redirects when `/api/account` is the request that got it. |
| SWR | One global `SWRConfig` in `src/components/ui/provider.tsx`: 2 retries, 15 s dedupe, no revalidation on focus. Optimistic writes in to-dos, reminders and expenses (U8). | Account, family, member colours and categories are refetched like any other key. Net-worth valuations wait for the server. |
| Bundles | Builds use webpack (`next build --webpack`). `optimizePackageImports` covers Chakra and Lucide. No `next/dynamic` anywhere. dnd-kit loads with the to-do board, and every sheet loads with its page. Charts are hand-built (no chart library). Fonts already use `next/font`. Chakra v3 styles with Emotion at runtime [S17]. | No one knows the JS size per route, so there's nothing to set a budget against. |
| Server | Every route handler goes through `withUser`, with spans per Supabase call (L4). `get_family()` runs several times per request. The tab search loads every expense and filters in JS (audit P9). Some lists cut rows off without saying so (D7, B11). The AI budget check is already one atomic RPC (S10). | Repeated reads, and lists that can be quietly incomplete. |
| Database | 42 of the 46 `auth.uid()` calls in policies are already wrapped as `(select auth.uid())`, as Supabase recommends [S5]. Nobody has checked the indexes against real query plans. | Unknown until PF1's spans and the performance advisor are read. |
| Runtime | `scripts/deploy.sh` caps the web container at 768 MB and the worker at 256 MB (S12). Node 24. | Nobody has checked what heap limit Node actually picked inside those caps. |
| Delivery | Next gzips responses itself [N7]. Nobody has checked whether the VPS's proxy passes a streamed response through or buffers it [N5]. | If the proxy buffers responses, streaming (PF5–PF7) gives no benefit. |

## Design, and why

### 1. Data starts on the server; SWR stays in charge in the browser

A page becomes a thin server component. It starts the first requests **without awaiting them** and
puts the promises in `<SWRConfig value={{ fallback: { [key]: promise } }}>`. The client component
underneath is unchanged and calls `useSWR(key)` as it does today. Only the component that reads a
key waits for it, and after hydration SWR revalidates and handles mutations as before.

**Why:** this is the pattern the installed Next 16.4 docs give for SWR [N1], and the SPA guide
explains why: starting the request on the server, before the rest of the app renders, avoids
client-side request waterfalls [N2]. It keeps every SWR key, optimistic updater and undo from
phase 17 working as before. The one rule that matters is that the fallback key and the `useSWR` key
must be exactly the same string, or SWR ignores the fallback and fetches again [N1]. So the server
builds keys with the same functions as the client (`src/lib/api/keys.ts`).

The other routes we considered: rewriting pages as server components (a second rebuild of what
phase 17 just signed off, and it would lose SWR's cache and optimistic updates), or Server
Actions instead of the REST routes (the REST routes are the API for MCP and the future native app,
so they stay).

### 2. One loader per resource, used by the route and the page

The data logic in a route file (for example `accountData` in `src/app/api/account/route.ts`) moves
to `src/lib/<feature>/load-*.ts`. The route and the page both call it, so they get the same
permissions and the same response shape, and the SWR fallback is exactly what the browser would
have fetched. The docs suggest the same: the route handler and the fallback call the same function
[N1].

### 3. Stream in sections; the heading never waits for data

Each section of a page that loads its own data gets its own `<Suspense>` boundary, next to the
others. The page heading and the shell sit outside every boundary.

**Why:** the docs explain each Web Vital separately [N4]:
- **TTFB/FCP:** with streaming, the shell is sent at once, so first paint no longer waits on the
  slowest query.
- **LCP:** if the largest element sits inside a boundary, it can't paint until that boundary
  resolves. So headings stay outside.
- **CLS:** each fallback must be the same size as the content that replaces it.
- **INP:** each boundary is hydrated separately, so hydration is split into smaller tasks instead
  of one blocking pass.

The same page warns against extra boundaries: "if there's a Suspense boundary, React might use it."
So add one per data section and no more.

### 4. A `loading.tsx` per section, shaped like the page

**Why, twice over:**
- **Prefetching:** without Cache Components, Next skips prefetching a dynamic route unless it has
  a `loading.js`. With one, it prefetches the layout down to that boundary [N3]. Every page here is
  dynamic (personal data and a CSP nonce), so today a tab tap fetches nothing ahead. Adding
  `loading.tsx` lets the shell and skeleton show the moment you tap.
- **Layout shift:** skeletons that match the content's size keep CLS down [N4], and Nielsen
  Norman Group's research puts skeleton screens on loads longer than about a second, as a stand-in
  for the real layout [S9].

### 5. Every loading state ends

Loading becomes "This is taking longer than usual", with a retry, after 8 s. It becomes an error
with a retry by 15 s at the latest (the client timeout). A 401 from any request sends the user to
sign in.

**Why 8 and 15 seconds:** Nielsen's response-time limits are 0.1 s (feels instant), 1 s (keeps the
train of thought) and 10 s (attention starts to drift) [S8]. The slow message comes before the
10 s limit, and the user is never left with a spinner and no way out. SWR has `loadingTimeout` and
`onLoadingSlow` built in for this.

### 6. Fewer round trips before tuning queries

Two Auth calls per request (PF4) and repeated `get_family()` reads cost more than most slow queries
would. Supabase says `getClaims()` checks asymmetric tokens locally against the JWKS, and only
calls the Auth server for symmetric (shared-secret) projects [S3][S4]. Moving the project to
asymmetric signing keys removes those calls with no code change.

### 7. Indexes only for queries we've measured

Use the slowest `db.*` spans from PF1 and Supabase's own tools: the performance advisor, which uses
`index_advisor` [S6], `pg_stat_statements`, and `explain analyze`. Supabase's RLS guide recommends
indexing the columns that policies filter on and wrapping `auth.uid()` in a `select`; it reports
gains of over 100x on large tables [S5]. An index nobody's query needs only slows down writes.

### 8. No Cache Components, no static prerendering, no change of UI library

- **Cache Components:** turning on `cacheComponents` changes how every route is checked at build
  time [N6], and the extras it unlocks (`"use cache"`, partial prefetching, instant navigation)
  pay off for shared, cacheable data. This app's data is personal, and the CSP nonce makes every
  page dynamic. SWR already holds the browser cache. Revisit with the native apps.
- **Chakra/Emotion:** Chakra v3 keeps Emotion's runtime styling. Chakra says it will move away
  from it gradually [S17]. Swapping UI libraries would mean rebuilding every screen again. PF9
  measures Chakra's share of each route, and if it's large, that becomes its own plan later.

### 9. Production must work after each merge

Merging to `main` deploys to production, so each task leaves the app working on its own. Each
server-data task can be reverted one page at a time.

## Tasks

Same workflow as phases 14, 15 and 17: one task per branch and PR, each in a fresh agent, run one
at a time in the main checkout. Branches are `perf/<id>-<slug>` from `main`. Merge when reviewed
and green. Every task that changes what a page shows is checked in the browser through
`/dev/preview` and at 390 px. **It must look the same as phase 17's signed-off screenshots.**
That's how a change of loading path is checked against a change of look.

### Which agent does each task

The rule from phase 14:
- **opus** where a subtle mistake leaks data, changes how every request behaves, or needs careful
  design across many files;
- **sonnet** for well-specified work in one area with clear tests;
- **haiku** only for mechanical edits that need no judgement.

Effort is `high` unless noted.

| Task | What | Roadmap | Audit | Depends on | Agent | Why that agent |
| --- | --- | --- | --- | --- | --- | --- |
| — | **Decision:** George moves the Supabase project to asymmetric JWT signing keys | 16.5 | P9 | — | George | A project setting: free, and it removes Auth round trips from every request. |
| PF1 | Baseline and budgets: real-use vitals, server p95, JS per route, memory, streaming and compression checks | 16.1 | — | — | **sonnet**, effort medium | Measuring and writing up, plus one small script. |
| PF2 | No endless loading: slow and timeout states, 401 anywhere → sign-in, offline | 16.2 | — | — | **sonnet** | The global SWR config and `data-state.tsx`, with a precise spec. |
| PF3 | Skeletons shaped like each page; `loading.tsx` and `error.tsx` per section | 16.2, 16.6 | P12 (part) | PF2 | **sonnet** | UI primitives and one pair of files per section. |
| PF4 | Fewer round trips: one `getClaims`, request-scoped family, server search, paging helper | 16.5 | P9, D7, B11 | PF1 | **opus** | Changes the auth path and the repositories every route uses; B11 changes what reads return. |
| PF5 | Session gate and account on the server for the `(app)` shell | 16.3 | P12 | PF3, PF4 | **opus** | Turns the layout every page goes through into a server component that decides the sign-in and password-change redirects. A mistake locks users out or shows a page to the wrong person. |
| PF6 | First data on the server for Home, with the loader pattern | 16.3 | — | PF5 | **opus** | Sets the server/client pattern the other pages copy: loaders moved out of routes, keys matched exactly, the viewed member and permissions respected. |
| PF7 | The same for Expenses, To-dos and Reminders | 16.3 | — | PF6 | **sonnet** | Applies PF6's pattern page by page, with its tests as the template. |
| PF8 | Prefetching, waterfalls, longer caching for stable data | 16.3 | — | PF7 | **sonnet** | Navigation and SWR options, measured with the request lines. |
| PF9 | Smaller bundles: dynamic imports, server-only check, a JS budget in CI | 16.4 | — | PF1 | **sonnet** | Splitting by the analyzer's numbers, plus a size-check script. |
| PF10 | SQL: indexes and RLS fixes for measured slow queries | 16.5 | — | PF4 | **sonnet** | A migration of indexes (and, if needed, wrapped `auth.uid()` in policies), each tied to a measured query. No data changes. |
| — | **Checkpoint:** George approves applying PF10's migration live | | | PF10 | George | As in every phase: no migration goes live without his go-ahead. |
| PF11 | Smooth interaction: the rest of the optimistic writes, big lists, a React Compiler trial | 16.6 | — | PF3 | **sonnet** | Small, measured changes, each with a before and after. |
| PF12 | Lean runtime: check the heap limit, `preloadEntriesOnStart`, memory in Obsy | 16.7 | — | PF1 | **sonnet** | Deploy script and config. It touches production, so not haiku. |
| PF13 | Measure and close: PF1's table again, the roadmap updated | — | — | all the above | **sonnet**, effort medium | Running the checks and writing them up. |

**Run order:** PF1 → PF2 → PF3 → PF4 → PF5 → PF6 → PF7 → PF8 → PF9 → PF10 → PF11 → PF12 → PF13.
- PF2 and PF3 don't need PF1's numbers, so they could start first if you want visible changes
  sooner.
- PF4 comes before the server pages because a server-rendered page waits on the same Auth and
  family reads as the API. Cutting them first means PF5–PF7 are measured at their real cost.
- PF10 has the phase's only migration, and it has no functions and no data changes.

**S14** (enforcing the CSP, from about 9 November) doesn't block anything here. But PF5–PF7 add
server-rendered pages, so whichever of S14 and PF5 merges second checks that the nonce still
reaches every inline script.

### PF1: Baseline and budgets

**Files:** new `docs/performance.md`, new `scripts/route-js-size.mjs`, `package.json` (one
script), `docs/logging.md` (link only).

- **Real use, from the logs** (journald keeps 5 days):
  - p75 of LCP, INP, CLS, FCP and TTFB per page from `web_vital` lines, split by `navigationType`
    when there are enough samples. Write the `jq` command into the doc so PF13 runs the same one.
  - p50, p95 and request count per route template from `request` lines, with the three slowest
    spans per route and `dbCalls` per request.
  - The number of `auth.*` spans per signed-in request, the baseline for the JWT decision and PF4.
  - If L12 has merged by then, reuse its numbers; don't measure twice. If not, L12 links to this
    table.
- **Lab runs** for the four target pages (Home, Expenses, To-dos, Reminders), run against
  production with one of the project's seeded test users, never George's own account:
  - Lighthouse's mobile preset (`npx lighthouse@<pinned version>`, default mobile settings), which
    simulates a mid-range phone on a slow 4G link with 4x CPU slowdown [S14].
  - Three runs each, keep the median.
  - Record LCP, TBT, CLS and the depth of the request waterfall (how many requests start only
    after another one finished).
- **JS per route:**
  - Try `npx next analyze` first (the Turbopack analyzer, Next 16.1+ [N8]).
  - If the app doesn't build with Turbopack, add `@next/bundle-analyzer` (pinned) as a dev
    dependency behind `ANALYZE=true` for the webpack build [N8].
  - Either way, `scripts/route-js-size.mjs` reads the webpack build's manifests in `.next/` and
    prints the gzipped first-load JS per app route, as a table and as JSON (`npm run size:routes`).
    PF9 turns it into a CI check.
  - Record Chakra/Emotion's share of the shared chunk.
- **Delivery checks** (these decide whether streaming can help at all):
  - **Streaming through the proxy:** load a page that streams (any `loading.tsx` page once PF3 is
    in, or a test route that flushes twice a second apart) through the production URL with
    `curl -N`, and check that the chunks arrive separately. Next warns that reverse proxies buffer
    by default [N5]. If the proxy buffers, write down the fix for George to apply to the VPS (for
    nginx, `X-Accel-Buffering: no` [N5]).
  - **Compression:** check `Content-Encoding` on an HTML response and a JS chunk [N7].
- **Memory:** the web and worker containers' steady state and peak over a few days, from Obsy.
  Also note the heap limit Node actually picked (PF12 reads it).
- **Budgets, proposed for George to agree** (in the doc, as a table):
  - LCP p75 ≤ 2.5 s, INP p75 ≤ 200 ms and CLS p75 ≤ 0.1 on the four target pages. These are
    Google's "good" thresholds, measured at p75 [S1].
  - TTFB p75 ≤ 0.8 s, web.dev's "good" bar [S2].
  - Server p95 ≤ 300 ms per route. Routes that call the AI or parse a statement are left out and
    listed by name.
  - First-load JS per route at most its baseline, and 20% under it on the four target pages.
  - Web steady-state memory under 60% of its container limit.

**Done when** `docs/performance.md` has the baseline table, the delivery checks' results, the
proposed budgets and the commands that reproduce every number, and George has agreed the budgets
(or changed them) in the PR.

### PF2: No endless loading

**Files:** `src/components/ui/provider.tsx`, `src/components/ui/data-state.tsx` (+ test),
`src/lib/api/client.ts` (+ test), new `src/lib/api/auth-redirect.ts` (+ test),
`src/hooks/use-account.ts`.

- **SWR:**
  - Add `loadingTimeout: 8_000` and `onLoadingSlow`, which marks the key as slow in a small client
    store (`useSlowKeys()` or a context).
  - `DataLoading` takes an optional `slowKey` (or the page passes `slow`). Once slow, it shows
    "This is taking longer than usual." with a Retry button that calls `mutate()`.
  - Keep `errorRetryCount: 2`, but cap the retries so a 5xx shows its error within 15 s of the
    first try. A timeout shows its error at once: the request already waited 15 s, so it isn't
    retried.
  - Why: see Design 5 [S8].
- **401 anywhere:**
  - `onError` sends the browser to `/login?next=<current path>` for any 401.
  - The login page already cleans `next` with `safeNextPath` (`src/lib/http/origin.ts`). Build the
    value with the same rule, so a bad path is never sent.
  - Skip it on `/login`, `/join/*`, `/oauth/consent` and `/change-password`, which handle their
    own 401s.
  - The `(app)` layout's own 401 branch stays until PF5 replaces it.
- **Offline:** when `navigator.onLine` is false, the error says "You're offline" instead of the
  generic message. `src/components/pwa/offline-status.tsx` already knows the state, so reuse it.
- **Check every screen:**
  - List every `useSWR` call (62 today) and the component that shows its states.
  - Each must end in content, an empty state or `DataError` with a retry, never a spinner on its
    own. Fix any that don't.
  - `src/components/family-calendar/subscribe-dialog.tsx` loads in a raw `useEffect` (audit D6).
    Give it the same three states, without converting it to SWR.

**Tests:**
- `DataLoading` turns slow after 8 s (fake timers), and the retry calls `mutate`.
- A 401 from any key redirects once with a safe `next`, and doesn't on the excluded pages.
- A timeout isn't retried.
- In `/dev/preview`, a fixture that never resolves shows the slow state, and one that fails shows
  the error.

**Done when** with the API stopped (or every preview fixture failing), every screen shows an error
with a retry within 15 s, and no screen ever shows a spinner with no end.

### PF3: Skeletons and a boundary per section

**Files:** new `src/components/ui/skeletons.tsx` (+ test), `src/components/ui/data-state.tsx`,
new `loading.tsx` and `error.tsx` in each of
`src/app/(app)/{dashboard,expenses,insights,investments,net-worth,todos,reminders,calendar,settings,more}/`,
`src/components/ui/error-page.tsx`, the page components that render `DataLoading` today.

- **Skeletons shaped like content:**
  - Build them from phase 17's components: `PageHeaderSkeleton`, `MonthCardSkeleton`,
    `ListSkeleton` (rows the height of the ledger and reminder rows), `BoardSkeleton` (to-do
    columns), `CalendarSkeleton` and `InsightsSkeleton`.
  - Each matches its real component's height at the base and `md` breakpoints, so swapping one
    for the other moves nothing [N4]. Check by comparing `getBoundingClientRect()` heights in the
    PR, or with the browser's layout-shift overlay.
  - All of them set `aria-busy` and have a visually hidden label, as `DataLoading` does now.
- **One skeleton per page:** each section's `loading.tsx` builds the page's skeleton, and the
  page's client loading state shows the same one. So the user sees one skeleton, not a skeleton,
  then a spinner, then content.
- **Prefetch check:** in a production build, confirm that a `<Link>` to each section now
  prefetches down to its `loading.tsx` [N3]. In the Network panel, the RSC request should go out
  when the bottom bar appears, and the skeleton should show the instant a tab is tapped.
- **`error.tsx` per section:** uses `ErrorPage` with a retry (`reset`) and a link home, and sends
  the same `client_error` report as `src/app/(app)/error.tsx` (L7). An error in Investments now
  keeps the shell and its navigation.
- **Reduced motion:** the skeleton shimmer stops under `prefers-reduced-motion: reduce`. Use U4's
  motion tokens and `use-reduced-motion`.

**Tests:**
- Each skeleton renders with its label and `aria-busy`.
- A section error keeps the shell mounted (render the layout with a page that throws).
- Reduced motion turns the shimmer off.

**Done when** every section has a `loading.tsx` and an `error.tsx`, each page's client loading
state is that page's skeleton, a tab tap shows the skeleton at once in production, and the swap
from skeleton to content shows no visible shift on the four target pages.

### PF4: Fewer round trips in the app

Closes P9 (its budget item was already closed by S10), D7 and B11.

**Files:** `src/lib/supabase/proxy.ts`, `src/proxy.ts`, `src/lib/http/proxy-matcher.ts`,
`src/lib/supabase/auth.ts`, `src/lib/family/viewed-user.ts`, `src/lib/family/current-member.ts`,
`src/lib/auth/index.ts`, the to-do and calendar repositories,
`src/lib/supabase/repositories/expenses.ts`, `imports.ts`, `investments.ts`, `net-worth.ts`,
`calendar.ts`, `todos.ts`, `reminders.ts`, new `src/lib/supabase/fetch-all-pages.ts` (+ test),
the matching tests and fakes.

- **One `getClaims` per request.** Today the proxy refreshes the session and `withUser` checks it
  again: two Auth round trips while the JWT secret is shared [S4]. Options, in order of
  preference:
  1. George moves the project to asymmetric signing keys (see Decisions). `getClaims` then checks
     the token locally against the cached JWKS, and both calls cost nothing [S3][S4]. Nothing to
     build. Check that the `auth.*` spans disappear from signed-in `request` lines, and update the
     comments in `src/proxy.ts` that explain the shared secret.
  2. Otherwise, skip the proxy's refresh for `/api/*` requests that carry an access token that
     hasn't expired (decoded only, not verified, in the proxy), and let `withUser` verify and
     refresh it. Pages keep the proxy refresh. This changes session handling, so test an expired
     access token with a valid refresh token on both an API call and a page load.

  Build option 2 only if George declines option 1.
- **Request-scoped family:**
  - Call `get_family()` once per request. Keep the result on L2's request context (or a small
    `AsyncLocalStorage` next to the scoped Supabase client), keyed by user id.
  - `getCurrentMember` and the to-do and calendar repositories read it from there. Writes that
    change the family (roles, permissions, members) clear it.
  - React's `cache()` only works while React renders a server component, so it does nothing in a
    route handler (audit P11). Replace the two that don't work in `src/lib/auth/index.ts` and
    `src/lib/family/current-member.ts`, or keep them for the server pages PF5–PF7 add if they help
    there.
- **Search on the server:**
  - The tab ledger search filters with `ilike` (escape `%`, `_` and `\` in the user's text) and
    pages like the other lists, instead of loading every expense and filtering with
    `matchesExpenseSearch` in JS.
  - Results must stay the same: search the same fields with an `or()`, and keep the existing
    search tests passing against the new query.
- **One paging helper (D7):**
  - Move `fetchAllPages` to `src/lib/supabase/fetch-all-pages.ts` and fix its short-read failure.
  - Use it for every list that must be complete: calendar, open to-dos, reminders, and the import
    expense counts.
- **Caps that refuse (B11):**
  - Where a cap is wanted (investment transactions, net-worth items), read `cap + 1` rows and
    answer a clear 409/422 ("This account has more than 5,000 orders; contact …") instead of
    cutting rows off.
  - Order the investment read so the newest rows are never the ones dropped.
- **Measure:** `dbCalls`, `dbMs` and Auth calls per route before and after, from the request
  lines, in the PR.

**Tests:**
- The family is read once per request across two repository calls, and cleared after a family
  write.
- `ilike` escaping.
- Paging over several pages and a short page.
- The cap refusals.
- The session refresh paths, if option 2 is built.

**Done when** no route makes more than one `get_family()` call, or (with option 1) any Auth call,
for a signed-in request; search no longer reads every match; and no list cuts rows off silently.

### PF5: The session gate and the account on the server

Closes P12.

**Files:** `src/app/(app)/layout.tsx` (server), new `src/app/(app)/app-shell-client.tsx`,
new `src/lib/account/load-account.ts` (+ test), `src/app/api/account/route.ts`,
`src/app/page.tsx` (server), `src/lib/supabase/auth.ts` (only if a helper for pages is missing),
`src/components/layout/app-shell.tsx`, layout tests.

- **Read first:**
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md` (its
    caveats on how a layout works with `loading.js`) and `…/loading.md`;
  - `…/02-guides/streaming.md`;
  - `…/02-guides/authentication.md`;
  - `…/02-guides/client-side-data-fetching/swr.md`.
- **`load-account.ts`:** move `accountData` and `accountMembership` out of the route into
  `loadAccount(user)`. The route calls it, and its response doesn't change (the route's snapshot
  and response-shape tests must pass untouched).
- **The layout:**
  - A server component that gets the user the same way `withUser` does (`getAuthenticatedUser`,
    inside `runWithSupabaseClient` with the request's cookie client).
  - No user → `redirect("/login?next=…")`. `mustChangePassword` → `redirect("/change-password")`.
  - Otherwise it renders `AppShellClient` with the account in SWR's `fallback` under
    `ACCOUNT_API_KEY`.
  - The layout has to await the account to decide the redirects, so it loads only the account,
    which every page needs anyway. Data a layout reads at runtime holds up navigation [N3], but a
    layout doesn't re-render on client navigation, so this costs only the first load.
  - The client part keeps everything that needs the browser: the shell, the account notice
    dialog, `useAccount()` revalidation.
  - Drop the hand-written `router.prefetch` list: PF3's `loading.tsx` files make `<Link>`
    prefetch the sections [N3].
- **Same rules as the API:** a kid with `mustChangePassword`, a member removed from a family, a
  deleted account and an expired session each get the same result here as from `/api/account`.
  Test each one.
- **Root page:** `src/app/page.tsx` becomes a server component that redirects to `/dashboard` or
  `/login` with no client JavaScript.
- **CSP:** the nonce from `proxy.ts` must still reach next-themes' script and Next's own inline
  scripts. Check that the browser console shows no violations on a cold load of each section.

**Tests:**
- The layout redirects for no session, for must-change-password and for a kid's first sign-in.
- It renders with the account already in the SWR cache: no `/api/account` request on first render,
  checked with a fetcher that fails if it's called.
- `loadAccount` returns what the route returned before (snapshot).

**Done when** a signed-out visitor to any `(app)` page gets a redirect with no app JavaScript, a
signed-in cold load shows the shell without waiting for `/api/account`, and no route test changed.

### PF6: First data on the server for Home

**Files:** `src/app/(app)/dashboard/page.tsx` (server), new loaders in
`src/lib/{expenses,reminders,todos}/load-*.ts` (+ tests), the API routes they come from,
`src/lib/api/keys.ts` (only to export key builders the server can import),
`src/components/dashboard/home-*.tsx` (only for `suspense: true` if needed).

- **What Home loads:** `MonthCard` (this month and last), `DueReminders`, `RecentExpenses` and
  `FamilyTodos`, each with its own SWR key. Each gets a loader.
- **The page:**
  - A server component that renders the heading and the date outside any boundary (LCP [N4]).
  - It starts the loaders without awaiting them and passes the promises as SWR `fallback`, as the
    docs show [N1].
  - Each block gets its own `<Suspense>` with its PF3 skeleton, so the four blocks stream as they
    arrive and hydrate separately [N4].
- **The SWR spike first:** the docs' example reads a promise fallback with `suspense: true` [N1].
  Find out with a 30-minute spike in `/dev` whether SWR 2.4.1 also waits on a promise fallback
  without `suspense: true`.
  - If it does, the client components don't change.
  - If not, the four Home blocks add `suspense: true`, and their `isLoading` branches become the
    Suspense fallback.

  Write down which it was at the top of the loader file.
- **Keys must match exactly** [N1]:
  - The server builds every key with the same function the client uses (`src/lib/api/keys.ts`).
  - The month and "today" use `APPLICATION_TIMEZONE`, never the server's time zone.
  - A test renders the page and asserts that the client asks for nothing on first render (a
    fetcher that throws if it's called).
- **Permissions:**
  - A block is loaded only if the user would see it (`useCan("expenses", "edit")` and family
    membership have server equivalents in the loaders).
  - A kid without the expenses permission gets no expense loader and no expense data in the HTML.
- **Errors:**
  - A loader that throws must not break the page. Catch it, leave that key out of `fallback`, and
    the client fetches it as before (and shows its own error if it fails again).
  - Log it as `server_prefetch_failed` with the route template, never the data.
- **Document the pattern** at the top of the loader file and in `docs/performance.md`, so PF7
  follows it.

**Tests:**
- Loaders return what the routes returned before (route tests untouched).
- Keys match for a user with and without the expenses permission and with and without a family.
- A kid without the permission gets no expense data.
- A failing loader falls back to fetching in the browser.

**Done when** a cold load of Home shows real numbers in the first HTML (check with
`curl -N -b <test cookie>` or "view source"), no request to those APIs goes out on first render,
Home looks the same as U7's signed-off screenshots, and Home's lab LCP is under 2.5 s.

### PF7: The same for Expenses, To-dos and Reminders

**Files:** for each page, `page.tsx` (server), a `*-client.tsx` with the current body, loaders in
`src/lib/{expenses,todos,reminders}/load-*.ts` (+ tests), and the routes they come from.

- Apply PF6's pattern unchanged:
  - **Expenses:** the month's ledger and totals for the viewed member and the selected tab, read
    from the URL the way `src/lib/expenses/url-state.ts` does. The viewed member follows the same
    permission checks as `resolveViewedUser`.
  - **To-dos:** the open board. The board has optimistic updates in `use-todo-board.ts`, and
    seeding its key must not change them.
  - **Reminders:** the list and the badge count.
- One commit per page, so a problem in one can be reverted on its own.
- Calendar, Insights, Investments, Net worth and Settings stay loaded in the browser in this
  phase. List them in `docs/performance.md` as "next" if PF1's numbers say they're slow too.

**Tests:** as in PF6, for each page.

**Done when** all three pages show their data in the first HTML, make no data request on first
render, look the same as their signed-off screenshots, and meet the LCP budget in the lab.

### PF8: Prefetching, waterfalls and stable data

**Files:** `src/components/layout/nav-item.tsx`, `mobile-tab-bar.tsx`, `src/components/ui/provider.tsx`,
the hooks for stable data (`src/hooks/use-account.ts`, `use-member-colors.ts`, `use-viewing.ts`),
`src/lib/api/invalidate.ts`.

- **Prefetching:**
  - Read `node_modules/next/dist/docs/01-app/02-guides/prefetching.md`.
  - Navigation `Link`s keep their default prefetch. With PF3's `loading.tsx` files, each section's
    shell down to its skeleton is prefetched when the link appears [N3].
  - Check in the production build that the bottom bar and the sidebar do this.
  - No prefetch for settings subpages.
  - `experimental.staleTimes`: leave it at its defaults [N9]. SWR already keeps the data, and the
    page payload behind a client page is small. Change it only if PF1's lab runs show the RSC
    request on a tab tap taking more than 100 ms ([S8]'s "instant" limit).
- **Waterfalls:**
  - From PF1's waterfall depths and the request lines (same user, same second), find requests that
    only start after another one finishes.
  - Fix them by starting the requests together: the server loaders already do this on a first
    load, so this is for client navigation.
  - Add a combined endpoint only where two requests always go together and the request lines show
    it.
- **Stable data cached longer:**
  - Account, family, member colours and categories get `revalidateIfStale: false` through their
    hooks. SWR doesn't treat fallback data as fresh for any length of time; this option is how the
    docs say to stop it refetching on every mount [N1].
  - Every write that changes them already calls `mutate` on their keys. Check each one in
    `invalidate.ts` and the settings sheets, and add any that are missing, with tests.

**Tests:** each write that changes stable data updates its key, and the hooks pass the new options.

**Done when** moving between Home, Expenses, To-dos and Reminders makes no request for account,
family or colours, and the waterfall depth on each target page is at most 2.

### PF9: Smaller bundles

**Files:** the components named below, `scripts/route-js-size.mjs`, new
`docs/performance-budget.json` (or a section in `docs/performance.md` that the script reads),
`.github/workflows/ci.yml`, `next.config.ts` (only if `optimizePackageImports` needs more
packages).

- **Dynamic imports** (`next/dynamic` [N10]):
  - Check each one against the analyzer before and after, and keep only those that save at least
    10 KB gzipped on a target page.
  - Sheets that open on a tap: the quick-add sheet's form, `EditExpenseSheet`, `ExpenseTabDialog`,
    the investment and net-worth sheets, the family sheets. Load each when first opened. If the
    chunk isn't there yet, the button that opens it shows a pending state. Preload the chunk on
    hover, focus or touchstart.
  - The statement import screen and its review step.
  - dnd-kit only if the board can render read-only first without a layout shift. Otherwise leave
    it: the board is the to-dos page's main content.
  - The quick-add `+` stays instant: its sheet is preloaded once the shell is idle, so the first
    tap never waits.
- **Server-only code stays out of the client:** check that `openai`, `unpdf`, `web-push`, `sharp`,
  `fflate` and `@modelcontextprotocol/server` appear in no client chunk (the analyzer's client
  view [N8]). If one does, that's a bug: fix the import, and add `import "server-only"` to the file
  that pulled it in.
- **Dependencies:**
  - List unused ones (`npx knip --dependencies` without adding it, or a manual check) and remove
    only those clearly unused.
  - Leave the full dead-code pass to phase 18.1.
- **Images:**
  - Avatars are already resized to small WebP squares on upload, so no `next/image` optimiser. It
    would run sharp in the web container on every new size [N11].
  - Give `Avatar` an explicit width and height, `loading="lazy"` outside the header, and check the
    avatar response's `Cache-Control`.
- **CI budget:** `npm run size:routes -- --check` fails when a route's first-load JS is more than
  2% over its budget (from PF1), and prints the table. Add it to CI after the build step.

**Tests:**
- The size script's parsing, against a fixture manifest.
- The dynamic sheets still open, focus their first field and close (the existing tests must pass).

**Done when** each target page's first-load JS is within its budget, the CI check runs, and no
server-only package is in a client chunk.

### PF10: SQL: indexes and RLS for the slow queries

**Files:** new migration `supabase/migrations/<timestamp>_performance_indexes.sql`,
`supabase/tests/*.sql` (pgTAP), `docs/performance.md`.

- **Find the slow queries:**
  - PF1's and PF4's slowest `db.*` and `rpc.*` spans.
  - The Supabase performance advisor (`get_advisors` with type performance, read-only), which
    builds on `index_advisor` [S6].
  - The top queries by total time in `pg_stat_statements` [S7].
  - `explain (analyze, buffers)` on the queries behind them, run against a local database seeded
    to a realistic size (a few years of expenses for a family of four), never against the live
    project.
- **RLS:**
  - Wrap the remaining 4 bare `auth.uid()` calls in policies as `(select auth.uid())` where the
    value doesn't depend on the row [S5]. The advisor flags these as `auth_rls_initplan`.
  - Index the non-key columns that policies filter on (`family_id`, `user_id`, `member_id`) where
    `explain` shows a sequential scan [S5].
- **Add only what a slow query uses.** Each index in the migration has a comment naming the query
  it serves, with its `explain` before and after. The advisor's unused-index warnings go in
  `docs/performance.md` for George; drop none in this task.
- **No functions and no data changes**, so the app works the same before and after the migration
  is applied, and the PR can merge before it goes live. If a policy changes, its pgTAP RLS tests
  must pass unchanged.
- **Checks:**
  - A pgTAP test for each index that it exists, plus `npm run test:db`.
  - When applying through MCP, strip `begin;`/`commit;` (as in S10), then check each index in
    `pg_indexes` and each policy in `pg_policies`.
- **Checkpoint:** ask George before the migration goes live.

**Done when** the migration is applied on George's go-ahead and no route's server p95 is over
300 ms in the next few days of request lines (or the ones that are have a reason written in
`docs/performance.md`).

### PF11: Smooth interaction

**Files:** the net-worth valuation sheet and its cache updates, `src/components/expenses/ledger-panel.tsx`
and the list components (only if the profiler says so), `next.config.ts`, `package.json`
(`babel-plugin-react-compiler`, pinned, dev only, if the trial is kept).

- **The optimistic writes that are left:** adding or editing a net-worth valuation. Use SWR's
  `optimisticData` with `rollbackOnError: true` [S11], in the same style as U8's
  `writeOptimistically`. Investment orders stay as they are: the server checks the position, so a
  refused order would flash in and out.
- **Big lists:**
  - Measure the expenses list's INP with a month of 300 expenses in `/dev/preview` (React profiler
    and the browser's INP readout).
  - Find out with the profiler whether rows re-render when they don't need to. Windowing only if a
    month can realistically pass 1,000 rows.
  - Long work in an event handler gets split up, so input isn't blocked [S12].
- **React Compiler trial:**
  - Turn on `reactCompiler` (stable in Next 16 [N12], React Compiler 1.0 [S13]) on a branch.
  - Measure the same interactions (open quick add, type an amount, switch month, drag a to-do) in
    the profiler and in Lighthouse's timespan mode, before and after, plus the build time.
  - Keep it only if the interactions get measurably faster, all tests pass and the build stays
    under +30%. Otherwise record the numbers and drop it.
  - The compiler runs as a Babel plugin, so builds get slower [N12]. The first version can use
    annotation mode on the hot components only.
  - Why try it: React reports fewer re-renders with no hand-written `useMemo`/`useCallback`, and
    says it helps most where a parent re-renders often [S13]. Both are the case on the ledger and
    the board.

**Tests:** an optimistic valuation updates the list at once and rolls back on a 4xx and a 5xx. If
the compiler is kept, the existing component tests pass and `eslint-plugin-react-hooks`'s compiler
rules are on.

**Done when** adding a valuation updates the list at once, INP p75 on the target pages is under
200 ms in the lab, and the compiler decision is recorded with its numbers.

### PF12: Lean runtime on the VPS

**Files:** `scripts/deploy.sh`, `Dockerfile` (only if the start command needs it), `next.config.ts`,
`docs/performance.md`, a note for the vps-apps README (as text in the PR for George to paste).

- **Measure the heap limit first:** in each running container, read
  `node -e "console.log(v8.getHeapStatistics().heap_size_limit / 2**20)"`.
  - Since Node 12, Node sizes its default heap from the container's memory limit (about half of
    it, up to a cap) [S10], so the 768 MB web container may already have a sensible limit.
  - Set an explicit `NODE_OPTIONS=--max-old-space-size=<MB>` only if the measured limit is too high
    for the container (it must leave room for memory outside the heap: buffers, sharp, code), or
    so low that the heap fills up.
  - Work out the MB in `deploy.sh` from `WEB_MEMORY_LIMIT`/`WORKER_MEMORY_LIMIT` (about 60–70%),
    with `WEB_HEAP_MB`/`WORKER_HEAP_MB` as overrides, and validate them like the other inputs.
  - Newer Node versions accept the size as a percentage (nodejs/node#59631). Use it only if
    `node --help` in the image lists it; otherwise use MB.
- **`experimental.preloadEntriesOnStart`** [N11]:
  - Next loads every page's modules at start, so the first request is fast but memory is higher.
    Turning it off saves memory only until every page has been visited [N11].
  - Measure the web container's memory after start and the first request's time, with it on and
    off.
  - Turn it off only if it saves more than 50 MB and the first request after a deploy stays under
    2 s. Record both numbers.
- **Memory in Obsy:** check that Obsy shows the limit next to the memory used, and note in
  `docs/performance.md` what steady state and peak look like after this task.
- **Checks:** `bash -n`, `shellcheck`, and a dry run described in the PR (as S12 and L8 did).

**Done when** the heap limit of both containers is measured and, where needed, set; the preload
decision is recorded with its numbers; and steady-state memory is within PF1's budget.

### PF13: Measure and close

**Files:** `docs/performance.md`, `docs/family-hub-roadmap.md`.

- Run every PF1 measurement again with the same commands, at least 3 days after the last deploy.
  Put the numbers next to the baseline, with the budget and a pass/fail column.
- A short production smoke test, as a checklist with results:
  - a signed-out visit redirects with no app JavaScript;
  - each target page's first HTML has its data;
  - a tab tap shows the skeleton at once;
  - with the API stopped (or blocked in the browser), errors with a retry show within 15 s;
  - an optimistic valuation rolls back when the write is refused;
  - a section error keeps the shell;
  - no CSP violations;
  - no Auth round trips on signed-in requests (if the signing keys moved).
- Anything over budget gets a line saying why, and whether it moves to phase 18 or a later plan.
- Update the roadmap's phase 16 section to "done", linking this plan and `docs/performance.md`, and
  correct its out-of-date starting point (the global `SWRConfig` exists).

**Done when** the comparison table and the checklist are merged, and each budget is met or has a
reason and a place it moves to.

## Decisions for George

| Decision | Recommendation |
| --- | --- |
| **Supabase JWT signing keys** | **Move the project to asymmetric signing keys** (Supabase dashboard → JWT Signing Keys, rotate to an ES256 key; the old shared secret stays valid until existing tokens expire) [S3]. `getClaims` then checks tokens locally [S4]: one or two fewer Auth round trips on every signed-in request and every cold page load, with nothing to build. It's a project setting, so it's yours to change. Best done right after PF1 records the "before". |
| Budgets | As proposed in PF1: LCP 2.5 s, INP 200 ms, CLS 0.1 at p75 [S1]; TTFB 0.8 s [S2]; server p95 300 ms; JS at most the baseline, and 20% under it on the target pages. Agree or change them in PF1's PR. |
| Which pages load on the server | Home, Expenses, To-dos and Reminders (the daily screens). The others stay loaded in the browser unless PF1 shows they're slow. |
| Cache Components (`cacheComponents`, `"use cache"`, partial prefetching) | Not in this phase. Every page is dynamic because of the personal data and the CSP nonce, SWR already caches in the browser, and turning it on changes how every route is checked at build time [N6]. Revisit with the native apps. |
| React Compiler | Try it in PF11 and keep it only if it measurably helps [S13][N12]. It's a dev dependency, and builds get a bit slower. |
| Chakra (runtime CSS-in-JS) | Keep it. PF9 measures its share; if that's large, it becomes its own plan later, not a third rebuild of the screens [S17]. |
| `next/image` for avatars | No. Avatars are already small WebP squares, and the optimiser would run sharp in the web container for no gain. |
| Optimistic investment orders | No. The server checks the position, so a refused order would flash in and out. |
| `preloadEntriesOnStart` and heap caps | Decide from PF12's numbers. |
| Bundle analyzer | `next analyze` if the app builds with Turbopack; otherwise `@next/bundle-analyzer` as a pinned dev dependency, run only when needed [N8]. |
| Field debugging | If a page misses its LCP or INP budget and the logs can't say why, add the `web-vitals` attribution build (about 1.5 KB) to report the LCP element and its subparts, and the slow interaction's script [S15][S16]. Not before. |

## Not in this plan

- **Changing what screens show:** phase 17 is signed off. This phase changes where data first
  comes from, not the screens.
- **Converting the older modules to the API-object-plus-hook style (D6):** phase 18.
- **Money as decimals, one error type, dead code (D1–D4, P11):** phase 18. PF4 only replaces the
  `cache()` calls that don't work in route handlers.
- **A CDN or edge caching.** The app is personal and behind Tailscale, so there's nothing shared to
  cache at the edge.
- **Service-worker caching of API responses** for offline use. Worth its own plan with the native
  apps (phase 9), which need an offline story anyway.
- **Performance work on Obsy.**

## Sources

Next.js docs, from the installed version (16.4.3), under `node_modules/next/dist/docs/01-app/`:

- **[N1]** `02-guides/client-side-data-fetching/swr.md`: server-provided data through SWR
  `fallback` with unawaited promises (SWR 2.3+ and React 19); keys must match exactly;
  `revalidateIfStale: false`.
- **[N2]** `02-guides/single-page-applications.md`: start requests on the server to avoid client
  waterfalls; pass a promise and read it with `use()`.
- **[N3]** `02-guides/prefetching.md`: dynamic routes are prefetched only down to a `loading.js`;
  the prefetch queue. Also `03-api-reference/03-file-conventions/loading.md`.
- **[N4]** `02-guides/streaming.md`, "Streaming and Web Vitals": TTFB/FCP, keeping LCP outside
  boundaries, skeletons the same size as their content, selective hydration for INP, and the
  warning against extra boundaries.
- **[N5]** `02-guides/streaming.md`, "What can affect streaming", and `02-guides/self-hosting.md`,
  "Streaming and Suspense": proxies buffer by default; `X-Accel-Buffering: no`.
- **[N6]** `02-guides/interactive-apps.md`, step 8, and `02-guides/migrating-to-cache-components.md`:
  what turning on Cache Components changes.
- **[N7]** `03-api-reference/05-config/01-next-config-js/compress.md`: gzip by default when
  self-hosting.
- **[N8]** `02-guides/package-bundling.md`: `next analyze` (16.1+), `@next/bundle-analyzer` for
  webpack, `optimizePackageImports`, heavy client work.
- **[N9]** `03-api-reference/05-config/01-next-config-js/staleTimes.md`: the client cache for
  dynamic pages is off by default.
- **[N10]** `02-guides/lazy-loading.md`: `next/dynamic`.
- **[N11]** `02-guides/memory-usage.md`, "Preloading Entries", and `02-guides/self-hosting.md`,
  "Image Optimization".
- **[N12]** `03-api-reference/05-config/01-next-config-js/reactCompiler.md`.

Articles and other official docs:

- **[S1]** web.dev, [How the Core Web Vitals metrics thresholds were defined](https://web.dev/articles/defining-core-web-vitals-thresholds): LCP 2.5 s, INP 200 ms, CLS 0.1, judged at p75.
- **[S2]** web.dev, [Rendering on the Web](https://web.dev/articles/rendering-on-the-web) and [Time to First Byte](https://web.dev/articles/ttfb): server rendering vs. client rendering, hydration cost, TTFB ≤ 0.8 s.
- **[S3]** Supabase, [JWT Signing Keys](https://supabase.com/docs/guides/auth/signing-keys) and [Introducing JWT Signing Keys](https://supabase.com/blog/jwt-signing-keys): rotating to asymmetric keys; public keys from the JWKS endpoint.
- **[S4]** Supabase, [Asymmetric keys support in 2025](https://github.com/orgs/supabase/discussions/29289) and [JSON Web Token (JWT)](https://supabase.com/docs/guides/auth/jwts): `getClaims()` checks asymmetric tokens locally and calls Auth for symmetric ones.
- **[S5]** Supabase, [RLS Performance and Best Practices](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv): wrap `auth.uid()` in `select`, index the columns policies use.
- **[S6]** Supabase, [index_advisor](https://supabase.com/docs/guides/database/extensions/index_advisor) and [Steps to improve query performance with indexes](https://supabase.com/docs/guides/troubleshooting/steps-to-improve-query-performance-with-indexes-q8PoC9).
- **[S7]** Supabase, [pg_stat_statements](https://supabase.com/docs/guides/database/extensions/pg_stat_statements).
- **[S8]** Nielsen Norman Group, [Response Times: The 3 Important Limits](https://www.nngroup.com/articles/response-times-3-important-limits/): 0.1 s, 1 s, 10 s.
- **[S9]** Nielsen Norman Group, [Skeleton Screens 101](https://www.nngroup.com/articles/skeleton-screens/).
- **[S10]** Red Hat Developer, [Node.js 20+ memory management in containers](https://developers.redhat.com/articles/2025/10/10/nodejs-20-memory-management-containers), and Node.js, [Understanding and tuning memory](https://nodejs.org/en/learn/diagnostics/memory/understanding-and-tuning-memory); percentage heap sizes: [nodejs/node#59631](https://github.com/nodejs/node/pull/59631).
- **[S11]** SWR, [Mutation & Revalidation](https://swr.vercel.app/docs/mutation): `optimisticData`, `rollbackOnError`, `populateCache`.
- **[S12]** web.dev, [Optimize Interaction to Next Paint](https://web.dev/articles/optimize-inp) and [The most effective ways to improve Core Web Vitals](https://web.dev/articles/top-cwv).
- **[S13]** React, [React Compiler v1.0](https://react.dev/blog/2025/10/07/react-compiler-1).
- **[S14]** Chrome for Developers, [Lighthouse throttling](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md), and the Web Performance Calendar, [How does Lighthouse simulated throttling work?](https://calendar.perfplanet.com/2021/how-does-lighthouse-simulated-throttling-work/).
- **[S15]** DebugBear, [Why Lighthouse lab data doesn't match field data](https://www.debugbear.com/blog/lighthouse-lab-data-not-matching-field-data), and web.dev, [Debug performance in the field](https://web.dev/articles/debug-performance-in-the-field).
- **[S16]** Chrome for Developers, [LCP breakdown](https://developer.chrome.com/docs/performance/insights/lcp-breakdown): TTFB, load delay, load duration, render delay.
- **[S17]** Chakra UI, [Announcing v3](https://chakra-ui.com/blog/announcing-v3): Emotion's runtime kept for now, framer-motion removed.
