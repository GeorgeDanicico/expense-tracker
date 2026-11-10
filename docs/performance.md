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
| 1 | Move the Supabase project to asymmetric JWT signing keys (dashboard → JWT Signing Keys) | Removes one or two calls to Supabase Auth from every signed-in request, with no code change. Measured in the lab (PF1b): a cold Home load goes from 30 Auth calls to 0. Measured again after PF4, which didn't change the Auth calls: with 40 ms to Supabase the data appears 150 to 254 ms sooner on all four daily pages (Home 1,056 → 906 ms) on the lab's CPU-only pass. PF4 left the code alternative (option 2) unbuilt until you decide | Plan, "Decisions for George"; PF4 below; "Signed-in lab baseline" |
| 2 | Agree or change the budgets | They decide what "fast enough" means for PF13. I'm using them as working budgets until you change them | "Proposed budgets" under "Baseline and budgets", and PF1 below |
| 3 | On the VPS, run `sudo scripts/perf-report.sh 5 expense-tracker-web` and the two delivery checks (streaming through the proxy, compression), and paste the output into the PR or send it to me | It is the real-use half of the baseline: Web Vitals per page, server time per route, Auth calls per request, whether the proxy streams. I have no access to production, so those cells say "not measured: needs the VPS" | "Real use" and "Delivery checks" under "Baseline and budgets" |
| 4 | Check whether "Add a kid" works in production, and decide the fix | The lab found that creating a kid account fails on a database built from the migrations (`permission denied for function my_kid_ai_permitted`, from the AI gate migration's profile trigger). If production has the same grants, nobody can add a kid. It needs a migration, which only goes live with your go-ahead | PF1b, "Left open"; [lab.md](lab.md), "What the lab found while seeding" |
| 5 | Optional: on the VPS, time its round trip to Supabase (one `curl`, read-only) | The lab's "realistic" delay, 40 ms, is from your laptop, not the VPS | [lab.md](lab.md), "The delay" |

## Progress

| Task | What | Status | PR |
| --- | --- | --- | --- |
| PF1 | Baseline and budgets | done, except the VPS numbers (row 3 above); the signed-in lab numbers came with PF1b | #226 |
| PF1b | A local lab: signed-in pages measured without touching live data | done, except the VPS's round trip to Supabase (row 5) | #227 |
| PF2 | No endless loading | done | #228 |
| PF3 | Skeletons and a boundary per section | done, except the cold-load cost found (see PF3 section 7) | #229 |
| PF4 | Fewer round trips in the app | done, except one getClaims per request: waiting on row 1 | #PRNUM |
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
  before any data is read (PF1b measured 30). A signed-out visitor to `/dashboard` still makes 50 requests
  (583 KiB) before reaching the sign-in page. The real-use numbers (Web Vitals, server time per
  route) need the VPS and are waiting for you (row 3 above).
- **PF1b, a local lab (nothing changes for users).** Signed-in pages can now be timed on a laptop
  with a fake family, never touching live data (`npm run lab -- up`). On an emulated phone on slow
  4G, Home's data appears at **7.4 s** (Expenses 8.0 s, To-dos 7.5 s, Reminders 7.4 s); the first
  six of those seconds are the scripts, and nothing the server does starts before them. A cold
  Home load makes **30 calls to Supabase Auth**, not the 13 PF1 counted, because the link
  prefetches each pay one; with asymmetric keys it makes **none**, and with 40 ms to Supabase the
  data appears 0.1 to 0.3 s sooner on a fast network. The lab also found that adding a kid
  probably fails in production (row 4 above).
- **PF2, no endless loading.** A request that never answers used to show the loading skeleton
  for 15 s, an error, then the skeleton again, then the error again: **36 s** before the second
  error, and it kept going. Now the skeleton says "This is taking longer than usual." with a Retry
  at **8 s**, the error comes at **15.3 s**, and a timeout isn't tried again. A session that ends
  while the app is open sends you to `/login?next=<the page you were on>`; before, it bounced
  between `/login` and `/dashboard` and ended on "Checking your session…".

- **PF3, skeletons and a boundary per section.** Home's layout shift drops from **0.207 to 0.012**
  (Lighthouse 0.137 to 0.012): the loading screens are now the same size as the content. Tapping a
  tab shows its skeleton **63 to 74 ms** later; before, nothing changed for as long as the
  server took (5 s watched). Each of the ten sections has its own `loading.tsx` and `error.tsx`.
  The price: a cold load now also downloads about **58 KB** of other sections' scripts, and on the
  emulated phone the data appears **0.1 to 0.4 s later**. PF8 has to schedule that.

- **PF4, fewer round trips.** The data requests behind Expenses, the tabs, Home's month card,
  Investments and Net worth answer **55 to 70 ms sooner** on the server (one wait fewer in a row), a
  saved tab's search **0.71 → 0.23 s** on 3,724 expenses (same results, 172 searches compared), and
  no request reads the family twice. Long lists are now complete or refused with a message: an
  investment account showed only its **oldest 1,000 orders**; now all of them, up to 5,000. Pages
  don't show their data measurably sooner (within the 150 ms noise); asymmetric keys still would,
  by 150 to 254 ms (row 1).

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

The plan's bet is that waits 3 and 4 are the biggest cost, more than the size of the code. PF1
had the size of wait 2 and the order and count of waits 3 and 4. PF1b's lab timed them on a
signed-in cold load ("Signed-in lab baseline" below); how long they take for you on your phone
still comes from production (below).

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
  to interactive and in the requests, not in LCP. For the signed-in pages, see "Signed-in lab
  baseline" below. *(Added by PF1b: in a browser with the throttling applied, the loading screen
  doesn't count as contentful at all, because its "Opening your ledger…" is screen-reader-only
  text over grey boxes; FCP comes only when the shell's text appears. Lighthouse's simulated FCP
  misses that. That is measured for the signed-in pages; I didn't re-run these signed-out ones.)*
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
Reminders 9. *(PF1b measured 30, 29, 26 and 22: this count leaves out the link prefetches and the
browser's report; see "Measured beats read" under "Signed-in lab baseline".)* I counted these; no
log says them yet. The logs show the route's half (the
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

### Signed-in lab baseline

Written by PF1b on 10 November 2026, on `main` at `34a138d` (the app code is exactly `main`'s; only
the lab's own files are added). Every number here comes from the **lab**: a throwaway copy of the
backend on George's laptop, with a fake family. **None of it is a production number.** How to
start it and what's in it: [lab.md](lab.md).

**How the lab works, in plain words.** Docker runs a local Supabase (Postgres, Auth, PostgREST and
the gateway, plus Storage, which only the schema needs), with the schema replayed exactly as
`npm run test:db` does. A script fills it with The Example Family: a parent (Alex), a second
adult (Sam), a kid with limited permissions (Robin) and someone with no family (Casey), with three
years of expenses (6,640; about 290 a month lately), a to-do board, reminders due and overdue
today, calendar events, investments and net worth. The app's real production build runs against
it on port 3110. A small proxy between the app and Supabase can add a delay to each call and
writes down every call, so the lab can count Auth calls, including the ones no log line shows. A
measuring script signs in as one of the family through the app's own sign-in route, loads a page
cold in a fresh browser, and writes down what happened.

**What it can tell you that production can't, and what it can't.**

| The lab can | The lab can't |
| --- | --- |
| Time a signed-in cold load in a real browser, the same way every time, before and after a change | Say what real phones on real networks get: that's the production logs (`scripts/perf-report.sh`, row 3 of "Waiting for George") |
| Count every call to Supabase and to Auth per page load, including the proxy's own | Include Supabase's real latency and load: the delay is a fixed lower bound, and the local database is small and idle |
| Switch the JWT mode and the delay, to show what each costs | Include the VPS (its CPU, Node 24, the standalone server) or the proxy in front of it (TLS, HTTP/2, Tailscale) |
| Show whether the first HTML has the page's data | Measure taps (INP) |

#### How to read the numbers

Each page is loaded cold (a new browser profile, a new sign-in) after one unmeasured warm-up load,
three times, and the table gives the **median** with **± half the spread** of the three runs.
Two kinds of number:

- **Observed**: Chromium with a phone's screen and Lighthouse's own "devtools" throttling applied
  for real (562.5 ms added to every request, 1.44 Mbit/s down, CPU 4× slower). This is what a
  person would have seen on that emulated phone.
- **Lighthouse**: 13.6.0, default mobile preset, the same as PF1: **simulated** throttling. It loads
  the page without throttling and computes what an emulated Moto G Power on slow 4G (150 ms round
  trip, 1.6 Mbit/s, 4× CPU [S14]) would see.

The terms:

- **Content visible**: the first frame in which one of the page's own data strings is on the page
  with a size and outside any loading placeholder. The strings are read from the same API the page
  calls: Home, the "Spent in November" card (it's only drawn once its data arrives) or a reminder's
  title; Expenses, the description of one of this month's expenses; To-dos, an open card's title;
  Reminders, a reminder's title. This is the number that says "you can see your data".
- **First paint**: the first frame with anything drawn, here the grey skeleton boxes of the
  loading screen.
- **FCP**, first contentful paint: the first frame with text or an image. **LCP**, largest
  contentful paint: the moment the biggest text or image on screen appears; the table says which
  element it was.
- **TBT**, total blocking time: how long, in total, the page's own code kept the browser too busy
  to answer a tap (the part of each long task over 50 ms). **TTI**, time to interactive: when the
  page went quiet (no long task and at most two requests for five seconds).
- **CLS**, cumulative layout shift: how much the page jumps while it loads (0 is none; 0.1 is
  Google's "good" limit [S1]).
- **Depth**: how many waits in a row a load goes through, as in PF1's waterfall: the page is
  level 0, the scripts it names level 1, and a request is one level below the request it waited
  for. Measured from the browser's own record of who asked for each request.
- **Auth calls**: requests that reached Supabase Auth during the load, counted at the delay proxy.

**Two things about these tools that change how to read every number below** (measured):

- **Lighthouse's FCP is wrong for these pages.** It says about 0.92 s on every page; in the
  throttled browser the first contentful paint comes at 6.8 to 7.1 s. The loading screen is grey
  boxes plus "Opening your ledger…" as screen-reader-only text, and neither counts as contentful,
  so the first real paint of text is the shell, after `/api/account` answers. The boxes themselves
  are on screen at about 1.4 s ("first paint"). Lighthouse estimates FCP from the resources that
  block rendering, and the app's scripts are async, so its estimate leaves out the whole wait.
  Its own unthrottled trace agrees with the browser: first paint 136 ms, FCP 486 ms, after the
  scripts and the account (`lighthouse-*.json`, `metrics` audit). PF1's signed-out FCP is
  probably wrong the same way; I didn't re-run it.
- **With the slow-4G throttling applied, the server's time is invisible.** Chrome holds every
  response until 562.5 ms after its request was sent, so a server that answers in 20 ms and one
  that answers in 200 ms look the same. On the mobile pass, adding 40 ms to every Supabase call
  tripled the server time per route and moved "content visible" by less than the noise; so did
  switching to asymmetric keys, which removes every Auth call. That's why there's a second pass,
  **CPU only**: the phone's screen and 4× slower CPU, no network throttling. It's the one to watch
  for PF4 to PF8, the tasks that cut server work and round trips. Lighthouse is no better: its
  simulation also barely moved (Home's LCP 5,523 ms at 0 ms and 5,540 ms at 40 ms).

**Noise.** The three runs of one page were within 20 to 160 ms of each other on the mobile pass.
The whole shared/0 ms sweep was run twice, an hour apart; the two medians of the same page differed
by 10 to 86 ms for "content visible" and by up to 124 ms for Lighthouse's LCP (table below). So
**treat a difference under 100 ms between two observed medians, or under 150 ms between two
Lighthouse LCP medians, as noise.** Lighthouse's TBT on Expenses is much noisier (1,010 ms, then
1,449 ms), and its LCP sometimes lands on a much earlier estimate in one run of three (918 ms
against about 5,500 ms on Reminders): read its medians, never a single run.

#### Measured beats read: what PF1 got wrong from the code

PF1 counted these by reading the code. The lab measured them; where they differ, the lab's number
is the one to use.

| | PF1 (from the code) | Measured in the lab | Right? |
| --- | --- | --- | --- |
| **Auth calls in a cold load**, shared secret | Home 13, Expenses 13 (15 with the family picker), To-dos 11, Reminders 9 | **Home 30, Expenses 29, To-dos 26, Reminders 22** | **No: about twice as many.** PF1 missed two things: the page's link prefetches (12 to 16 `?_rsc=` requests per cold load, each passing the proxy's `getClaims()`, so one Auth call each), and the browser's Web Vitals report (`POST /api/client-log`, one more). PF1 expected the prefetches "to fetch little" with no `loading.tsx`; on Home they are 16 requests: eight routes (four of the five the layout prefetches by hand, `layout.tsx:28–32`, and four navigation links), each asked twice. The rest matches PF1's count: 1 for the page, 2 per API request |
| Auth calls with asymmetric keys | 0 (the plan's claim [S3][S4]) | **0 on every page** | Yes. And the Supabase calls per Home load drop from 49 to 19 |
| The proxy's Auth call shows in no `request` line | yes | yes: each API request logs one `auth.*` span and makes two Auth calls | Yes |
| Waterfall depth | 4 on all four pages; 5 on Expenses for a member without the family-finance permission | 4, 4, 4, 4; **5 for the kid on Expenses** (`/api/family` starts after the expense rows arrive) | Yes |
| Requests in level 3 (after `/api/account`) | Home 5, Expenses 6, To-dos 4, Reminders 3 | the same | Yes |
| `get_family()` per cold load | Home 1 (`/api/todos`), Expenses 1 (`/api/family`), To-dos 2, Reminders 0 | the same, at the proxy and in the request lines | Yes |
| `dbCalls` in a `request` line | Supabase calls the route made | It **includes the route's Auth call**: every route logs one more `dbCalls` with the shared secret than with asymmetric keys (Home's `/api/dashboard`: 5 and 4) | Worth knowing for `scripts/perf-report.sh` and PF4: `dbCalls` isn't only database calls |
| The first HTML has no data | yes (every page is a client component) | no data on any page (each page's HTML is about 80 KB, the loading screen) | Yes |

#### The baseline: like production today (shared secret), slow 4G, as the parent

Median of three runs, ± half the spread. Shared-secret JWT and no added delay; the 40 ms numbers
are within the noise of these on this pass (next table).

| | Home | Expenses | To-dos | Reminders | Expenses, as the kid |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Content visible** (observed) | **7,387 ±36** | **7,990 ±17** | **7,528 ±22** | **7,366 ±32** | **7,656 ±60** |
| First paint: the skeleton (observed) | 1,400 ±4 | 1,404 ±2 | 1,396 ±8 | 1,392 ±2 | 1,388 ±8 |
| FCP (observed) | 6,800 ±14 | 7,064 ±8 | 6,836 ±2 | 6,760 ±24 | 7,032 ±52 |
| LCP (observed) | 7,448 ±52 | 8,136 ±12 | 7,604 ±22 | 7,324 ±58 | 7,732 ±52 |
| What the LCP element was | the month's total, "RON 20,458.32" (data) | "· 26% more than October so far" (data) | the subtitle "Shared by everyone in The Example Family" (**not** the cards) | the subtitle "Only you can see your reminders." (**not** the list) | "· 12% less than October so far" (data) |
| CLS (observed) | **0.156** (0.207 in other runs) | 0.009 | 0 | 0 | 0 |
| TBT / time to interactive (observed) | 2 / 7,437 | 720 / 8,623 | 120 / 7,568 | 39 / 7,385 | 64 / 7,757 |
| Lighthouse FCP (not trustworthy, above) | 915 ±1 | 919 ±7 | 915 ±2 | 918 ±4 | 914 ±2 |
| **Lighthouse LCP** | **5,523 ±4** | **5,953 ±92** | **5,674 ±12** | **5,518** (runs 918, 5,552, 5,518) | **5,677 ±9** |
| Lighthouse TBT | 357 ±22 | 1,010 ±384 | 279 ±20 | 315 ±11 | 441 ±40 |
| Lighthouse time to interactive | 5,682 ±4 | 6,079 ±45 | 5,757 ±12 | 5,595 ±74 | 5,836 ±12 |
| Lighthouse CLS | 0.137 | 0.009 | 0 | 0 | 0 |
| Lighthouse score (runs) | 66, 67, 68 | 61, 52, 56 | 73, 72, 73 | 93, 73, 72 | 68, 68, 70 |
| JS on the wire, KiB (observed = Lighthouse) | 409.6 (37 files) | 437.8 (40) | 427.4 (38) | 408.3 (37) | 437.8 (40) |
| Data in the first HTML | no | no | no | no | no |

```bash
npm run lab -- up && npm run lab:baseline     # the whole matrix, both passes, about 80 minutes
# one cell's worth, any time the lab is up:
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3
npm run lab:measure -- /expenses --user kid --runs 3
```

How a cold Home load goes, from the median run (ms after the tap; observed, slow 4G): the HTML
arrives at 658 and the skeleton is on screen at 1,400; the 37 script files load from 602 to 5,729;
`/api/account` runs from 5,991 to 6,572; the shell's text appears (FCP) at 6,800; the five data
requests run together from 6,709 to 7,424; the data is on screen at 7,387. **Nothing the server
does starts before 6 seconds**: the wait is the scripts, then two round trips in a row.

JS on the wire is a little more than PF1's `size:routes` (Home 409.6 against 385.5 KiB): the same
37 files, but counted with their HTTP headers, and on `main` after #221. I didn't compare them
file by file.

#### What the JWT mode and the delay change

"Content visible", median of three, ms. **Mobile** is the slow-4G pass above; **CPU only** is the
second pass (the phone's CPU, no network throttling), where the server's time shows.

| Page | Pass | Shared, 0 ms | Shared, 40 ms (like production) | Asymmetric, 0 ms | Asymmetric, 40 ms | Shared, 0 ms again |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Home | mobile | 7,387 | 7,374 | 7,379 | 7,379 | 7,351 |
| | **CPU only** | 1,100 | **1,356** | 1,110 | **1,130** | 1,093 |
| Expenses | mobile | 7,990 | 7,974 | 7,994 | 8,039 | 8,000 |
| | **CPU only** | 1,596 | **2,005** | 1,530 | **1,681** | 1,691 |
| To-dos | mobile | 7,528 | 7,537 | 7,521 | 7,518 | 7,559 |
| | **CPU only** | 1,187 | **1,419** | 1,189 | **1,195** | 1,200 |
| Reminders | mobile | 7,366 | 7,433 | 7,408 | 7,397 | 7,452 |
| | **CPU only** | 1,140 | **1,345** | 1,137 | **1,248** | 1,149 |
| Expenses, as the kid | mobile | 7,656 | 7,623 | 7,668 | 7,743 | |
| | **CPU only** | 1,290 | **1,590** | 1,245 | **1,356** | |

```bash
npm run lab -- jwt shared|asymmetric      # switch, then
npm run lab -- delay 0|40                 # and measure, e.g.
npm run lab:measure -- /dashboard --runs 3                                  # mobile pass, with Lighthouse
npm run lab:measure -- /dashboard --runs 3 --throttle cpu --no-lighthouse   # CPU-only pass
```

What it says:

- **With 40 ms to Supabase, asymmetric keys make data appear 97 to 324 ms sooner** on the CPU-only
  pass (Home 226, Expenses 324, To-dos 224, Reminders 97, the kid's Expenses 234). Reminders' 97 is
  inside the noise; the others aren't. With no delay the mode makes no difference, as expected:
  a local Auth call costs almost nothing.
- **The 40 ms delay costs 205 to 409 ms per page with the shared secret, and 6 to 151 ms with
  asymmetric keys.** That's the price of the round trips in a row: each request waits for Auth in
  the proxy, Auth again in the route, the profile, sometimes the membership, then its own reads.
- **On slow 4G none of this shows**, for the reason above. A real phone's network doesn't hold
  every response for 562 ms the way the emulation does, so the CPU-only pass is the better guide
  to what server work costs; the mobile pass is the better guide to what the scripts cost.
- CPU-only noise: the same sweep twice, medians 7 to 95 ms apart, runs up to 250 ms apart on
  Expenses. **Treat a difference under 150 ms on the CPU-only pass as noise.**

#### Requests and server, per cold load

Shared secret (like production), parent; the kid's Expenses in the last column. From the delay
proxy's call log and the app's own `request` lines, same commands as above.

| | Home | Expenses | To-dos | Reminders | Expenses, kid |
| --- | ---: | ---: | ---: | ---: | ---: |
| Waterfall depth | 4 | 4 | 4 | 4 | **5** |
| API requests (`/api/*`, browser reports left out) | 6 | 7 | 5 | 4 | 7 |
| Link prefetches (`?_rsc=`) | 16 | 13 | 14 | 12 | 13 |
| Calls to Supabase, all | 49 | 48 | 40 | 33 | 48 |
| **Calls to Supabase Auth** | **30** | **29** | **26** | **22** | **29** |
| of which in a `request` line (`auth.*` spans) | 6 | 7 | 5 | 4 | 7 |
| … with asymmetric keys | 0 | 0 | 0 | 0 | 0 |
| `dbCalls` in the request lines | 25 | 26 | 19 | 15 | 26 |
| `get_family()` | 1 | 1 | 2 | 0 | 1 |

**Server time per route** (the `ms` of its `request` line, median over the runs, ms). It doesn't
include the proxy's own Auth call, which happens before the route starts.

| Route | Shared, 0 ms | Shared, 40 ms | Asymmetric, 40 ms |
| --- | ---: | ---: | ---: |
| `GET /api/account` | 48 | 107 | 67 |
| `GET /api/dashboard` | 65 | 199 | 154 |
| `GET /api/reminders` | 40 | 152 | 102 |
| `GET /api/todos` | 54 | 152 | 99 |
| `GET /api/reminders/summary` | 34 | 152 | 102 |
| `GET /api/account/notices` | 11 | 143 | 96 |
| `GET /api/expenses` (×2 per load) | 31 | 197 | 154 |
| `GET /api/expense-tabs` | 14 | 194 | 144 |
| `GET /api/family` | 30 | 146 | 110 |

(Home's routes from the Home loads, the last three from the Expenses loads; mobile pass.) At
40 ms, `/api/dashboard` spends about 200 ms: five sequential 40 ms waits (Auth, profile,
membership, then its two reads in parallel), which is the PF4 picture exactly.

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
| Auth calls in a cold Home load | 13 (to-dos 11, reminders 9, expenses 13 or 15). **Measured by PF1b: 30** (to-dos 26, reminders 22, expenses 29); the code count missed the link prefetches and the browser's report | from the code, with files and lines; PF1b: `npm run lab:measure` |
| Sequential Supabase calls before a permission-checked route's own reads | 4 (Auth, Auth, `profiles`, `get_my_membership()`) | from the code |
| Project JWKS | `{"keys":[]}` (still empty) | `curl -s "$SUPABASE_URL/auth/v1/.well-known/jwks.json"` |
| Build time, webpack | 46.5 s cold cache, 42.9 s warm | `rm -rf .next/cache && time npm run build` |
| Web Vitals p75, server p50 and p95, Auth spans per request, memory, streaming, compression | **not measured: needs the VPS** | `sudo scripts/perf-report.sh 5 expense-tracker-web`, and the checks under "Delivery checks" |
| Signed-in lab timings | measured by PF1b: see "Signed-in lab baseline" | `npm run lab:baseline` |

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
- **Signed-in lab timings: done by PF1b.** PF1 had no safe way to sign in (no seed users, no
  local Auth, `.env.local` is the live project) and proposed two ways out. PF1b built the second,
  a local Supabase stack with seed users; the numbers are in "Signed-in lab baseline". The first,
  a screen preview in the production build, wasn't built.
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

### PF1b: A local lab: signed-in pages measured without touching live data

#### 1. The problem

PF1 could time only the sign-in page. Every page you actually use needs you signed in, and the
only Supabase project with users is the live one, which nobody may sign in to or write to for a
test. So nobody knew how long Home, Expenses, To-dos or Reminders take to show your data, how many
times one page load asks Supabase Auth who you are, or whether PF1's reading of the code was right.
Without that, PF2 to PF13 couldn't show that a change made a signed-in page faster.

#### 2. What changed

**Behaviour of the app: none.** No app file, route, migration or setting changed. What was added
is a lab you start on your own laptop:

- `npm run lab -- up` starts a local Supabase (Postgres, Auth, PostgREST, the gateway and Storage)
  in Docker, replays the schema exactly as `npm run test:db` does, builds the app's production
  build in a copy of the checkout with no `.env` file, starts it on port 3110 and seeds a fake
  family. `status`, `app`, `jwt shared|asymmetric`, `delay <ms>`, `stop-app` and `down` do what
  they say. `down` removes every container, volume and file it made.
- `npm run lab:measure -- <page> --user parent|adult|kid|solo` signs in as a seed user and times
  the page: on an emulated phone on slow 4G with Lighthouse too (the default), or with
  `--throttle cpu` on the phone's CPU only. `npm run lab:baseline` runs the whole baseline matrix
  (both JWT modes, 0 and 40 ms, both passes, then the first combination again for the noise).
- Files: `scripts/lab.sh`; in `scripts/lab/`: `guard.mjs` (refuses anything that isn't on this
  machine), `seed.mjs`, `supabase-proxy.mjs` (the delay and the call log), `measure.mjs`,
  `report.mjs`, `baseline.sh`, `supabase-config.toml` and `lab.test.mjs` (42 tests);
  `docs/lab.md`; `package.json` (three scripts); `.gitignore` (`/.lab/`).

#### 3. Why this way

- **A local Supabase, not a test user on the live project.** The rules forbid signing in to or
  writing to the live project, and a lab you can throw away can also do what production can't:
  switch the JWT mode, add a delay, count every call to Auth.
- **The schema the same way as `npm run test:db`** (legacy bootstrap, then the migrations
  unchanged), so the lab's database is the one the SQL tests already trust. The CLI's own migration
  and seed steps are off.
- **The config is not at `supabase/config.toml`.** That's the file every `supabase` command run in
  the repo reads, and `supabase config push` would send the lab's localhost settings to the hosted
  project. It lives at `scripts/lab/supabase-config.toml`, the CLI runs in `.lab/cli`, and so the
  CLI also stops rewriting the tracked `supabase/.temp/cli-latest`.
- **Both JWT modes from one stack.** The CLI's Auth signs with an ES256 key; `lab.sh jwt shared`
  re-creates the Auth container without that key, so it signs with the shared secret and its JWKS
  is empty, like production today. `lab.sh` checks the JWKS key count after every switch and
  stops if it's wrong.
- **The delay as a proxy, not Docker network shaping.** A small Node proxy between the app and
  Supabase adds the delay per call and logs each call (never a header, query string or body).
  That log is the only place the proxy's own `getClaims()` call shows; PF1 found no app log line
  has it. Shaping Docker's network on a Mac would need privileges and would also slow the browser.
- **40 ms, measured.** The median of 20 requests on one connection from this laptop to the live
  project's public JWKS endpoint (read-only, no key). It's from this laptop, not the VPS; the
  command for the VPS is in `docs/lab.md`.
- **Two browsers per run.** Lighthouse 13.6.0's default mobile preset gives the headline numbers
  PF1 used, but its throttling is *simulated*: it loads the page unthrottled and computes what a
  slow phone would see. For these pages that gets FCP wrong (below). So each run also loads the
  page in Chromium with the same phone throttling *applied* (Lighthouse's own "devtools" values),
  which shows what really happened: when the data appeared, every request, the waterfall.
- **A second, CPU-only pass**, added after the first sweep showed that the applied slow-4G
  throttling hides the server: Chrome holds each response until 562.5 ms after the request, so 40
  ms more per Supabase call, or no Auth calls at all, moved nothing. Without it the lab couldn't
  show PF4's or the JWT switch's effect.
- **Signing in through the app's own `POST /api/auth`**, the route the sign-in form calls, and
  giving a fresh browser profile exactly the cookies it set. Lighthouse gets the same cookies as a
  header. Every run signs in again, so no run reuses another's session.
- **The seed through the app's own API routes** wherever the volume allows, so the data is what
  the app would have written. The expenses (6,640) go straight into the table as their owner,
  because the API allows 120 writes a minute.
- **Turned down:** a screen preview with fixture data in the production build (PF1's option 1: no
  waterfall, no Auth calls, and a screen to keep off in production); Playwright as a dependency
  (the DevTools protocol over Node's own `WebSocket` is enough, and the plan allows no new
  dependency here).

#### 4. Numbers

There's no "after" for a task that changes no app code. These are the signed-in "before" numbers
PF2 to PF13 compare against; the full tables, and how to read them, are in "Signed-in lab
baseline" above. All are from the lab on George's laptop, 10 November 2026, `main` at `34a138d`,
median of three runs. **Not production numbers.** Pages in the order Home / Expenses / To-dos /
Reminders / the kid's Expenses.

| Number | Value | Command |
| --- | --- | --- |
| Data visible, slow 4G (observed), shared secret | 7,387 / 7,990 / 7,528 / 7,366 / 7,656 ms | `npm run lab:measure -- /dashboard /expenses /todos /reminders --runs 3`, and `npm run lab:measure -- /expenses --user kid --runs 3` |
| Data visible, CPU only, shared secret, 40 ms to Supabase (like production) | 1,356 / 2,005 / 1,419 / 1,345 / 1,590 ms | `npm run lab -- delay 40`, then the same with `--throttle cpu --no-lighthouse` |
| The same with asymmetric keys | 1,130 / 1,681 / 1,195 / 1,248 / 1,356 ms | `npm run lab -- jwt asymmetric`, then the same |
| Lighthouse 13.6.0 LCP, mobile preset | 5,523 / 5,953 / 5,674 / 5,518 / 5,677 ms | the first command (it runs Lighthouse too) |
| What the LCP element is | Home and Expenses: the page's data. To-dos and Reminders: the page's subtitle, not the data | same |
| CLS on Home | 0.156 to 0.207 observed, 0.126 to 0.137 Lighthouse: over the 0.1 "good" limit | same |
| Calls to Supabase Auth per cold load, shared secret | 30 / 29 / 26 / 22 / 29 (PF1 counted 13 / 13 / 11 / 9 from the code) | same; counted by the delay proxy |
| … with asymmetric keys | 0 on every page | `npm run lab -- jwt asymmetric`, then the same |
| Waterfall depth | 4 / 4 / 4 / 4 / 5, as PF1 read it | same |
| Data in the first HTML | none on any page | same |
| Server time of `/api/dashboard`: shared 0 ms / shared 40 ms / asymmetric 40 ms | 65 / 199 / 154 ms | same, from the request lines in `.lab/app.log` |
| Noise: two medians of the same page, an hour apart | up to 95 ms. Treat under 100 ms (slow 4G) or 150 ms (CPU only, or Lighthouse LCP) as noise | `npm run lab:baseline` repeats the first combination |
| Round trip from this laptop to the live project (the 40 ms) | 40.7 ms, median of 20 on one connection (TCP connect 18.7 ms) | `curl` of the public JWKS endpoint, as in `docs/lab.md` |
| Lab start from nothing (Docker images already pulled) | 74 s, build and seed included | `time npm run lab -- up` |
| Lab memory | containers about 400 MiB, the app about 190 MB | `docker stats --no-stream`, `ps -o rss -p "$(cat .lab/app.pid)"` |

**Safety checks, all done on 10 November 2026:**

- **Nothing reached the live project.** The lab's tests pass (`npx vitest run scripts/lab`, 42),
  among them `lab.sh guard`, `app` and `measure` refusing an env file with a hosted
  `SUPABASE_URL` before anything starts, and the guard refusing any other `*_URL` that isn't on
  this machine. During the whole baseline a watcher listed the sockets of the app and the delay
  proxy every 2 seconds (`lsof -nP -a -p <their PIDs> -i`): 41,817 socket entries over both
  passes, every remote address 127.0.0.1.
  The app was started with `env -i` and only the lab's variables (`.lab/app-environment` lists
  them; `SUPABASE_URL` was `http://127.0.0.1:54400`), from a copy of the checkout with no `.env`
  file, and its start-up line said AI and prices were off, which `.env.local` would have turned
  on. My shell had no Supabase, AI or price variable set. The only thing that read `.env.local`
  was the read-only `curl` to the public JWKS endpoint above, run by hand, outside the lab.
- **`npm run test:db` still passes** (36 files, 2,051 assertions): it doesn't read the lab's
  config, which isn't at `supabase/config.toml`.
- **No secrets staged.** The Supabase CLI's well-known local keys are generated into
  `.lab/app.env` at run time (git-ignored). `gitleaks dir` with the repo's `.gitleaks.toml` on
  every file this PR adds or changes found nothing, so no `.gitleaks.toml` entry was needed. The
  seed's passwords are only in `.lab/users.json` (mode 600): I searched every other lab file for them.
- **`down` leaves nothing**: after `npm run lab -- down`, `docker ps -a` and `docker volume ls`
  show nothing of the lab, the build copy is gone and `.lab/` holds only `results/`.

#### 5. How to check it yourself

About ten minutes, with Docker running:

1. `npm run lab -- up` (about 75 s once the Docker images are there). It ends with the seed's
   counts.
2. Open <http://localhost:3110>, sign in as `alex.parent@lab.test` with the password in
   `.lab/users.json`. You should see The Example Family's Home, with this month's spending and
   reminders due today.
3. `npm run lab:measure -- /dashboard --runs 3` (about three minutes). "Content on screen" and
   "Auth calls" should be close to the numbers above (within the noise).
4. `npm run lab -- jwt asymmetric`, then the same command: Auth calls go to 0.
5. `npx vitest run scripts/lab` runs the lab's 42 tests, the guard's among them.
6. `npm run lab -- down`, then `docker ps -a` and `docker volume ls`: nothing named
   `expense-tracker-lab` is left.

#### 6. Risks and how to undo it

- **For the app: none.** No app file changed; the lab's files aren't imported by it, and the
  Docker image leaves out `scripts/` (`.dockerignore`). Revert this PR to remove them.
- **The lab can't reach the live project by mistake**: the guard refuses any `*_URL` in its env
  file that isn't on this machine (tested), the app runs from a copy without `.env` files and with
  an empty environment, and `lab.sh` stops the app if its start-up line shows the live project's
  optional settings. A person could still edit `scripts/lab/guard.mjs`; don't.
- **The well-known local keys** of the Supabase CLI are generated at run time into
  `.lab/app.env` (git-ignored), never committed, so the secret scanner has nothing to find. No
  `.gitleaks.toml` entry was needed.
- **`npm test` now runs `scripts/lab/lab.test.mjs`** (about 0.7 s). Its `lab.sh` tests need `bash`
  and `node` only; nothing in it starts Docker.
- **The numbers depend on this laptop.** Another machine, or this one busy with something else,
  gives different absolute numbers. Compare a branch with `main` on the same machine, the same
  day, with the lab's own commands.

#### 7. Left open

- **"Add a kid" is probably broken in production** (row 4 of "Waiting for George"; details in
  `docs/lab.md`, "What the lab found while seeding"). I didn't fix it: it's a migration, outside
  this task, and the plan says no migration goes live without you.
- **Not measured: the VPS's round trip to Supabase.** The 40 ms is from this laptop. The command
  for the VPS is in `docs/lab.md` ("The delay"); if it's very different, rerun the baseline with
  `LAB_DELAY_MS=<it> npm run lab:baseline`.
- **Only the parent everywhere and the kid on Expenses.** I checked the kid on all four pages once
  (one run each, no Lighthouse): Home, To-dos and Reminders make the same requests as the parent's
  and their times were within the noise, so the full matrix measures only the kid's Expenses, the
  one page where the kid's requests differ (depth 5). The second adult and the user without a family
  are seeded but not in the baseline.
- **Lighthouse's FCP and its TBT on Expenses are not trustworthy here** (see "How to read the
  numbers"). Use the observed numbers for decisions; keep Lighthouse's for comparison with PF1 and
  for the score.
- **No interaction numbers (INP).** The lab loads pages; it doesn't tap. PF11 would add that.
- **The lab runs `next start` with Node on this Mac**, not the standalone `server.js` on Node 24
  that production runs, and no proxy (TLS, HTTP/2, Tailscale) in front.
- **For the next tasks:**
  - **PF3**: Home's CLS is 0.156 to 0.207 in the lab, over the 0.1 limit; the other three pages are
    at or near 0.
  - **PF4 and the JWT decision**: measure on the CPU-only pass with `delay 40`; the slow-4G pass
    can't see server work. Every API request's logged `dbCalls` includes its Auth call.
  - **PF6 and PF7**: "Data in the first HTML" is the lab's check that the server sent the data
    (`no` on every page today). On To-dos and Reminders the LCP element is the page's subtitle, so
    "LCP under 2.5 s" can be met without the list; judge those two by "content visible".
  - **PF8**: a cold load fires 12 to 16 link prefetches (`?_rsc=`), each route twice, and with the
    shared secret each costs one Auth call. They start after `/api/account` and don't delay the
    data, but they are more than half of the Auth calls.

### PF2: No endless loading

#### 1. The problem

When the server was slow or down, a screen could look like it was loading forever. I started the
lab, opened Expenses signed in as the seed's parent, and froze the gateway so no request got an
answer. Before this change (commit `07d12ce`, `main`):

- The skeleton showed for 15 s, then "Unable to load data".
- 6 s later the skeleton came back, because SWR (the library that loads each screen's data) tried
  again. It waited 15 s again, showed the error at **36.4 s**, then started a third try at 42 s.
  Nothing on screen said the wait was long, and a timeout that had already waited 15 s was tried
  again anyway.
- A server error (500) came back in 0.4 s and showed its error. SWR then retried 3 s later and
  again 15 s later, and each retry replaced the error with the skeleton again.
- If the session ended while the app was open (the cookie expired or was removed), the app sent you
  to `/login` with nothing saying where you were, and then bounced: sign-in page, `/dashboard`,
  sign-in page, 7 times in 4 s, and at 24 s it was on "Checking your session…". Only
  `/api/account` was checked for a 401; every other read just failed.
- With no connection the error said "Check your connection", the same as for any other failure.

#### 2. What changed

**What a person sees now**

- A load still waiting after **8 s** adds "This is taking longer than usual." and a **Retry**
  button above the skeleton. Retry loads it again. If the data then arrives, or the error comes,
  the line goes.
- A read that failed shows its error within **15 s of its first try**. Retries (up to 2, 3 s apart,
  server errors and 429 only) share that 15 s: each retry's own timeout is cut to what's left of it,
  and no retry starts if less than 2 s would be left. A timeout is not retried. A 4xx isn't either.
- A **401 from any request** sends the browser to `/login?next=<the page and its query>`, once,
  however many requests fail together. It does nothing on `/login`, `/join/*`, `/oauth/consent` and
  `/change-password`, which handle their own 401s. It is a full page load, so the old signed-in data
  is gone, which is what stops the bounce. The `(app)` layout's own 401 branch is still there
  (PF5 replaces it).
- With no connection the error says **"You're offline. Reconnect to load your data."** instead of
  the screen's own wording. The same applies to a read that fails while `navigator.onLine` is false.
- In `/dev/preview/<screen>`, `?fixture=hang` makes every request except the account never answer
  and `?fixture=fail` makes them fail with a 500, to see the slow state and the error.

**Files**

- `src/lib/api/client.ts`: the timeout error carries `code: "timeout"`, an offline failure
  `code: "offline"`; `retryDelay()` decides whether and when to retry; `apiFetcher` shortens a
  retry's timeout to the budget left; `parseResponse` calls the 401 redirect (for reads and writes).
- New `src/lib/api/auth-redirect.ts`: `loginUrlFor()` and `redirectToLoginIfUnauthorized()`.
- New `src/lib/http/safe-next.ts`: `safeNextPath` moved here from `origin.ts` (which is
  `server-only`), and `origin.ts` re-exports it. The browser now builds `next` with the very same
  function the login page uses.
- New `src/lib/api/slow-keys.ts`: the small store of keys whose load turned slow.
- `src/components/ui/provider.tsx`: `loadingTimeout: 8_000`, `onLoadingSlow`, `onSuccess`/`onError`
  clearing the mark, and an `onErrorRetry` that calls `retryDelay`.
- `src/components/ui/data-state.tsx`: `DataLoading` takes `slowKey` and shows the notice;
  `DataError` says offline. New `src/hooks/use-online.ts`, which `OfflineStatus` now uses too.
- 27 of the 54 `DataLoading` calls got a `slowKey` (the screens whose key is a constant or already
  in scope); the others fall back to "any slow load" (see 3). `asset-detail.tsx`, which draws its
  own skeleton, shows the same notice.
- `src/app/dev/preview/[screen]/screen-preview.tsx` and `page.tsx`: the two fixtures above.
- Tests: `auth-redirect.test.ts`, `client.test.ts` (more), `data-state.test.tsx`,
  `src/app/dev/preview/states.test.tsx`. `scripts/lab/states.mjs` and `states.sh` are the probe and
  the scenarios behind the numbers below; `docs/lab.md` says how to hang or fail a request.

#### 3. Why this way

- **Design 5 and [S8]:** attention starts to drift at 10 s, so the slow notice comes at 8 s and the
  error by 15 s. Both numbers are the plan's.
- **The plan's premises, checked against the code.** Two were off:
  - *"The error shows within 15 s of the first try" needed work, but not as described.* SWR already
    sets the error when the first try fails; screens that check the error first show it at once. The
    problem was the retries: SWR's default back-off (3 s, then up to about 18 s) put the skeleton
    back over the error for a long time, because most screens test `isLoading && !data` before
    `error`, and each retry could itself wait 15 s. So the fix is a budget, not only a retry count.
  - *`subscribe-dialog.tsx` does not load in a raw `useEffect`.* It already uses `useSWR` and has
    loading, error-with-retry and loaded states (audit D6 was fixed earlier). I left it alone; its
    loading state gets the slow notice through the keyless fallback.
  - *The count of 62 `useSWR` call sites*: I count 41 `useSWR(` calls in non-test source.
- **Every screen already ended in content, an empty state or `DataError`.** I read the states of all
  54 `DataLoading` uses and the screens that draw their own skeleton. Each has an `error` branch
  (usually checked before `!data`); the only gap was that nothing said when a wait ran long. So I
  added no new error branches. Screens that wait on the account are never reached in the app, since
  the layout shows a page only after the account loaded.
- **The redirect lives in `parseResponse`,** not in the SWR `onError` the plan names. `onError` sees
  only reads; a write that gets a 401 (a to-do saved after the session ended) now redirects too, and
  there is one place to maintain. The provider's `onError` keeps the password-change redirect.
- **`next` is built with `safeNextPath`** itself, not a copy of its rule, so they can't drift.
  That meant moving the function out of a `server-only` file. A pathname like `//evil.test` gives
  `/login?next=%2Fdashboard`.
- **Slow marks only count for a screen that was on display when they were made** (a sequence number).
  SWR doesn't report the end of a load nobody is watching, so without that a page left mid-load
  would show the notice the next time it opened.
- **Wording.** "This is taking longer than usual." and Retry are the plan's. "You're offline" is the
  plan's too; I added "Reconnect to load your data." and used a straight apostrophe, as the app's
  other strings do (the offline page uses a curly one). The Retry button has the refresh icon and
  `xs` size of the other retry buttons; nothing in `docs/ui-plan.md` said otherwise.
- **Turned down:** retrying only by count (leaves the 36 s case); a per-page `slow` prop everywhere
  (27 screens have a key in scope; the rest use the fallback, which says "slow" for any slow load and
  Retry reloads those); converting the calendar dialog to anything else.

#### 4. Numbers

All from the lab (`docs/lab.md`) on George's laptop, 10 November 2026, signed in as the seed's parent,
Expenses page, headless Chromium at 1280 px and 390 px. "Before" is the app built from `07d12ce`
(`main`), "after" this branch. Times are milliseconds since the page started loading and are seen by
polling the page text every 200 ms, so they're good to about 0.3 s. Not production numbers.

| What | Before | After | Command |
| --- | --- | --- | --- |
| Request never answers (gateway frozen): when "taking longer" shows | never | 8.6 s at 1280, 8.3 s at 390 | `scripts/lab/states.sh <name>` (hang-1280, hang-390) |
| … when the error shows | 15.3 s, then the skeleton again at 21.5 s, the error again at 36.4 s, the skeleton again at 42.3 s (45 s watched) | 15.7 s at 1280, 15.3 s at 390; nothing after, 45 s watched | same |
| … requests made to `/api/account` in 45 s | 3 | 1 | same |
| A 500 comes back at once (PostgREST stopped), 390 px | error at 0.6 s, back to the skeleton at the retry at 3.3 s, a third try at 18.4 s | error at 0.5 s, retry at 3.3 s, error again at 13.7 s, no third try | same (fail5xx-390) |
| A 500 that takes 14 s to come back (the stopped PostgREST makes the gateway wait), 1280 px | error at 15.3 s (the first request hit the earlier freeze, see 7) | slow notice at 8.4 s, error at 14.7 s, no retry (the budget was gone) | same (fail5xx-1280) |
| Signed out, open `/dashboard` | `/login` | `/login?next=%2Fdashboard` at 0.4 s | same (anon-1280, anon-390) |
| Session removed at 17 s, then the app reloads its data | `/login` at 17.5 s, then 7 bounces `/login` ↔ `/dashboard` in 4 s, "Checking your session…" at 24 s | `/login?next=%2Fexpenses` at 17.4 s after one 401, no bounce | same (midsession401-1280) |
| Slow but answering (`npm run lab -- delay 2500`), 390 px | no notice; content at about 23 s | "taking longer" at 18.8 s (the data request started at 10.6 s), content at 23.4 s | `npm run lab -- delay 2500`, then `node scripts/lab/states.mjs slow-then-loads-390 /expenses 390 --seconds 30` |
| Offline error text | "Your data could not be loaded. Check your connection and try again." | "You're offline. Reconnect to load your data." at 3.1 s | same (offline-1280); see 7 |
| Unit and component tests added | | 47, in four files (`npx vitest run src/lib/api src/components/ui src/app/dev/preview`) | |

(In the "after" cell of the first 500 row, the retry at 3.3 s hung 10 s inside the gateway, got a 500
at 13.6 s, and the error was back at 13.7 s: 13.2 s after the first try started, inside the 15 s. The
slow notice showed at 11.4 s during that retry.)

#### 5. How to check it yourself

1. In a terminal: `npm run lab -- up`, then open <http://localhost:3110> and sign in with a name and
   password from `.lab/users.json`.
2. Open Expenses. In another terminal: `docker pause supabase_kong_expense-tracker-lab`, then
   reload the page. After 8 s you see "This is taking longer than usual." with Retry; at about 15 s
   the error. `docker unpause supabase_kong_expense-tracker-lab`, press Try again.
3. Sign-out case: delete the site's cookies in the browser's devtools, then press Retry on any
   screen or reload: you land on `/login?next=…` with the page you were on.
4. Without the lab: run the app with `npm run dev` and open
   `/dev/preview/todos?fixture=hang` (the slow state after 8 s) and `/dev/preview/todos?fixture=fail`
   (the error with Try again). Turn Wi-Fi off on the `fail` one to see "You're offline".
5. `npm run lab -- down` when you're done.

#### 6. Risks and how to undo it

- **A 401 now redirects from any request,** including a write. A screen that expected to handle a
  401 itself, other than the four paths excluded, would be sent to sign in first. I found none: the
  only 401s the API sends are "no session" (`withUser`) and a wrong password (`/api/auth`, on `/login`).
  A future page that shows its own 401 needs adding to `OWN_401_PATHS` in `auth-redirect.ts`.
- **A shorter retry,** only for server errors and 429, and stopping at 15 s. A flaky connection that
  needed a third, late retry now shows the error sooner (and Try again works).
- **The slow notice is by key.** Screens with no key use "any slow load", so a slow background read
  elsewhere can put the notice on a screen that is itself fine. It's a notice with a Retry, not an error.
- To undo: revert the PR. Nothing is stored and there is no migration.

#### 7. Left open

- **Offline is not tested with a real network drop.** My attempt to drop the network at the right
  moment (Chrome's offline emulation) raced the page's own requests: the first try blocked the page's
  scripts, the second let every request finish. The 3.1 s figure is with `navigator.onLine` forced
  to false in the page, after the page had failed on a stopped PostgREST. The code path is the same
  (`useOnline` and `fetchWithTimeout` read `navigator.onLine`), and the component test covers it.
- **The 1280 px "500" run was contaminated** by the previous run: its first request hit the frozen
  gateway. The clean 500 run is at 390 px.
- **`use-account.ts` is unchanged.** Nothing needed it: the layout passes the account key to
  `DataLoading`.
- **The `(app)` layout still hides a failing account behind the skeleton** until its retries finish
  (at most 15 s), because it tests `isLoading` first. PF5 replaces that layout.
- **No lint rule.** "Every loading state has a way out" isn't something a machine can check
  from syntax; the tests above cover each screen state I could reach.
- The measuring script and scenarios are new files (`scripts/lab/states.*`); they aren't covered by
  tests of their own, but I ran `states.mjs` once more after moving it into the repo.

### PF3: Skeletons and a boundary per section

#### 1. The problem

- **Home jumped while it loaded.** Each card on Home loaded to a three-line placeholder, then grew
  to its real height, pushing the cards under it down. The lab measured a layout shift (CLS, how
  much the page jumps; Google's "good" limit is 0.1) of 0.207 on the emulated phone (0.137 in
  Lighthouse). In a 390 px load the culprits were "Recent expenses" (moved 118 px) and "To-dos for
  you" (moved 118 px, then 196 px).
- **Other pages swapped whole screens.** Expenses, To-dos and Reminders showed one generic card
  skeleton, then replaced it with the page. The page's heading did not exist until the data came, so
  on To-dos and Reminders the biggest thing on screen (LCP) was the subtitle, not the data, and it
  appeared only when the data did.
- **A tab tap did nothing at first.** With no `loading.tsx`, Next doesn't prefetch a dynamic page [N3].
  I held the server's answer for the tapped page: for 5 s the old page stayed, unchanged.
- **One error screen for everything.** An error in Investments replaced the whole app, shell and
  navigation included.

#### 2. What changed

**What a person sees now**

- Every loading state is shaped like its page: the page's real heading (and, on To-dos and
  Reminders, the real subtitle), then grey blocks the size of the cards, rows and columns. When the
  data arrives nothing moves on Home, Reminders and To-dos; on Expenses only the saved-tab chips
  move a little (see 7).
- Tapping a tab shows that page's skeleton at once.
- An error in a section shows "We couldn't load this page" with **Try again** and **Go to Home**,
  inside the shell. The bottom bar and sidebar keep working.
- Loaded pages look the same as before (screenshots below). The skeleton still says "This is taking
  longer than usual." with Retry after 8 s, and the error and offline states are unchanged (PF2).
- The skeleton shimmer is Chakra's own CSS animation; the theme's one reduced-motion block turns it
  off, as for every animation.

**Files**

- New `src/components/ui/skeletons.tsx`: `ListSkeleton`/`RowSkeleton` (built on the real row recipe),
  `LedgerSkeleton`, `ExpensesSkeleton`, `TodosSkeleton`, `RemindersSkeleton`, `CalendarSkeleton`,
  `InsightsSkeleton`, `PanelSkeleton` (Investments, Net worth, Settings, More), `RowsCardSkeleton`.
  New `skeleton-frame.tsx`: the wrapper every loading state shares (busy, announced label, slow
  notice). `slow-notice.tsx`: PF2's `SlowNotice` moved out of `data-state.tsx` so the two files don't
  import each other. `DataLoading` now draws inside `SkeletonFrame`.
- New `src/components/dashboard/home-layout.tsx` (`HomeGrid`, `useHomeBlocks`: the grid and which
  blocks a person has, shared by Home and its skeleton) and `home-skeleton.tsx`.
- `loading.tsx` and `error.tsx` in each of `dashboard, expenses, insights, investments, net-worth,
  todos, reminders, calendar, settings, more` under `src/app/(app)/`. Each `error.tsx` is
  `export default SectionError`; `src/components/ui/section-error.tsx` reports the error once
  (`client_error`, as before) and offers the retry and the way home. `(app)/error.tsx` and
  `src/app/error.tsx` use it too (the second without the Home link).
- Each page's own loading state now draws the same skeleton: `todos`, `reminders`, `expenses` (page,
  ledger, saved tabs), `calendar`, `insights`, `investments`, `net-worth`, and Home's four cards.
- `ledger-panel.tsx`: the summary line keeps room for the "· 26% more than October" comparison
  until it arrives (on a phone it wraps to a second line; without this the whole list dropped 18 px
  when it landed). It is the only change to a loaded screen, and only while the comparison loads.
- Tests: `skeletons.test.tsx` (each skeleton busy and labelled, the slow notice per `slowKey`, a
  section error keeps the shell and tries again, every section folder has both files),
  `theme.test.tsx` (the shimmer is a CSS animation), `error-boundaries.test.tsx` (updated).
- `scripts/lab/skeletons.mjs`: the probe behind the numbers (see 4).

#### 3. Why this way

- **Plan, Design 4 and [N3][N4].** `loading.tsx` is what makes Next prefetch a dynamic route [N3],
  and a skeleton the size of the content is what keeps CLS down [N4].
- **The installed Next 16.4 calls the error boundary's prop `retry`, not `reset`** (docs
  `error.md`); the repo already used `retry`. The plan said `reset`.
- **Headings are real text, not grey bars.** The plan names a `PageHeaderSkeleton`; I used the real
  `PageHeader`, because the title and the Reminders subtitle are fixed text, To-dos' subtitle comes
  from the account that is already loaded, and real text paints sooner and can't shift. Only Home's
  greeting (it depends on the time) and the month card's title are bars.
- **Built from the real components,** not guessed sizes: the real card, the row recipe, the page
  header and the same grids (`HomeGrid`, `LEDGER_COLUMNS` are shared with the screens). I then
  compared heights in the browser and fixed what differed (rows that carry a button are 60 px, not 56;
  Chakra's spacing scale has no `15` or `18`, so those two silently gave 0 height until I used rem).
- **A skeleton fills the screen, not the data.** Expenses has 52 rows this month and a loaded page
  3,800 px tall; the skeleton has 15 rows, enough to fill a phone. Only what is on screen can shift.
- **One error component, ten files.** Next needs a file per segment; the component is shared.
- **Turned down:** one `(app)/error.tsx` for everything (the plan wants one per section, and a test
  now enforces it); changing the layout's own gate (PF5); a lint rule (a test checks the folders;
  "same size as the content" can't be seen in syntax).

#### 4. Numbers

All from the lab on George's laptop, 10 November 2026, signed in as the seed's parent. "Before" is
`main` at `c638761`; "after" is this branch. **Not production numbers.** Observed = the emulated
phone on slow 4G (`docs/lab.md`); medians of three runs, ± half the spread in parentheses.

**Layout shift (CLS)**

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| Observed, before | 0.207 | 0.000 | 0.000 | 0.000 |
| Observed, after | **0.012** | 0.023 | 0.000 | 0.000 |
| Lighthouse, before | 0.137 | 0.009 | 0.000 | 0.000 |
| Lighthouse, after | **0.012** | 0.009 | 0.000 | 0.000 |

`npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3`. Home's
shifts, from the layout-shift entries (`scripts/lab/skeletons.mjs`): before, the "Recent expenses" and
"To-dos for you" cards moved 118 px, then the to-dos card 196 px; after, the same two cards move
30 and 22 px (the loaded cards show a "+1 more due" and a "+N more" line the skeleton doesn't). **Expenses
got worse, from 0.000 to 0.023.** Before, the skeleton and the page shared no elements, so
nothing counted as moved. Now the month and tab chips stay on screen, and "+ Tab" and "Filters"
move right a few pixels when the saved tabs arrive.

**Skeleton against content, in pixels** (`node scripts/lab/skeletons.mjs /<page> <width>`): the page's
block, skeleton then loaded, at 390 px and at 1280 px. Before, the skeleton was one generic card.

| | Home | Reminders | To-dos | Expenses |
| --- | ---: | ---: | ---: | ---: |
| 390 px, before | 626 / 1,044 | 356 / 756 | 356 / 1,172 | 524 / 3,800 |
| 390 px, after | 1,002 / 1,044 | **756 / 756** | 964 / 1,172 | 1,266 / 3,800 |
| 1280 px, before | 356 / 542 | 372 / 686 | 372 / 1,050 | 512 / 3,370 |
| 1280 px, after | 500 / 542 | **686 / 686** | 842 / 1,050 | 1,108 / 3,370 |

Home's cards, 390 px, skeleton / loaded: month 110 / 110, due 238 / 260, recent 338 / 338, to-dos
226 / 246. To-dos and Expenses lists are longer than their skeletons below the fold (a phone shows
the first 750 px or so); above it the blocks have the same tops and heights: header 44 / 46,
filters 96 / 32, column heading and add button.

**Taps** (`scripts/lab/skeletons.mjs /dashboard <width> --tap /<page>`, the server's answer held):

| | Before | After |
| --- | --- | --- |
| Skeleton visible after the tap | never in 5 s (old page stays) | 66 ms (1280, Expenses), 63 ms (1280, To-dos), 74 ms (390, Expenses), 68 ms (390, Reminders) |
| `?_rsc=` prefetch requests on a cold Home load | 16 | 16 |
| Prefetch answer size | about 1.30 KB each (recorded for the ones that finished) | about 1.31 KB each |

The request log (probe output): both builds send the same 16 prefetches (eight routes, each
twice) right after the account arrives; the answers are as small as before. What differs is that the tapped
page's tree now includes a loading boundary, so the router can show it with no new request. After
the tap, the new page then prefetches `/dashboard` (2.65 KB).

**Cold load on the emulated phone** (slow 4G). `npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3`:

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| Data on screen (placeholders gone), before | 7,513 | 8,104 | 7,617 | 7,502 |
| … after | 7,719 | 8,537 | 7,906 | 7,623 |
| FCP, before / after | 6,856 / 7,044 | 7,196 / 7,616 | 6,912 / 7,232 | 6,864 / 7,000 |
| LCP, before / after | 7,540 / 7,680 | 8,248 / 8,280 | 7,708 / **7,232** | 7,428 / **7,000** |
| LCP element, after | the month's total | the "% more" line | the subtitle, in the skeleton | the subtitle, in the skeleton |
| JS on the wire, KiB, before / after | 411.7 / 475.4 | 439.8 / 481.1 | 429.5 / 490.6 | 410.6 / 469.8 |

Noise on this pass is under 100 ms, so the later times are real. On the CPU-only pass (no network
throttling, `--throttle cpu --no-lighthouse`) data appears at, before / after: Home 1,004 / 1,073,
Expenses 1,609 / 1,453, To-dos 1,147 / 1,054; the noise there is 150 ms, so no change. **Reminders,
before: not measured** (the run crashed at that page; I took the lab down before repeating it); after
1,019.

**What the skeletons do to FCP and LCP.** Observed, FCP moved *later* by 140 to 420 ms, not sooner:
on a cold load the first text still comes from the shell once `/api/account` answers (6.9 s), and the
extra scripts below delay it. LCP on To-dos and Reminders is the subtitle, which now paints with the
skeleton about 0.45 s before the data (7.7 to 7.2 s, 7.4 to 7.0 s). Lighthouse's own FCP is still
wrong for these pages (about 913 ms before and after, from its simulation); its LCP for To-dos and
Reminders is now 912 ms in all three runs, because the subtitle is in the first render, but the
phone doesn't show it that early. Don't read 912 ms as a result. Home and Expenses LCP is still data.

**Why the cold load is slower: more scripts.** Lighthouse, run 0 of Home: before, 38 script files,
411.7 KiB, all at the start. After, 41 files and 416.7 KiB at the start (+5 KiB: the skeletons and
the `loading`/`error` files) and **21 more files, 57.9 KiB, loaded later**, when the sidebar and
tab-bar links prefetch the other sections: each now brings its `loading` and `error` chunks and, for
the two server pages (Net worth, Investments) and Settings' layout, their panel code. To-dos: 20
files, 58.4 KiB. I didn't isolate the cause by switching prefetch off; the CPU-only pass, where
bandwidth is free and nothing is slower, fits bandwidth being shared with the page's data.

**Network panel** (the log above, not a screenshot): in a production build the `?_rsc=` requests go
out as soon as the shell and its links appear, about 0.2 s after the account answers on the
emulated phone (6.8 s and 6.97 s in the Home run), and the loading boundary needs no request of its own on a tap.

**Screenshots** (loading state and loaded page, before and after, 390 and 1280 px; "loaded" pages
are identical except the clock: "12 hours late" became "13 hours late" between runs): in
`docs/performance/screenshots/pf3/`, named `before-` or `after-<page>-<width>-<loading|loaded>.jpg`,
and `…-tap-<width>-<page>.jpg` for a tap with the answer held. Examples:
[Home, 390, after](performance/screenshots/pf3/after-dashboard-390-loading.jpg) ·
[Home, 390, before](performance/screenshots/pf3/before-dashboard-390-loading.jpg) ·
[Expenses, 390, after](performance/screenshots/pf3/after-expenses-390-loading.jpg) ·
[To-dos, 1280, after](performance/screenshots/pf3/after-todos-1280-loading.jpg) ·
[Reminders, 1280, after](performance/screenshots/pf3/after-reminders-1280-loading.jpg) ·
[a tap, Reminders, 390, after](performance/screenshots/pf3/after-tap-390-reminders.jpg) ·
[the same tap, before](performance/screenshots/pf3/before-tap-390-reminders.jpg).

Checks: `npm run lint`, `npx next typegen && npm run typecheck`, `npm test` (6,787 passed),
`npm run build`: all pass.

#### 5. How to check it yourself

1. `npm run lab -- up`, sign in (`.lab/users.json`), open Home on a phone-sized window.
2. Freeze the gateway: `docker pause supabase_kong_expense-tracker-lab`, then tap Money, Planning
   and the sidebar items: the page's skeleton shows at once and stays. `docker unpause …`.
3. `node scripts/lab/skeletons.mjs /todos 390` prints the skeleton and loaded heights and every layout
   shift with the elements that moved; the screenshots land in `.lab/results/skeletons/`.
   `… /dashboard 390 --tap /expenses` times the tap.
4. Break a section: in `src/app/(app)/net-worth/page.tsx` throw in the component; the shell stays and
   "Try again" and "Go to Home" show.
5. `npm run lab -- down`.

#### 6. Risks and how to undo it

- **A cold load downloads about 58 KB more, and on the slow phone shows data 0.1 to 0.4 s later**
  (4). Revert the PR to get the old timings back, or PF8 can hold the prefetches until the page's
  data is in.
- **Skeleton sizes can drift** from the screens when someone changes a row or card. Nothing checks
  it automatically; `scripts/lab/skeletons.mjs` does it by hand.
- **The count of rows in the skeleton is a guess** (3 reminders, 5 expenses, 15 ledger rows). A
  family with fewer shows a skeleton taller than its page, which moves nothing on screen.
- Nothing stored, no migration. To undo: revert the PR.

#### 7. Left open

- **The cold-load cost in 4 belongs to PF8** (what to prefetch and when) and PF9 (the panel code
  that the two server pages bring along). I didn't change prefetching here.
- **The first screen of a cold load is still PF5's.** Until `/api/account` answers, the layout shows
  its own generic screen with no text, so FCP can't improve before PF5 moves that gate to the server.
- **Expenses' CLS is 0.023** (the saved-tab chips). Fixing it means reserving room for the chips
  while they load.
- **Not changed:** Settings' and More's skeletons are generic (`PanelSkeleton`); the nested
  Settings pages and Expenses → Import show their section's skeleton while they open; the
  other `DataLoading` calls (Settings pages, import, dialogs) keep the generic skeleton.
- **No skeleton-to-content fade** (`ui-direction.md` lists one for U4); I didn't add it.
- **Before-numbers for Reminders on the CPU pass** are missing (4).
- **The plan's `PageHeaderSkeleton`** isn't a component (3).

### PF4: Fewer round trips in the app

#### 1. The problem

- **Each data request waited in a queue on the server before it read any data.** For Home's month
  card (`/api/dashboard`) the server asked, one after the other: Supabase Auth in the proxy, Auth
  again in the route, your profile (must you change your password?), your family membership (may
  you see expenses?), and only then the expenses. With 40 ms to Supabase that's five waits in a
  row. The same queue is in front of Expenses, the saved tabs, Investments, Net worth and Imports.
- **Some requests read the family list two or three times.** Saving a calendar event read it twice
  (three times for "every event in the series"), and moving a to-do card read it twice. PF1 and PF1b
  had found that the four daily pages read it at most once, so this was the only place the plan's
  "`get_family()` runs several times per request" was true.
- **Searching a saved tab read the whole tab.** Searching "zzz" in a tab of all 3,724 of Alex's
  expenses fetched all 3,724, in eight requests one after another, then threw away the ones that
  didn't match: 0.7 s on the server for an empty result (audit P9).
- **Some lists could be quietly incomplete** (audit D7, B11):
  - the calendar, the open to-dos, the reminders and the import counts read one page and relied on
    Supabase's 1,000-row cap never being reached;
  - **an investment account with more than 1,000 orders showed only its oldest 1,000**, so its
    positions were wrong. The code asked for up to 5,000 (audit B11 assumed that was the cap), but the
    orders came as a list inside the account, and Supabase's REST layer cuts such a list at its
    1,000-row limit without saying so. I found this in the lab: with 5,001 orders seeded, the query
    `main` sends returns 1,000, the oldest ones. More than 500 net-worth items would also have dropped
    some from the total. Nobody was told.
- **A long list read page by page broke if a row was deleted in between.** I checked it in the lab:
  when a deletion leaves the next page's start past the end, PostgREST (Supabase's REST layer)
  answers "416 Requested range not satisfiable" and the whole request failed with a 500.

#### 2. What changed

**What a person notices**

- **Expenses, saved tabs, Home's month card, Investments, Net worth and Imports answer about 60 ms
  sooner** (at 40 ms to Supabase): the membership is now read at the same time as the password
  check instead of after it. The other routes are unchanged (numbers in 4).
- **Searching a saved tab is three times quicker on a big tab** (0.71 s to 0.23 s on the server for
  3,724 expenses): the database does the search and sends only the matches. The results are the
  same, in the same order (172 searches compared, 4).
- **Big lists are complete or say why not.** The calendar, the to-do board, the reminders, the
  import counts and every expense list now read every page. An investment account with 1,001 to
  5,000 orders now shows all of them (it showed the oldest 1,000); past 5,000 orders, or past 500
  net-worth items, the page says so instead of showing wrong numbers. The two new messages are below.
- **A row deleted while a long list loads no longer breaks it**: the read starts over (at most three
  times) and returns a consistent list.
- **Unchanged: the Auth calls.** A cold Home load still makes 30 calls to Supabase Auth, 2 per API
  request. Removing them is the signing-keys decision (row 1 of "Waiting for George"); the code
  alternative is not built (7).

**The messages** (both new, both a 409 with `{ error }`, shown in place of "Your data could not be
loaded…" on the Investments and Net worth pages, and returned as the tool error over MCP):

- Investments, and one asset's order history: "One broker account has more than 5,000 orders, more
  than the app can show. Nothing is lost. Ask whoever runs the app to raise the limit."
- Net worth: "There are more than 500 net-worth items, more than the app can show. Nothing is lost.
  Ask whoever runs the app to raise the limit."

Checked against `docs/ui-direction.md` ("Copy", which the UI plan points to): short, plain, sentence
case, says what to do next, no exclamation mark, no "Oops". "Whoever runs the app" is my wording
because the app has no admin role to name; change it if you'd rather it said you.

**How it works**

- **Once per request** (`src/lib/request-memo.ts`, new): `oncePerRequest(key, load)` keeps a read's
  promise for the rest of the request in an `AsyncLocalStorage`; `forgetPerRequest(key)` drops it.
  `logRequest` (every API request, MCP included) opens a new memo, and so does
  `runWithSupabaseClient` (an MCP call acting as a token's user), so a read is only shared between
  calls acting as the same caller. Three reads use it: who is signed in (`getAuthenticatedUser`,
  `src/lib/auth/index.ts`), the membership (`getCurrentMember`, `src/lib/family/current-member.ts`)
  and the family (`get_family()`, in `src/lib/supabase/repositories/family.ts`). Every family write
  there runs inside `changingFamily`, which forgets the membership and the family afterwards, and so
  do the two account deletions in `account-data.ts` (a kid's, your own). Both React `cache()` wrappers are gone: they
  only work while React renders, never in a route handler.
- **Membership alongside the password check**: `withUser` takes a `readAlongside` read and starts it
  with the password check (`src/lib/http/route.ts`); `withPermission` and `withParent` pass
  `getCurrentMember` (`src/lib/http/permission.ts`). The handler's own call then gets the same
  promise. The membership is read even for an account that must change its password; it's then
  thrown away.
- **Search on the server**: `expenseSearchFilter` (`src/lib/supabase/filters.ts`) builds the `or()`:
  `description` and `notes` with `ilike`, plus the category and subtype keys whose label contains the
  text, plus `subtype is null` when the text is part of "No subtype": the same fields as
  `matchesExpenseSearch` (both take "No subtype" from one constant). The text goes through S8's `escapeLikePattern` (it was written and tested
  for this but never used) and inside PostgREST's double quotes. The repository runs
  `matchesExpenseSearch` over what comes back, so the result is exactly what it was.
- **One paging helper** (`src/lib/supabase/fetch-all-pages.ts`, new): pages of 1,000 (Supabase's
  usual cap), advancing by the rows that came back, with the exact count on every page. If the
  count changes between pages, or PostgREST answers PGRST103 (the 416), it starts over, up to three
  times, then fails with the list's own message. With `limit` it reads only the first rows, for the
  caps. Used by the expense lists (pages were 500 before), the import counts (its own loop is gone),
  the to-do board, the reminders and completions, the calendar, the investment orders and the
  net-worth items. To-dos and reminders gained `id` as the last sort column, so the order is total.
- **Caps that refuse**: the investment orders are no longer a list embedded in the account (cut at
  1,000), but their own paged read, newest first, joined to the account to check its owner
  (`src/lib/supabase/repositories/investments.ts`): the accounts and the orders in parallel, so no
  extra wait. `src/lib/investments/service.ts` reads at most 10,001 orders (one more than two
  accounts at 5,000 each, so if that many come back, one account is over) and refuses with the 409
  when an account has more than 5,000; one asset's history reads 5,001 and refuses the same way.
  Newest first means a limit could only ever leave out the oldest. `src/lib/net-worth/service.ts`
  reads 501 items and refuses past 500 (the limit moved there from the repository, which pages too).
  The messages are built from the two limits, so raising one changes its message.
  `DataError` (`src/components/ui/data-state.tsx`) takes the failed request's `error` and shows a
  409's message; the Investments and Net worth panels pass it.
- Tests: `request-memo.test.ts`, `fetch-all-pages.test.ts`, `src/lib/auth/index.test.ts` (new); in
  the existing files, the family read once across a to-do move's two calls and again after a family
  write (`todos.test.ts`), the membership once per request (`current-member.test.ts`), the
  membership started before the password check answers (`permission.test.ts`), the escaping and the
  search on the server (`filters.test.ts`, `expenses.test.ts`, with literal `%`, `_`, `\`, `*`, `,`,
  `(`, `"` and diacritics), paging past a server cap (`todos.test.ts`, `reminders.test.ts`), the
  refusals and the newest-first reads (`investments` service and repository tests,
  `net-worth.test.ts`, `net-worth/route.test.ts`, `data-state.test.tsx`).
  The test fake for Supabase learned `ilike`, quoted values and `is.null` inside `or()`.
- `docs/lint-rules.md`: the search is the third allowed disable of `local/postgrest-filter-string`.

#### 3. Why this way

- **I checked the plan's premises first, and fixed what the lab showed rather than what the plan
  assumed.** PF1 and PF1b had found that `get_family()` runs at most once on the four daily pages
  and that the repeated cost there is the Auth calls. So I timed 28 routes in the lab before
  changing anything (4). `get_family()` was repeated only by saving a calendar event (2, or 3 for a
  whole series) and moving a to-do card (2); the membership was never read twice. What did cost the
  daily pages a round trip was the *order*: the membership waited for the password check although
  neither needs the other. That one isn't in the plan's list; it's the change that moves Home's and
  Expenses' data requests, so I made it.
- **Once per request with `AsyncLocalStorage`, not React's `cache()`.** `cache()` only deduplicates
  while React renders a server component; in a route handler it calls through every time (audit
  P11, and the comment in `viewed-user.ts` already said so). The plan offered L2's request context
  or a small store of its own; I used a store of its own, because the request context is described
  as logging only, and because an MCP call switches who the caller is inside one request: each
  `runWithSupabaseClient` run gets a fresh memo, so nothing read as one caller is reused as
  another. That is also why the keys don't carry the user id, as the plan suggested: within one memo
  the caller can't change.
- **The membership's memo sits in `getCurrentMember`, the family's in the Supabase repository.** The
  to-do and calendar repositories call the Supabase family repository directly, so the family has to
  be kept there. The membership is only read through `getCurrentMember`, and keeping it there means
  the route tests' fake repositories see one read too, as production does.
- **A failed read stays failed for the rest of the request.** Reading again would double the load on
  a database that is already failing, and the request fails either way.
- **Search: `ilike` inside one `or()`, then the old check over the matches.** The plan asks for the
  same fields and the same results. Category and subtype names aren't stored (only their keys), so
  the names are matched in the app and only catalogue keys reach the query. PostgREST turns `*` into
  `%` before the query runs and no escape stops it (tried in the lab), so `escapeLikePattern` sends a
  `*` as `_`, one character; the database can return a few extra rows and `matchesExpenseSearch`
  drops them. The check can't add a row the database left out: a letter whose lower case Postgres
  and JavaScript disagree on could in theory be missed. The 172 searches compared in 4 include
  "İstanbul", "Straße", "Ș" and "Ş" and found no difference.
  Turned down: a full-text index (different results; the plan says same results) and a new SQL
  function (a migration for something PostgREST can already do).
- **Paging with the count on every page.** Without a total, a short page from a server cap can't be
  told from the last page (the old code's own test covers a cap of 113 rows). With it, a changed total
  between pages shows the list moved, and starting over gives a list with no row missing or twice.
  Turned down: keyset paging ("after this date and id"), which needs a cursor per query and the
  sort columns in every one; it's worth it only for lists far longer than these. Page size 1,000,
  because Supabase's default `max-rows` is 1,000 and the old 500 doubled the requests for long
  ledgers.
- **Refuse rather than page through, for investments and net worth.** Positions and totals worked
  out from part of the history are wrong, so a cut list is worse than an error; and the plan and the
  audit (B11) ask for a refusal. **409, not 422**: the request is fine, what's stored is past what the
  app handles. The investments read is newest first anyway, so if anyone ever removes the refusal,
  only the oldest orders could be left out.
- **One `getClaims` per request: not built, as the plan says** while the signing-keys decision is open.
  Option 2 (skip the proxy's refresh for `/api/*`) changes how sessions are refreshed; the numbers for
  both modes are in 4 and 7.

#### 4. Numbers

All from the lab on George's laptop, 10 November 2026, signed in as the seed's parent (Alex), with
40 ms added to every call to Supabase (`npm run lab -- delay 40`) and the shared-secret JWT like
production, unless a row says otherwise. "Before" is `main` at `e4189a1`, "after" this branch.
**Not production numbers.**

**Per route: the server's time and calls.** Each route called five times in a row from a script
that signs in through `POST /api/auth`, as the lab's measuring script does; the median of the five
`request` lines in `.lab/app.log` (`ms`, `dbCalls`, `dbMs`) and of the calls the delay proxy logged
(`.lab/supabase-calls.jsonl`: Auth calls, `get_family()`). "Auth calls" counts the proxy's own,
which no request line shows; `dbCalls` includes the route's one. Writes ran on the seed's own
events and cards. The last column is the same after-build with asymmetric keys
(`npm run lab -- jwt asymmetric`); its Investments and Net worth rows are from the build before the
order reads were rewritten (the page-by-page read below), the rest is the same code.

| Route | Server ms | `dbCalls` | `dbMs` | Auth calls | `get_family()` | Server ms, asymmetric keys |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `GET /api/account` | 116 → 111 | 5 | 265 → 254 | 2 | 0 | 60 |
| `GET /api/dashboard` | 229 → **164** | 5 | 270 → 257 | 2 | 0 | 113 |
| `GET /api/expenses` | 224 → **162** | 4 | 214 → 204 | 2 | 0 | 112 |
| `GET /api/expense-tabs` | 224 → **159** | 4 | 213 → 202 | 2 | 0 | 109 |
| `GET /api/family` | 169 → 159 | 3 | 161 → 152 | 2 | 1 | 110 |
| `GET /api/todos` | 171 → 166 | 5 | 267 → 263 | 2 | 1 | 111 |
| `GET /api/reminders` | 170 → 156 | 4 | 214 → 201 | 2 | 0 | 112 |
| `GET /api/reminders/summary` | 169 → 158 | 3 | 160 → 150 | 2 | 0 | 107 |
| `GET /api/account/notices` | 166 → 158 | 3 | 159 → 151 | 2 | 0 | 109 |
| `GET /api/dashboard?member=<Sam>` | 227 → **162** | 5 | 267 → 255 | 2 | 0 | 113 |
| `GET /api/dashboard?member=all` | 359 → **288** | 10 | 636 → 624 | 2 | 1 | 246 |
| `GET /api/expenses?member=all` | 304 → **242** | 7 | 399 → 385 | 2 | 1 | 193 |
| tab ledger, Alex's first saved tab | 288 → **219** | 5 | 272 → 260 | 2 | 0 | 168 |
| … searched for "zzz" | 284 → **215** | 5 | 270 → 256 | 2 | 0 | 166 |
| tab ledger, a tab of all 3,724 expenses | 733 → **411** | 12 → **8** | 694 → 431 | 2 | 0 | 377 |
| … searched for "fuel" (139 found) | 716 → **229** | 12 → **5** | 683 → 267 | 2 | 0 | 178 |
| … searched for "groc" (1,129 found) | 722 → **303** | 12 → **6** | 686 → 337 | 2 | 0 | 260 |
| … searched for "zzz" (none) | 706 → **227** | 12 → **5** | 675 → 270 | 2 | 0 | 178 |
| `GET /api/calendar/events` (80 days) | 223 → 215 | 5 | 266 → 258 | 2 | 1 | 163 |
| `GET /api/calendar/events/:id` | 170 → 159 | 4 | 214 → 202 | 2 | 1 | 110 |
| `PATCH /api/calendar/events/:id`, one event | 287 → 273 | 7 → **6** | 380 → 312 | 2 | 2 → **1** | 229 |
| … `scope: "all"`, a weekly series | 459 → 433 | 11 → **9** | 595 → 468 | 2 | 3 → **1** | 398 |
| `PATCH /api/todos/:id` | 170 → 162 | 4 | 216 → 206 | 2 | 1 | 114 |
| `POST /api/todos/:id/move` | 333 → 315 | 9 → **8** | 471 → 401 | 2 | 2 → **1** | 278 |
| `GET /api/investments` | 225 → **159** | 4 → **5** | 215 → 248 | 2 | 0 | 112 |
| `GET /api/net-worth` | 230 → **159** | 5 → **6** | 272 → 302 | 2 | 0 | 113 |
| `GET /api/imports` | 217 → **158** | 5 | 261 → 251 | 2 | 0 | 108 |

```bash
npm run lab -- up && npm run lab -- delay 40
node scripts/lab/search-compare.mjs > search.json      # creates the 3,724-expense tab the probe uses
node scripts/lab/route-probe.mjs .lab parent 5 > routes.json
```

What it says:

- **The `withPermission` routes save one round trip each: 55 to 70 ms** (`/api/dashboard`,
  `/api/expenses`, `/api/expense-tabs`, the member views, the tab ledger, Investments, Net worth,
  Imports). Same number of calls, one fewer wait in a row. With asymmetric keys they'd save the
  Auth call on top: `/api/dashboard` 229 → 164 → 113 ms.
- **`get_family()` is now read once in every route measured** (calendar edits 2 and 3 → 1, a to-do
  move 2 → 1). Those routes' time barely moves (287 → 273, 459 → 433 ms), because the repeated reads
  ran alongside other reads; what they save is calls to Supabase (7 → 6, 11 → 9, 9 → 8).
- **Search reads only the matches.** Searching a tab of all 3,724 expenses: 0.71 s → 0.23 s, 12
  calls → 5, and 0.68 s → 0.27 s spent waiting on Supabase. The tab itself, unsearched, reads in 4
  pages of 1,000 instead of 8 of 500: 0.73 → 0.41 s.
- **Investments and Net worth make one more call** (4 → 5, 5 → 6: the orders are now their own
  read, beside the accounts) **and still answer sooner** (225 → 159, 230 → 159 ms), because that
  read runs in parallel and the membership no longer waits.
- **Auth calls per request: unchanged, 2.** Routes whose repositories checked the caller again now
  ask Auth once less (below).

**Routes that asked Auth twice in the same request** (same script, five calls each):

| Route | Auth calls, before → after | Server ms |
| --- | ---: | ---: |
| `DELETE /api/account/avatar` (remove picture) | 3 → **2** | 269 → 214 |
| `PATCH /api/account/mcp` (the AI-assistants switch) | 4 → **3** | 279 → 220 |

The MCP switch answers 500 in the lab, before and after: its last step asks Auth for the OAuth
grants, and the lab's Auth has no OAuth server (404). The count is up to that point. The AI gate
(`src/lib/supabase/repositories/ai.ts`) checks the caller the same way; the lab has AI off, so it
wasn't measured.

**Pages: time until the data is on screen.** CPU-only pass (the phone's screen and 4× slower CPU, no
network throttling, the pass where server time shows), median of three, ms:

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| Before (`main`), shared secret | 1,045 | 2,022 | 1,447 | 1,403 |
| After, shared secret | 1,056 | 1,897 | 1,463 | 1,374 |
| After, asymmetric keys | **906** | **1,704** | **1,209** | **1,195** |
| Auth calls per cold load, before and after (shared) | 30 | 29 | 26 | 22 |
| … with asymmetric keys | 0 | 0 | 0 | 0 |
| Supabase calls / logged `dbCalls` / `get_family()` per cold load, before and after | 49 / 25 / 1 | 48 / 26 / 1 | 40 / 19 / 2 | 33 / 15 / 0 |

```bash
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3 --throttle cpu --no-lighthouse
npm run lab -- jwt asymmetric   # then the same
```

- **No page got measurably faster from this task.** The differences (+11, −125, +16, −29 ms) are
  inside the 150 ms noise of this pass. On Home the month card's request is now as quick as the
  other four that load beside it (164 against about 150 to 166 ms), so the last of them still
  lands at the same time; Expenses' two requests are 50 to 60 ms quicker, which fits its −125 but
  doesn't prove it.
- **The before and after rows were run back to back.** A first pair, run an hour apart, said
  943 → 1,066 on Home: the "before" had been taken while the laptop was quieter. Run again next to
  each other, `main` measured 1,045. In both runs the browser itself started `/api/account` 70 to
  90 ms later (660 → 745 ms after the tap), before any server change could matter: that was the
  machine, not the code. Compare only rows run side by side.
- **Asymmetric keys still matter after this task: 150 to 254 ms sooner on every page** (Home 150,
  Expenses 193, To-dos 254, Reminders 179), with 0 Auth calls. PF1b measured 97 to 324 ms on the
  older `main`. This is the case for row 1 of "Waiting for George".

**The search returns the same results.** Before and after, 43 searches, each with and without a
year
filter, on two tabs: Alex's tab of all 3,724 expenses, and a tab of 16 awkward descriptions I added
for the solo user (`100% cotton`, `a_b`, `back\slash`, `star*shop`, `comma, (x)`, `quote "q"`,
`ŞTIRBEI Ștefan`, `İstanbul`, `Straße`, …), searched for `%`, `_`, `\`, `*`, `r*s`, `,`, `(x)`,
`"q"`, `ștefan`, `STRASSE`, `no sub`, `Groceries` and so on: **all 172 answers identical** (the same
ids in the same order): `node scripts/lab/search-compare.mjs > before.json` on `main`, the same on
this branch, then `diff`.

**The caps, in the lab** (data added to the solo user with the lab's secret key):

| | Before | After |
| --- | --- | --- |
| 5,001 orders on one account | the query `main` sends returns the oldest **1,000** (curl of PostgREST with the same parameters) | Investments shows the 409 message ([390](performance/screenshots/pf4/investments-409-390.jpg), [1280](performance/screenshots/pf4/investments-409-1280.jpg)) |
| 5,000 orders on one account | not run separately; the same query, so the same 1,000-row cut | "5000 units", all of them, in 5 pages (467 ms at 40 ms) |
| 501 net-worth items | not measured (not seeded while `main` ran; its `.limit(500)` would have dropped one) | Net worth shows the 409 message ([390](performance/screenshots/pf4/net-worth-409-390.jpg), [1280](performance/screenshots/pf4/net-worth-409-1280.jpg)) |

**A row deleted between two pages**, checked directly against the lab's PostgREST 16.5: asking for
an offset past the last row with the count on answers `416` `PGRST103`
("An offset of 300 was requested, but there are only 263 rows"); without the count, `200 []`. The
old loop turned the 416 into a 500; the helper starts over (tested in `fetch-all-pages.test.ts`).

**Checks:** `npm run lint`, `npx next typegen && npm run typecheck`, `npm test` (6,846 passed),
`npm run build`, `npm run test:db` (2,051 assertions): all pass. Loaded screens are unchanged (no
loaded component changed; the 409 state is the existing `DataError` with the server's sentence).
After measuring: `npm run lab -- down`; `docker ps -a` and `docker volume ls` list nothing of the
lab, and `.lab/` holds only `results/`.

#### 5. How to check it yourself

1. `npm run lab -- up`, then `npm run lab -- delay 40`.
2. `node scripts/lab/search-compare.mjs > after.json`. Then `git switch --detach origin/main`,
   `npm run lab -- app`, the same into `before.json`, and `diff before.json after.json`: no output.
   (Switch back and `npm run lab -- app` again.) Or by hand: sign in at <http://localhost:3110> as
   Alex (`.lab/users.json`) and search the tab "Everything (PF4 probe)" for "fuel", "100%", "a_b".
3. Watch the request lines while you use the app: `tail -f .lab/app.log | grep '"event":"request"'`.
   `GET /api/dashboard` and `GET /api/expenses` show `rpc.get_my_membership` next to
   `db.profiles.get`, not after it, and are about 60 ms quicker than on `main`. Edit a repeating
   calendar event for "every event": one `rpc.get_family` in its line (three on `main`).
4. The refusal, in the lab only: give the solo user 501 net-worth items with the lab's secret key,
   then sign in as Casey and open Net worth: the message from 2 instead of the generic error.

   ```bash
   set -a; . .lab/app.env; set +a; U=$(jq -r .users.solo.userId .lab/users.json)
   jq -n --arg u "$U" '[range(501) | {user_id: $u, name: "Item \(.)", kind: "asset", category: "cash", currency: "EUR"}]' |
     curl -s -X POST "$LAB_SUPABASE_DIRECT_URL/rest/v1/net_worth_items" -H "apikey: $SUPABASE_SECRET_KEY" \
       -H "Authorization: Bearer $SUPABASE_SECRET_KEY" -H "Content-Type: application/json" -d @-
   ```
5. `npx vitest run src/lib/request-memo.test.ts src/lib/supabase/fetch-all-pages.test.ts
   src/lib/supabase/filters.test.ts src/lib/supabase/repositories/expenses.test.ts` (the new tests).
6. `npm run lab -- down`.

#### 6. Risks and how to undo it

- **A read kept for the rest of a request can be out of date after a write in the same request.**
  Every write that changes the family or the membership forgets both (the family repository's
  writes, and the two account deletions). A new write path that changes them must do the same; a
  write that changes a member's name, colour or picture from somewhere else (today none reads the
  family afterwards in the same request) would need it too. Only three reads are kept, so the risk
  stays small and easy to list.
- **The membership is read before the password check answers.** For an account that must change its
  password, one extra read (its own membership, under RLS) happens and is thrown away. Nothing
  reaches the response.
- **Search depends on PostgREST's quoting and `ilike`.** Checked against the lab's PostgREST 16.5
  with awkward text (4). A future PostgREST that changed how quoted values are read would show up
  as wrong search results, not as a security hole: the text never leaves the quotes (tested, a
  quote in the text is escaped).
- **Each page of a complete list now also asks for the exact count.** For the to-do board,
  reminders and calendar that's a count over a few dozen rows; for expenses it was already asked.
- **The 409 has no way out inside the app**: past 5,000 orders or 500 items the page shows the
  message until the limit is raised in code. Before, it showed wrong numbers instead. The family
  view refuses as a whole if one member is past a limit.
- No migration, nothing stored. To undo: revert the PR.

#### 7. Left open

- **One `getClaims` per request: waiting on row 1 of "Waiting for George".** Not built, as the plan
  says (option 2 only if you decline asymmetric keys). Every API request still makes 2 Auth calls
  (the proxy's and the route's), a cold Home load 30. The numbers for the decision are in 4.
- **`/api/account` reads your `profiles` row three times** (currency, the password flag, the
  picture), at the same time, so it costs Supabase two calls but no waiting. One `select` of the
  three columns would fix it; I left it because it doesn't make anything sooner and changes three
  repository methods.
- **Server components don't get the memo.** It opens in `logRequest` and in MCP calls; a page that
  PF5 to PF7 renders on the server has neither, so there `getCurrentMember()` and the family are
  read on every call. Those tasks should wrap their loaders in `runWithRequestMemo`, or add
  `cache()` back for the server-component path.
- **The link prefetches' Auth calls** (16 of Home's 30) are PF8's.
- **The calendar's series-length count** (`withSeriesLengths`) still reads without paging. It
  can't reach the cap: 50 series per read at most 10 events each is 500 rows.
- **Pages after the first are read one after another.** A list of 3,724 rows takes 4 requests in a
  row (0.41 s at 40 ms). Once the first page gives the total, the rest could be asked for together;
  I left that for when a list that long is on a daily page (none is: the ledgers are a month).
- **Not done from the `/simplify` review:** clearing the whole memo on any write at the client
  layer instead of per write (Supabase's RPC reads are POSTs too, so a write can't be told from a
  read there); showing a 409's message in every `DataError` (no other read answers 409); one helper
  for "read cap + 1 and refuse" (two places, different messages).
