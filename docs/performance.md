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
| 1 | Move the Supabase project to asymmetric JWT signing keys (dashboard → JWT Signing Keys) | Removes one or two calls to Supabase Auth from every signed-in request, with no code change. Measured in the lab (PF1b): a cold Home load goes from 30 Auth calls to 0, and with 40 ms to Supabase its data appears about 0.23 s sooner on the lab's CPU-only pass | Plan, "Decisions for George"; PF4 below; "Signed-in lab baseline" |
| 2 | Agree or change the budgets | They decide what "fast enough" means for PF13. I'm using them as working budgets until you change them | "Proposed budgets" under "Baseline and budgets", and PF1 below |
| 3 | On the VPS, run `sudo scripts/perf-report.sh 5 expense-tracker-web` and the two delivery checks (streaming through the proxy, compression), and paste the output into the PR or send it to me | It is the real-use half of the baseline: Web Vitals per page, server time per route, Auth calls per request, whether the proxy streams. I have no access to production, so those cells say "not measured: needs the VPS" | "Real use" and "Delivery checks" under "Baseline and budgets" |
| 4 | Check whether "Add a kid" works in production, and decide the fix | The lab found that creating a kid account fails on a database built from the migrations (`permission denied for function my_kid_ai_permitted`, from the AI gate migration's profile trigger). If production has the same grants, nobody can add a kid. It needs a migration, which only goes live with your go-ahead | PF1b, "Left open"; [lab.md](lab.md), "What the lab found while seeding" |
| 5 | Optional: on the VPS, time its round trip to Supabase (one `curl`, read-only) | The lab's "realistic" delay, 40 ms, is from your laptop, not the VPS | [lab.md](lab.md), "The delay" |

## Progress

| Task | What | Status | PR |
| --- | --- | --- | --- |
| PF1 | Baseline and budgets | done, except the VPS numbers (row 3 above); the signed-in lab numbers came with PF1b | #226 |
| PF1b | A local lab: signed-in pages measured without touching live data | done, except the VPS's round trip to Supabase (row 5) | #227 |
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
