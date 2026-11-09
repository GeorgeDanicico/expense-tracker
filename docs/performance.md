# Performance: what changed and why (phase 16)

This is the review document for phase 16. It's written while the work is done, one section per
task, so you can read it later without the code open. The plan it follows is
[performance-plan.md](performance-plan.md); source numbers like `[N1]` and `[S3]` point to the list
at the end of that plan.

**How to read it.** Start with "Waiting for George" and "Progress". Then each task's section has
the same seven parts:

1. **The problem**, in plain words: what a person using the app saw or waited for.
2. **What changed**: the behaviour first, then the files.
3. **Why this way**: the choice, the options turned down, and the source for it.
4. **Numbers**: before and after, with the command that produced each one.
5. **How to check it yourself**: steps you can do in the app or the terminal in a few minutes.
6. **Risks and how to undo it**: what could go wrong and the PR to revert.
7. **Left open**: anything not done, not measured or waiting on a decision.

A number in this document is either measured (with its command next to it) or marked
**not measured**, with the reason. Nothing here is an estimate presented as a result.

## Waiting for George

Things only you can do or decide. Nothing in this list blocks the tasks that are merged.

| # | What | Why it matters | Where it's explained |
| --- | --- | --- | --- |
| 1 | Move the Supabase project to asymmetric JWT signing keys (dashboard → JWT Signing Keys) | Removes one or two calls to Supabase Auth from every signed-in request, with no code change | Plan, "Decisions for George"; PF4 below |
| 2 | Agree or change the budgets | They decide what "fast enough" means for PF13. I'm using them as working budgets until you change them | "Proposed budgets" under "Baseline and budgets", and PF1 below |
| 3 | On the VPS, run `sudo scripts/perf-report.sh 5 expense-tracker-web` and the two delivery checks (streaming through the proxy, compression), and paste the output into the PR or send it to me | It is the real-use half of the baseline: Web Vitals per page, server time per route, Auth calls per request, whether the proxy streams. I have no access to production, so those cells say "not measured: needs the VPS" | "Real use" and "Delivery checks" under "Baseline and budgets" |

## Progress

| Task | What | Status | PR |
| --- | --- | --- | --- |
| PF1 | Baseline and budgets | in review (stacked on #225, the plan) | #226 |
| PF2 | No endless loading | not started | |
| PF3 | Skeletons and a boundary per section | not started | |
| PF4 | Fewer round trips in the app | not started | |
| PF5 | Session gate and account on the server | not started | |
| PF6 | First data on the server for Home | not started | |
| PF7 | The same for Expenses, To-dos and Reminders | not started | |
| PF8 | Prefetching, waterfalls and stable data | not started | |
| PF9 | Smaller bundles | not started | |
| PF10 | SQL: indexes and RLS for the slow queries | not started | |
| PF11 | Smooth interaction | not started | |
| PF12 | Lean runtime on the VPS | not started | |
| PF13 | Measure and close | not started | |

## The short version

*(Filled in as tasks merge: one line per improvement, with its headline number.)*

- **PF1, baseline and budgets (nothing changes for users yet).** Opening Home today is four waits
  in a row: the page, then 37 script files (385.5 KiB gzipped), then "who am I?" (`/api/account`),
  then the page's own data. Reading the code, a cold Home load makes 13 calls to Supabase Auth
  before any data is read. A signed-out visitor to `/dashboard` still makes 50 requests
  (583 KiB) before reaching the sign-in page. The real-use numbers (Web Vitals, server time per
  route) need the VPS and are waiting for you (row 3 above).

## Baseline and budgets

Written by PF1 on 9 November 2026, on commit `18e1719` plus PF1's own files (it changes no app
code). Every number below is one of three kinds, and says which:

- **measured**: I ran the command next to it;
- **from the code**: counted by reading the code (file and line given), not by running it;
- **not measured: needs the VPS**: it can only come from production, so there's a command for you
  to run (row 3 of "Waiting for George").

All sizes are **gzipped** (what the network carries) unless it says raw. "KiB" is 1,024 bytes.

### How the app loads today

You open Home on your phone. Four waits happen **one after the other**, and nothing is shown
until the last one is done:

1. **The page.** The server answers at once with a small page (14.5 KiB gzipped; 80 KiB
   unzipped). It holds the frame and a loading screen that says "Opening your ledger…". It holds no
   data, because every page is a client component and the layout above them keeps the page
   hidden until it knows who you are.
2. **The code.** The browser downloads and runs 37 script files, 385.5 KiB gzipped for Home.
   244 KiB of that is the same on every page (React, Next, Chakra, Emotion and the `zod` validation
   library). Nothing responds to a tap until it has all run.
3. **"Who am I?"** Only now does the layout ask `GET /api/account`. On the server that request
   first asks Supabase Auth to check your sign-in (twice: once in the proxy and once in the route),
   then reads your profile. Until it answers, the page isn't even drawn.
4. **The data.** When the account arrives, the page and the app shell each start their own
   requests at the same moment (Home: up to five). Each of those asks Supabase Auth to check your
   sign-in **again** (twice again), then reads the database. Each section fills in as its data
   arrives, behind a generic grey placeholder.

A signed-out visitor goes through steps 1 to 3, gets a 401 from `/api/account`, and is only then
redirected to the sign-in page (audit finding P12). The details, with files and lines, are under
"The request waterfall" and "Round trips on the server" below.

The plan's bet is that waits 3 and 4 are the biggest cost, more than the size of the code. This
document can't prove that yet: it has the size of wait 2, the order and count of waits 3 and 4, but
not how long they take for you, because those timings come from production (below).

### Real use: not measured, needs the VPS

I have no access to production (the VPS is behind Tailscale and the logs are in its journal). One
script reads the journal and prints all of this as tables. It's read-only and needs only
`journalctl`, `jq` and standard tools.

```bash
# On the VPS, from a checkout of this branch (or copy the one file). Needs sudo or the systemd-journal group.
sudo scripts/perf-report.sh 5 expense-tracker-web        # days, then the web container's name
```

It prints these sections, and PF13 runs the same command again:

| Number | Result | Section of the script's output |
| --- | --- | --- |
| LCP, INP, CLS, FCP and TTFB at p75, per page (and split by navigation type) | **not measured: needs the VPS** | "Web Vitals: p75 per page", "…by navigation type" |
| p50, p95, count and 5xx per route; the three slowest spans of each; `dbCalls` | **not measured: needs the VPS** | "API requests: latency per route" |
| `auth.*` spans and `get_family` reads per signed-in request | **not measured: needs the VPS** | "Round trips per signed-in request" |
| The slowest Supabase calls by total time (PF10 starts from this) | **not measured: needs the VPS** | "Supabase calls: where the database time goes" |
| Web container memory, steady state and peak; the heap limit Node chose | **not measured: needs the VPS** | Not in the logs. The script prints three read-only commands (`docker inspect`, `docker stats`, `docker exec … node -e`) |

Notes that matter when you read its output:

- **p75** here is "nearest rank": sort the samples, take the one at position ceil(0.75 × n). A p95
  is always a value that really happened. Google judges Core Web Vitals at p75 [S1].
- A `web_vital` line exists only when someone opened the page, so a page nobody visited in five
  days has no row. The journal keeps 5 days (`docs/logging.md`).
- **The proxy's own call to Supabase Auth is not in any `request` line.** The proxy runs before the
  request has a context (`src/lib/supabase/proxy.ts:25`), so only the route's call shows as an
  `auth.user` span. The real number of Auth round trips for a request is the logged one plus one.
- The "slowest spans" column is the p95 of one call of that span (a span the logger merged is
  divided back into per-call time).
- Routes whose spans start with `ai.` or `import.` are marked "exempt" from the 300 ms budget.
- L12 (the logging plan's measuring task) hasn't left numbers in the repo, so this is the first baseline.

**How it's kept from rotting.** `scripts/fixtures/perf-report/sample.jsonl` is a file of 157
lines in the real logger's format, made with the real `logRequest` and `clientEventLine`.
`scripts/perf-report.test.mjs` runs the script on it and checks the numbers against a second
implementation. `src/lib/log/perf-report-fixture.test.ts` checks that every fixture line has exactly
the fields the logger writes today, so renaming a field in the logger fails a test instead of
quietly emptying the report. I checked that second test fails when a field is renamed. The script
passes `bash -n` and `shellcheck`, and its `jq` uses nothing newer than jq 1.6 (tested here on
jq 1.7.1; not on 1.6, which I don't have).

### Delivery checks: not measured, need the VPS

These decide whether streaming (PF5 to PF7) can help at all. Both are read-only apart from the one
temporary server in check 1.

**1. Does the proxy pass a streamed response through? [N5]** Nothing in the app streams slowly
yet, so this uses a throwaway server that sends one line a second. It touches nothing of the app.

```bash
# Terminal 1 on the VPS: a server that sends "chunk 1" … "chunk 5", one per second, on a spare port.
node -e 'require("http").createServer((q,r)=>{r.writeHead(200,{"content-type":"text/plain; charset=utf-8"});let i=0;const t=setInterval(()=>{r.write("chunk "+(++i)+"\n");if(i===5){clearInterval(t);r.end()}},1000)}).listen(3999,"127.0.0.1")'

# Terminal 2: print each line with the time it arrived.
stamp() { while IFS= read -r l; do printf '%s %s\n' "$(date +%T.%3N)" "$l"; done; }
curl -sN http://127.0.0.1:3999/ | stamp          # the control: straight to the server

# Now through the proxy. With Tailscale Serve, publish the spare port on a second HTTPS port:
sudo tailscale serve --bg --https=8443 3999
curl -sN https://<the-app's-.ts.net-name>:8443/ | stamp
sudo tailscale serve --https=8443 off            # remove it again. Do NOT use `serve reset`: it would remove the app's own entry too.
tailscale serve status                           # check the app's entry is still there
```

(Stop terminal 1's server with Ctrl-C.)

- **Good:** both runs print five lines about a second apart (for example `…:00.1`, `…:01.1`,
  `…:02.1`). The proxy streams.
- **Bad:** the proxied run prints all five lines at the same instant, about five seconds in. The proxy
  buffers, and streaming would give no benefit. For nginx the fix is the response header
  `X-Accel-Buffering: no` [N5]. If it's Tailscale Serve, tell me what you see and PF5 will look
  for a fix.
- If the app is behind a different proxy than Tailscale Serve, use whatever publishes the port. The
  test is the same.
- Once PF3 adds a `loading.tsx`, the same `curl -sN … | stamp` on a real page shows the shell
  arriving before the data. Not measurable before that.

**2. Is the response compressed? [N7]** `/login` needs no sign-in.

```bash
HOST=https://<the-app's-.ts.net-name>
# The HTML
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip, br' "$HOST/login" | grep -iE '^(HTTP|content-encoding|content-length|transfer-encoding|vary):'
# A script file the page uses
JS=$(curl -s --compressed "$HOST/login" | grep -o '/_next/static/chunks/[^"]*\.js' | head -1)
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip, br' "$HOST$JS" | grep -iE '^(HTTP|content-encoding|content-length|cache-control):'
# Bytes on the wire with and without compression
curl -s -o /dev/null -w 'compressed:   %{size_download}\n' -H 'Accept-Encoding: gzip, br' "$HOST$JS"
curl -s -o /dev/null -w 'uncompressed: %{size_download}\n' -H 'Accept-Encoding: identity' "$HOST$JS"
```

- **Good:** `content-encoding: gzip` (or `br`) on both, and the compressed size is about a third of the
  uncompressed one or less. The script file also has `cache-control: public, max-age=31536000, immutable`.
- **Bad:** no `content-encoding` header on either, and the two sizes are the same. Then the app
  is sending raw text over the tailnet.

Result at the VPS: **not measured: needs the VPS**. For comparison, I ran check 2 against a local
production build (`next start`, no proxy): the HTML came gzipped, 80,148 bytes down to 14,500
(`Content-Encoding: gzip`), and a script file's wire size was 23,489 bytes, exactly the size of its
gzip, with the `immutable` cache header. So Next compresses on its own [N7]; the question is only
whether the proxy changes that.

### What I measured: the code the browser downloads

**JavaScript per page, first load** (measured). "First load" is every script a page's HTML asks
for. `scripts/route-js-size.mjs` reads it from the webpack build's manifests, so it needs no
browser. I checked its answer against the real HTML (`curl` of `/dashboard`, `/expenses`, `/todos`,
`/reminders`, `/login` from a running `next start`): the script lists are identical, file for
file, and a script's gzip size matches the bytes on the wire.

```bash
npm run build && npm run size:routes              # this table
npm run size:routes -- --json                     # the same as JSON (what PF9 will check against)
```

| Page | Files | Raw (KiB) | Gzip (KiB) | Own to this page (KiB, gzip) |
| --- | ---: | ---: | ---: | ---: |
| `/dashboard` (Home) | 37 | 1237.8 | **385.5** | 141.7 |
| `/expenses` | 40 | 1307.3 | **411.8** | 168.0 |
| `/todos` | 38 | 1288.1 | **402.7** | 158.9 |
| `/reminders` | 37 | 1235.7 | **384.2** | 140.4 |
| `/login` | 19 | 924.9 | 273.1 | 29.3 |
| Shared by all 24 pages | 13 | 844.6 | 243.8 | |

"Own to this page" is what's left after the 13 files every page loads. The other 19 pages are in
the box below. Every page needs at least 243.8 KiB (the shared files) however small it is: the
smallest page, `/offline`, is 246.9 KiB.

<details>
<summary>All 24 pages</summary>

```text
Route                    Files  Raw KiB  Gzip KiB  Own gzip KiB
-----------------------  -----  -------  --------  ------------
/                           16    870.4     253.7           9.9
/_not-found                 13    844.6     243.8           0.0
/calendar                   37   1248.8     387.5         143.7
/change-password            21    999.7     299.6          55.8
/dashboard                  37   1237.8     385.5         141.7
/expenses                   40   1307.3     411.8         168.0
/expenses/import            38   1252.3     390.2         146.4
/insights                   38   1281.0     399.7         155.9
/investments                38   1263.2     395.3         151.5
/join/[code]                23   1010.0     303.9          60.1
/login                      19    924.9     273.1          29.3
/more                       36   1210.4     375.8         132.0
/net-worth                  38   1230.5     382.6         138.8
/oauth/consent              17    887.6     259.7          15.9
/offline                    14    852.5     246.9           3.1
/reminders                  37   1235.7     384.2         140.4
/settings                   37   1234.0     383.6         139.8
/settings/ai                36   1211.6     376.3         132.5
/settings/family            37   1217.5     378.9         135.1
/settings/family/manage     37   1231.9     382.4         138.6
/settings/mcp               37   1226.5     381.5         137.7
/settings/notifications     36   1219.8     378.7         134.9
/settings/permissions       37   1216.8     378.2         134.4
/todos                      38   1288.1     402.7         158.9
```

</details>

Same numbers on three builds (cold cache, warm cache, and a rebuild after the failed Turbopack
build below): the chunk names and sizes are deterministic, so a change in this table is a real change.

**What's in it, and Chakra's share** (measured with Next's Turbopack analyzer; see the box below
for why it's an estimate). The analyzer says which module each byte comes from; the webpack
build, which is what ships, doesn't keep that.

```bash
npx next analyze --output --snapshot pf1                  # 11.2 s; writes .next/diagnostics/analyze
npx next analyze export --snapshot pf1 > graph.jsonl      # one JSON line per module part, with its gzip size
# then add up `compressed_size` of the parts whose `filename` starts with "[client-fs]/_next/static/chunks/"
# and ends in ".js", for `route` == "/dashboard" (or another page), grouped by the package in `source_path`.
```

| Share of the page's client JavaScript | Home | Expenses | To-dos | Reminders | Sign-in |
| --- | ---: | ---: | ---: | ---: | ---: |
| Chakra, its engine (Ark UI, Zag), Emotion, Floating UI | 33.7% | 33.1% | 32.9% | 33.9% | 29.9% |
| Next and React | 39.0% | 37.2% | 38.0% | 39.2% | 50.6% |
| The app's own code | 16.5% | 17.0% | 15.6% | 16.0% | 6.9% |
| `zod` (validation) | 6.3% | 6.0% | 6.1% | 6.3% | 8.3% |
| Biggest other library on that page | lucide-react 9.0 KiB | decimal.js 12.3 KiB | dnd-kit 16.6 KiB | lucide-react 8.6 KiB | |

- **The shared files (243.8 KiB gzip on the real build).** In the Turbopack numbers, the 483 modules
  every page loads are 21.6% Chakra, 2.7% Emotion, 2.2% Chakra's other dependencies, 37.2% Next's
  client runtime, 18.1% React and **9.1% `zod`**. In the webpack build, looking inside the chunks:
  `955-…` (52.5 KiB) is Chakra's components, `172-…` (13.0 KiB) is mostly Emotion, `1902-…`
  (22.9 KiB) is `zod`, and `5897-…` (69.2 KiB) and `4bd1b696-…` (62.6 KiB) are React and Next. So
  **Chakra and Emotion are about a quarter of the shared files (roughly 26 to 27%) and a third of a
  page's JavaScript.** That's the "share" the plan asked PF1 to record; PF9 decides whether it's
  large enough to matter.
- **The biggest app modules** on the four pages are small: `reminder-form.tsx` (3.2 KiB),
  `event-form.tsx` (2.6 KiB), `expense-form.tsx` (1.7 KiB) and `todo-form.tsx` (1.7 KiB) load on
  **every** page, because every page imports the quick-add sheet. On To-dos, `todo-board.tsx` is
  3.1 KiB. These sum to a few KiB. The app's own code isn't the problem; the libraries are.
- **`zod` is in every page, even `/offline`.** The only module there that imports it is
  `src/lib/log/client-report.ts`: the browser's error and Web Vitals reporter checks each event with
  the server's schema. The root layout loads that reporter through `WebVitals`. That's about 23 KiB
  gzipped on every page for a check the server repeats anyway. It's PF9's to look at (see "Left open").

> **Why this is an estimate.** The analyzer is for Turbopack, and the production build uses
> webpack, so its chunk boundaries differ. It sums the gzip of each module on its own, which is
> bigger than gzip over a whole file (it adds up to 536 KiB for Home against 385.5 KiB measured on
> the real build). So read its **shares**, not its sizes. The sizes in the table above come from the
> real build.

**Does the app build with Turbopack? Not yet.** `next analyze` works. A real build does not:

```bash
npx next build        # Next 16's default bundler, Turbopack
# Error: Turbopack build failed with 1 error: ./src/app/favicon.ico  Processing image failed.
#   Format error decoding Ico: The PNG is not in RGBA format!
```

`src/app/favicon.ico` is a 256×256 icon with an RGB (no alpha) PNG inside. Turbopack refuses it and
webpack doesn't. `package.json` passes `--webpack`, and `git log` doesn't say why (it has been there
since the first commit). I didn't try fixing the icon, so I don't know if that's the only
obstacle. Because the app builds with webpack, PF9 won't need `@next/bundle-analyzer` as long as
`next analyze` and `route-js-size.mjs` are enough; I haven't added any dependency.

### What I measured: signed-out lab runs

Lighthouse on a production build running on this laptop, signed out. Lighthouse 13.6.0, default
mobile settings (an emulated Moto G Power, simulated slow 4G at 1.6 Mbit/s and 150 ms, 4× CPU
slowdown [S14]), performance category only, three runs, median.

```bash
npm run build
# The server gets a Supabase URL that goes nowhere, so a lab run can't reach the live project.
SUPABASE_URL=http://127.0.0.1:9 SUPABASE_PUBLISHABLE_KEY=sb_publishable_lab SUPABASE_SECRET_KEY=sb_secret_lab \
  SITE_URL=http://localhost:3107 node node_modules/next/dist/bin/next start -p 3107
CHROME_PATH=<a Chromium or Chrome> npx lighthouse@13.6.0 http://localhost:3107/dashboard \
  --only-categories=performance --output=json --output-path=dashboard-1.json \
  --chrome-flags="--headless=new --no-sandbox" --quiet      # the same for /login; repeat for runs 2 and 3
```

I used the Chromium that Playwright had already downloaded (build 1194). Node 23.4.0 here; the
Docker image has Node 24. The server runs `next start`, not the standalone `server.js` that
production runs, and with no proxy in front, so there is no TLS, HTTP/2 or Tailscale hop.

| | `/login` | `/dashboard`, signed out (ends on `/login`) |
| --- | ---: | ---: |
| FCP and LCP (lab) | 932 ms | 916 ms |
| TBT, total blocking time | 468 ms (runs: 401, 468, 2089) | 268 ms (180, 268, 278) |
| CLS | 0 | 0 |
| Speed Index | 1,324 ms | 1,519 ms |
| Time to interactive | 4,120 ms | 5,172 ms |
| Performance score | 88 | 95 |
| Requests | 28 | **50** |
| Transferred | 412 KiB (scripts 286 KiB) | **583 KiB (scripts 419 KiB)** |
| Server response time | 27 ms | 32 ms |

Read these with three cautions:

- **The lab's LCP is the loading screen, not content.** The server draws "Opening your ledger…" (or
  the sign-in form) immediately, so FCP and LCP are the same early moment. The wait shows up in time
  to interactive and in the requests, not in LCP. For the signed-in pages, LCP will be the real
  content that arrives after the data, which I can't measure (below).
- The first `/login` run had a TBT of 2,089 ms against about 400 ms for the others. Treat TBT as
  noisy. Lighthouse's own TTI is simulated.
- Transferred bytes are what Lighthouse counts, headers included, so they're a little higher than the
  gzip sizes in the table above (273 KiB for `/login`).

**Audit finding P12's "before": what a signed-out visitor to `/dashboard` goes through** (measured).
In order, from the request list of the run (`dashboard-2.json`, no throttling, so times are the
local network and CPU only):

| Step | Request | At |
| --- | --- | ---: |
| 1 | `GET /dashboard`: the page, with "Opening your ledger…" (15.9 KiB) | 1 ms |
| 2 | 37 script files, one stylesheet, two fonts: all asked for by the page, in parallel | 38 to 131 ms |
| 3 | `GET /api/account`: answers **401** (the server spends 12 ms on it; no Auth call without a cookie) | 235 ms |
| 4 | `GET /login?_rsc=…`, then the `/login` page's script (9 KiB) | 252 to 270 ms |

Step 3 only starts after the scripts have run and the layout has mounted. **Under Chrome's own slow-4G
throttling** (`--throttling-method=devtools`, three runs) the same chain was: scripts done 5.7 s,
`/api/account` asked at **6.0 s** and answered at 6.6 s, sign-in page code arrived at **7.8 s**
(runs: 7.83, 7.84, 7.86). That throttling is harsher than the default simulation: it limits each
request, and `next start` on localhost uses HTTP/1.1 with 6 connections, where production is
probably HTTP/2. So take the order and the 38 / 50 request counts as the result, not the 7.8 s.

### What I measured: the request waterfall (from the code)

A **level** below is a step that starts only after the one before it has finished. The depth of a
page is how many levels a cold load goes through. These come from the code, so they're exact for
what the code asks for and say nothing about how long each takes.

Every signed-in page goes through the same first three levels:

| Level | What | Why it can't start earlier |
| --- | --- | --- |
| 0 | The page: `GET /<page>` | |
| 1 | The scripts, one stylesheet and two fonts the page names | They're named in the page |
| 2 | `GET /api/account`: `useAccount()` in `src/app/(app)/layout.tsx:14` → `src/hooks/use-account.ts:17` | The layout is a client component, so it starts after the scripts have run |
| 3 | The page's own requests **and the shell's**, all at once | The layout renders `{children}` and the shell only after the account arrives (`layout.tsx:36–47`) |

The shell asks for two things on every page, in level 3: the reminders badge,
`GET /api/reminders/summary` (`src/components/reminders/use-reminder-badge.ts:41`, used by the
mobile tab bar `mobile-tab-bar.tsx:26` and the sidebar `nav-item.tsx:22`, which share one request),
and, when the family feature is on, `GET /api/account/notices`
(`src/components/family/account-notice-dialog.tsx:65`, mounted at `layout.tsx:47`). The layout
also calls `router.prefetch` for five routes at `layout.tsx:28–32`; with no `loading.tsx` anywhere,
Next skips prefetching dynamic routes [N3], so I expect those to fetch little. I didn't measure it.

**Level 3 and later, for each target page:**

| Page | Level 3: the page's requests | Where | Later levels | Depth |
| --- | --- | --- | --- | ---: |
| **Home** `/dashboard` | `GET /api/dashboard?period=3m&granularity=month&date=YYYY-MM` (one request, shared by "Spent in…" and "Recent expenses") | `home-spending.tsx:32` | none | 4 |
| | `GET /api/reminders` ("Due today") | `use-reminders.ts:35` | | |
| | `GET /api/todos` ("To-dos for you"): only for a user with a family | `use-todo-board.ts:44` | | |
| **Expenses** `/expenses` | `GET /api/expense-tabs` | `expenses/page.tsx:51` | **Level 4:** `GET /api/family`, for the member colours on each row, but only for someone whose picker didn't already ask for it (no `family_finance` view permission). It's requested by `useMemberColors` when the first rows render. | 4, or 5 for that member |
| | `GET /api/expenses?month=YYYY-MM` | `ledger-panel.tsx:75` | | |
| | `GET /api/expenses?month=<the month before>` (the "change from last month") | `ledger-panel.tsx:78` | | |
| | `GET /api/family`, when the member may view the family's finances (it's the member picker) | `viewing-picker.tsx:54` | | |
| **To-dos** `/todos` | `GET /api/todos` (nothing is fetched without a family) | `use-todo-board.ts:44` | none | 4 |
| | `GET /api/family` (for assignee names and colours) | `todo-board-screen.tsx:96` | | |
| **Reminders** `/reminders` | `GET /api/reminders` | `use-reminders.ts:35` | none | 4 |

So a cold load is **depth 4** on all four pages (page, scripts, account, data), and **depth 5** only
for an Expenses user without the family-finance permission. Other things that start a chain: opening
the app at `/` (`src/app/page.tsx`) also asks `/api/account` first, then redirects to `/dashboard`
(one more page request, `router.replace`), and viewing someone else's data (`?member=`) asks
`GET /api/family` first (`use-viewing.ts:46`) and holds the finance requests until it answers.

Requests in level 3 (API calls, a person with a family, the family feature on): Home 5,
Expenses 6 (5 for a member without the family permission, plus `/api/family` a level later), To-dos 4,
Reminders 3. Plus `/api/account` in level 2.

### What I measured: round trips on the server (from the code)

For one signed-in API request, in the order it happens. "Auth" means a call to Supabase Auth, which
today is a network round trip each, because the project signs its JWTs with a shared secret.

| # | What | Where |
| --- | --- | --- |
| 1 | The proxy runs `getClaims()`: **Auth call 1**. It runs for every request the matcher covers, pages included | `src/proxy.ts:38`, `src/lib/supabase/proxy.ts:52` |
| 2 | `withUser` runs `getClaims()` again: **Auth call 2** (the `auth.user` span in the log) | `src/lib/http/route.ts:229` → `src/lib/auth/index.ts:43` → `src/lib/supabase/auth.ts:161` |
| 3 | One read of the caller's `profiles` row, for "must change password". Skipped on `/api/account`, which reads it itself | `route.ts:237`, `src/lib/supabase/repositories/account.ts:37` |
| 4 | Routes with a permission check (`withPermission`): `get_my_membership()`. React's `cache()` wraps it, which the plan says does nothing in a route handler; I didn't verify that | `src/lib/http/permission.ts:46`, `src/lib/family/current-member.ts:13` |
| 5 | The route's own reads | below |
| 6 | After the response: a "last active" write, at most once per user every 5 minutes | `route.ts:234`, `src/lib/family/last-active.ts:10` |

Steps 1 to 4 run **one after the other** before the route's own reads start, so a `withPermission`
route makes four sequential Supabase calls before the first useful byte.

**Per route, own data (no `?member=`):**

| Route | Auth calls | Other calls before the handler | The handler's own calls | `get_family()` |
| --- | ---: | --- | --- | ---: |
| `GET /api/account` | 2 | none (it reads these itself) | 4 in parallel: currency (`profiles`), must-change-password (`profiles`), avatar path (`profiles`) and `get_my_membership()` | 0 |
| `GET /api/dashboard` | 2 | `profiles`, `get_my_membership()` | `get_expense_dashboard` and a recent-expenses read, in parallel (`repositories/expenses.ts:199`) | 0 |
| `GET /api/expenses` | 2 | `profiles`, `get_my_membership()` | 1 query, in pages of 500 rows one after another (`expenses.ts:48,99`) | 0 |
| `GET /api/expense-tabs` | 2 | `profiles`, `get_my_membership()` | 1 read | 0 |
| `GET /api/todos` | 2 | `profiles` | `get_family()` and two `todos` reads, in parallel (`repositories/todos.ts:100`) | **1** |
| `GET /api/reminders` | 2 | `profiles` | two reads in parallel (`repositories/reminders.ts:117`) | 0 |
| `GET /api/reminders/summary` | 2 | `profiles` | 1 read | 0 |

`get_family()` is read for own data only on `/api/todos` (and on the family and calendar routes). It
runs when a request names another member (`?member=`, `viewed-user.ts:66,103`). So the plan's
"`get_family()` runs several times per request" holds for the family-wide views, not for these
pages. The repeated work on the four target pages is the **two Auth calls** and the **`profiles`
reads** (three of them in one `/api/account`).

**A cold Home load, by this arithmetic** (a person with a family, symmetric JWT): the page request
(1 Auth call) plus `/api/account`, `/api/dashboard`, `/api/reminders`, `/api/todos`,
`/api/reminders/summary` and `/api/account/notices` at 2 Auth calls each = **13 Auth round trips**
before the screen is full. Expenses 13 (15 with the family picker's `/api/family`), To-dos 11,
Reminders 9. I counted these; no log says them yet. The logs show the route's half (the
`auth.user` span) and `scripts/perf-report.sh` prints how many there are per request.

**Is the JWKS still empty?** Yes (measured, 9 November 2026, 20:22 UTC):
`curl -s "$SUPABASE_URL/auth/v1/.well-known/jwks.json"` answered `200` with `{"keys":[]}`. So
`getClaims()` still has to ask Auth [S3][S4]. This is row 1 of "Waiting for George".

### What I measured: build facts

| Fact | Result | Command |
| --- | --- | --- |
| Build time (webpack, `npm run build`, this Mac) | 46.5 s with the cache cleared (compile 19.8 s, TypeScript 11.4 s); 42.9 s with it warm | `rm -rf .next/cache && time npm run build` |
| Pages outside `/dev` | 23: **19 are `"use client"`** and 4 are server components (Login, OAuth consent, Investments, Net worth). Every page is dynamic (`ƒ` in the build output); the only static routes are the two generated icons and the manifest | `find src/app -name page.tsx`, and the top of each |
| `useSWR` call sites | 41 | `grep -rnE "\buseSWR(Immutable)?[<(]" src --include='*.ts' --include='*.tsx' \| grep -v "test\.\|import " \| wc -l` (the plan says 62, which counted differently) |
| `next/dynamic` or `React.lazy` | **None.** The only lazy loads are `import()` of the error reporter in `src/instrumentation-client.ts` and of the OpenAI provider on the server | `grep -rn "next/dynamic\|React.lazy\|lazy(" src` |
| Server-only package in a client chunk (`openai`, `unpdf`, `web-push`, `sharp`, `fflate`, `@modelcontextprotocol/server`) | **None.** The analyzer lists no client module from them on any page, and none of their names appear in any file under `.next/static/chunks` | `jq 'select(.filename\|test("client-fs")) \| .source_path' graph.jsonl \| grep -E "node_modules/(openai\|unpdf\|web-push\|sharp\|fflate\|@modelcontextprotocol)/"`; `grep -l unpdf .next/static/chunks/*.js` |
| CSS | 4.5 KiB (one file): the styling is Emotion at runtime, inside the JavaScript | `wc -c .next/static/css/*.css` |

### Proposed budgets

**Proposed by PF1, and used as working budgets until George changes them** (row 2 of "Waiting for
George"). They're the plan's numbers, with the sources, and the "now" column says what's measured.

| Budget | Value | Source | Now |
| --- | --- | --- | --- |
| LCP, p75, on Home, Expenses, To-dos and Reminders | ≤ 2.5 s | Google's "good" threshold, judged at p75 [S1] | not measured: needs the VPS |
| INP, p75, same four pages | ≤ 200 ms | [S1] | not measured: needs the VPS |
| CLS, p75, same four pages | ≤ 0.1 | [S1] | not measured: needs the VPS |
| TTFB, p75 | ≤ 0.8 s | web.dev's "good" bar [S2] | not measured: needs the VPS |
| Server p95 per route | ≤ 300 ms. Left out, by name: `POST /api/imports` (it parses a statement and calls the AI), and any other route that has an `ai.*` or `import.*` span. The report marks them "exempt" | The plan | not measured: needs the VPS |
| First-load JS, every page | at most its baseline in the table above (`npm run size:routes`) | The plan | measured: that table |
| First-load JS, the four target pages | **20% under the baseline:** Home ≤ 308.4 KiB, Expenses ≤ 329.4 KiB, To-dos ≤ 322.2 KiB, Reminders ≤ 307.4 KiB (gzip) | The plan: 20% × 385.5, 411.8, 402.7 and 384.2 | 385.5, 411.8, 402.7, 384.2 KiB |
| Web container memory, steady state | under 60% of its limit: 768 MB (`scripts/deploy.sh:39`) → under about 461 MB | The plan | not measured: needs the VPS |

Two things to know before agreeing them:

- **Meeting the JS budget needs about 77 KiB off Home.** The shared files are 243.8 KiB, and nothing
  per page can go below that. Home's own part is 141.7 KiB. If the 20% target turns out to need
  more than the app's own code can give, the libraries are the lever (Chakra's share, and the
  `zod` in every page). That's a reason to look at the budget again after PF9 measures it, not
  to start with a lower number.
- **The p95 and LCP budgets can't be checked until the report runs on the VPS.** If real use
  turns out far from them, I'd rather change the budget with you than leave a number nobody
  meets. PF13 reports each budget as met, or not met with the reason.

## The tasks

*(One section per task, added by the task's own PR, in the seven-part shape above.)*

### PF1: Baseline and budgets

#### 1. The problem

Nothing a person sees has changed. The problem is on our side: the plan wants to make the app
faster, and until now there was no "before" to compare against. Nobody knew how much JavaScript
each page downloads, in what order a page's requests happen, how many times a request asks
Supabase Auth who you are, or what "fast enough" should mean. Without those, PF2 to PF13 can't show
that a change helped.

#### 2. What changed

**Behaviour: none.** No page, API route or database object is different. What was added:

- `docs/performance.md` (this document): "Baseline and budgets" above, with how the app loads
  today, the measured numbers, the numbers that need the VPS, and the proposed budgets.
- `scripts/route-js-size.mjs` and `npm run size:routes`: the gzipped first-load JavaScript of each
  page, from the webpack build, as a table or as JSON (`--json`). PF9 adds a budget check on
  top of the JSON.
- `scripts/perf-report.sh`: a read-only script George runs on the VPS. It reads the web
  container's journal and prints Web Vitals per page, server time per route, Auth calls per
  request and the slowest Supabase calls, as Markdown tables.
- Tests: `scripts/route-js-size.test.mjs` (17 tests, on a fixture of manifests in
  `scripts/fixtures/route-js-size/`), `scripts/perf-report.test.mjs` (10, runs the script on
  `scripts/fixtures/perf-report/sample.jsonl`) and `src/lib/log/perf-report-fixture.test.ts` (4, keeps
  that fixture in step with the real logger). `vitest.config.ts` now also runs
  `scripts/**/*.test.mjs`.
- `package.json`: the `size:routes` script. `docs/logging.md`: a link to this document.

#### 3. Why this way

- **JS per page from the manifests, not the Turbopack analyzer.** The app ships a webpack build
  (`next build --webpack`), so only its own manifests describe what browsers download. The
  analyzer (`next analyze`, Next 16.1+ [N8]) runs on this app and I used it for what's in the
  bundle, but it models a different bundler, so I use its shares and not its sizes (see the box
  under "What's in it"). `@next/bundle-analyzer` wasn't needed, so there's no new dependency.
- **A page's script list is checked against the real HTML.** The client manifest of a page also
  names other pages' client modules (the root page's shows up in every page's), so counting
  its chunks naively gave one script too many for Home. The script keeps only the page's own
  `page` module and the layouts above it, and I compared the result with the `<script>` tags of
  the five pages I fetched: identical.
- **One script for the VPS rather than a pile of commands.** The plan said to put the `jq`
  command in the document so PF13 can repeat it. One script with the same flags is easier to
  repeat and to test. It has a `--input` mode so a test can feed it a file without a journal.
- **The fixture is made by the real logger**, and a second test compares its fields with what
  the logger writes today. A fixture written by hand would pass forever after the logger changed.
- **Lab runs signed out only, and no preview in the production build.** `.env.local` points at
  the live Supabase project and the repo has no test users, no seed data and no end-to-end
  setup. A `/dev/preview` that works in a production build would give render cost, CLS and
  blocking time with fixture data, but it wouldn't show the chain of waits, which the plan says is
  the biggest cost, and it adds a screen to production builds that must stay off. I left it as a
  proposal (below).
- **Budgets are the plan's, with the source for each.** I didn't invent others. The only
  calculation is the JS budget on the four pages: 20% under today's size.

#### 4. Numbers

There's no "after" for a task that changes nothing. These are the "before" numbers the later tasks
are compared against. Every one has its command, and its details, in "Baseline and budgets".

| Number | Value | Command |
| --- | --- | --- |
| First-load JS, gzip: Home / Expenses / To-dos / Reminders / sign-in | 385.5 / 411.8 / 402.7 / 384.2 / 273.1 KiB | `npm run build && npm run size:routes` |
| Shared by all 24 pages | 13 files, 243.8 KiB | same |
| Chakra, Emotion and their helpers, share of a page's JS | 33% on the four pages (30% on sign-in) | `npx next analyze --output --snapshot pf1`, then `npx next analyze export --snapshot pf1`, added up per package |
| `zod` in every page | about 23 KiB gzip (chunk `1902-…`), 9.1% of the shared modules | same, and the chunk |
| Signed-out visit to `/dashboard` | 50 requests, 583 KiB, 37 scripts before the sign-in page; `/api/account` is asked at 235 ms with no throttling | `npx lighthouse@13.6.0 http://localhost:3107/dashboard --only-categories=performance --output=json …` (full command in "What I measured: signed-out lab runs") |
| Lighthouse, `/login`, three runs, median | FCP and LCP 932 ms, TBT 468 ms, CLS 0, TTI 4,120 ms | same, on `/login` |
| Cold-load waterfall depth, Home / Expenses / To-dos / Reminders | 4 / 4 (5 for one kind of member) / 4 / 4 | from the code, with files and lines |
| Auth calls in a cold Home load | 13 (to-dos 11, reminders 9, expenses 13 or 15) | from the code, with files and lines |
| Sequential Supabase calls before a permission-checked route's own reads | 4 (Auth, Auth, `profiles`, `get_my_membership()`) | from the code |
| Project JWKS | `{"keys":[]}` (still empty) | `curl -s "$SUPABASE_URL/auth/v1/.well-known/jwks.json"` |
| Build time, webpack | 46.5 s cold cache, 42.9 s warm | `rm -rf .next/cache && time npm run build` |
| Web Vitals p75, server p50 and p95, Auth spans per request, memory, streaming, compression | **not measured: needs the VPS** | `sudo scripts/perf-report.sh 5 expense-tracker-web`, and the checks under "Delivery checks" |
| Signed-in lab timings | **not measured** (no safe signed-in target) | see "Left open" |

#### 5. How to check it yourself

1. Read "How the app loads today" and "Proposed budgets" in "Baseline and budgets" (five minutes).
2. In the checkout: `npm run build && npm run size:routes`. The table should match the one above to
   the decimal; if it doesn't, tell me.
3. `npx vitest run scripts src/lib/log/perf-report-fixture.test.ts` runs the 31 tests of this task.
4. Try the report without the VPS: `scripts/perf-report.sh --input scripts/fixtures/perf-report/sample.jsonl`
   prints every table from sample lines (the sample's numbers are made up, only its shape is real).
5. On the VPS, run `sudo scripts/perf-report.sh 5 expense-tracker-web` and the two delivery checks
   (row 3 of "Waiting for George"), and send me the output.
6. Look at the budgets (row 2) and say if any should change.

#### 6. Risks and how to undo it

- **For the app: none.** No runtime file changed. The new script and tests are not imported
  by it. Revert this PR to remove them.
- **The tests need `bash` and `jq`.** The CI runner has both. Where `jq` is missing, the
  perf-report tests are skipped on a developer's machine and **fail on CI** (they check the `CI`
  variable), so a broken runner can't silently stop testing it.
- **`vitest.config.ts` now includes `scripts/**/*.test.mjs`.** If a later script puts a slow test
  there it will run with `npm test`. The three added take about 0.4 s.
- **`route-js-size.mjs` depends on how Next writes its client manifest** (`clientModules` in
  `page_client-reference-manifest.js`). A Next upgrade that changes that makes the script fail or,
  worse, undercount. The comparison with the real HTML is the check to repeat after an upgrade; PF9 can
  turn it into a test.
- **Running `scripts/perf-report.sh` with `sudo` on the VPS** reads the whole journal for one
  container into a temporary file (a few MB) and deletes it on exit.

#### 7. Left open

- **Not measured: needs the VPS.** Every real-use number: Web Vitals per page, server p50/p95 and
  slowest spans per route, Auth spans per request, memory and the heap limit, whether the proxy
  streams, whether it compresses. They're waiting on row 3 of "Waiting for George", and the
  budgets for LCP, INP, CLS, TTFB, server p95 and memory can't be checked until they arrive.
- **Signed-in lab timings: not measured.** The repo has no safe way to sign in: no seeded or test
  users, no `supabase/config.toml` or seed file (the `npm run test:db` Postgres has no Auth
  service), no end-to-end setup, and `.env.local` is the live project. What would make them
  measurable, for you to choose:
  1. **A production-build screen preview** behind a build-time-only flag (for example
     `NEXT_PUBLIC_SCREEN_PREVIEW=1` at `npm run build`, off by default and inlined into the
     bundle so nothing can switch it on at runtime). It would give Lighthouse render cost, CLS
     and blocking time on the real screens with fixture data. It wouldn't show the request waterfall.
     It needs a test that the preview still returns 404 without the flag. PF3 (skeleton CLS) or
     PF11 (interaction) are the tasks that would use it. I did not build it.
  2. **A local Supabase stack with seed users** (`supabase start` with a `config.toml` and a seed file).
     That's the only way to measure a real signed-in cold load, waterfall and Auth calls
     included. It's real work (migrations, seed, a way to sign in from Lighthouse) and nothing in
     this plan has it.
- **Turbopack builds fail on `src/app/favicon.ico`** (RGB PNG inside; see "Does the app build with
  Turbopack?"). Not fixed, and not needed here. If a later task wants Turbopack, that's the
  first obstacle.
- **For PF4:** the proxy and `withUser` both call Auth, and four Supabase calls run in sequence
  before a permission-checked route's own reads. `/api/account` reads `profiles` three times and
  `get_my_membership()` once, in parallel. A month of 500 or more expenses is read in pages one
  after another. The proxy's Auth call isn't in the logs, so the report can show one `auth.user`
  span where a request really made two. When PF4 removes an Auth call it should say which one, or
  log the proxy's.
- **For PF9:** `zod` ships to every page because the browser's error reporter validates with the
  server's schema (about 23 KiB gzipped); every page loads the four create-and-edit sheets
  (reminder, event, expense, to-do forms) even where they're never opened, and there is no
  `next/dynamic` anywhere. `route-js-size.mjs` needs a `--check` mode and a budget file.
- **For PF5:** the signed-out cost above (50 requests, 583 KiB) is the P12 "before".
- **A `perf-report.sh` run on jq 1.6 isn't tested.** The VPS's jq version is unknown; the
  programs avoid features newer than 1.6 but I only had 1.7.1.
- **I measured the build on a Mac with Node 23.4.** CI and the Docker image use Node 24; build time
  there will differ.
