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

Things only you can do or decide, in the order I'd do them. Nothing here is marked done: a row leaves
this list only when you say you did it. None of them blocks anything that is merged.

| # | What | What it unblocks | Where it's explained |
| --- | --- | --- | --- |
| 1 | **The production measurement, as one sitting on the VPS,** at least 3 days after the last deploy (this phase's last deploy is the one that carries PF12): `sudo scripts/perf-report.sh 5 expense-tracker-web`, the two delivery checks (streaming through the proxy, compression) and PF12's read-only memory commands. The exact commands are in PF13 section 5, "Step 1" | Every cell below that says "not measured: needs the VPS": Web Vitals p75 per page (LCP, INP, CLS, FCP, TTFB), server p95 per route, Auth calls per request, whether the proxy streams, compression, and the web and worker containers' heap limit and memory. Until it runs, the phase's goals "LCP under 2.5 s", "INP under 200 ms" and "no route over 300 ms p95" are met in the lab only | PF13 section 4 and 5; "Real use" and "Delivery checks" under "Baseline and budgets"; PF12 section 5 |
| 2 | **The exposed commit `ae29d84`.** PF9 pushed this commit to the public repo: it carries five of your untracked drafts (`docs/bug-fixes-plan.md`, `docs/duolingo-styling-plan.md`, `docs/expense-tabs-and-subtypes-plan.md`, `docs/net-worth-plan.md`, `docs/ui-progress-2026-11-04.md`) next to PF9's own files. PF9 removed it from the branch before the merge, so `main` never had the drafts, but GitHub still serves the commit by its hash. I found no secrets in those five files and I did not check anything beyond that. Only GitHub Support can purge it: open a request at support.github.com for this repository with the hash and ask them to remove the commit and its cached views. If you'd rather leave it, the drafts are plans, not credentials | Nothing else waits on it; it is the one thing in this phase that can't be undone by a revert | PF13 section 7 |
| 3 | **Check whether "Add a kid" works in production, and decide the fix.** The lab found that creating a kid account fails on a database built from the migrations (`permission denied for function my_kid_ai_permitted`, from the AI gate migration's profile trigger). If production has the same grants, nobody can add a kid. The fix is a migration, which only goes live with your go-ahead | A working "Add a kid", if it is broken | PF1b, "Left open"; [lab.md](lab.md), "What the lab found while seeding" |
| 4 | **Move the Supabase project to asymmetric JWT signing keys** (dashboard, JWT Signing Keys). Best done after row 1, so the same report shows before and after | Removes one or two calls to Supabase Auth from every signed-in request, with no code change. Lab (PF13 section 4.2): a cold Home load goes from 11 Auth calls to 0 (30 before PF4 to PF8), every API request from 2 to 0, and with 40 ms to Supabase the first byte comes 90 to 106 ms sooner (Home 177 → 82 ms); the data on screen is 87 to 143 ms sooner, inside the noise. PF4's code alternative (one `getClaims` per request) and the link prefetches' Auth calls (PF8) stay unbuilt until you decide | Plan, "Decisions for George"; PF4; PF13 section 4 |
| 5 | **Agree or change the budgets** (the JS ones are in `docs/performance-budget.json`, which CI checks: edit the numbers there) | PF13 judges every budget against them; I used them as working budgets, and they stay so until you change them | "Proposed budgets" under "Baseline and budgets"; PF1; PF9; PF13 section 4 |
| 6 | **Decide whether to rewrite the "read someone else's finance rows" policies** (PF10 found it is the one slow database query, and no index fixes it) | Reading another family member's expenses costs 113 ms in the database for their dashboard (1,605 rows, one helper call per row); a rewritten policy costs 10 ms. It changes a policy on financial data and the pgTAP test that pins the policy's text, so it isn't in PF10. The route-level gain is small (about 75 ms on the family dashboard, none on your own pages) | PF10 sections 3 and 7 |
| 7 | Optional: after row 1, tell me whether any route is over 300 ms p95 or any page over its Web Vitals budget | It turns the "moves to phase 18" lines in PF13 section 4 into real tasks, ordered by what real use shows instead of by the lab | PF13 sections 4 and 7 |
| 8 | Optional: on the live project's SQL editor, run the one read-only `pg_stat_statements` query in PF10 section 5 and paste the output | The real query mix PF10 could only approximate in the lab. If a query there is slow, it gets its own index with a measured before and after | PF10 sections 5 and 7 |
| 9 | Optional: on the VPS, time its round trip to Supabase (one `curl`, read-only) | The lab's "realistic" delay, 40 ms, is from your laptop, not the VPS. If it is very different the lab numbers in this document shift | [lab.md](lab.md), "The delay" |
| 10 | Optional: say yes or no to five indexes on foreign keys the advisor flags (`todos.created_by`, `todos.completed_by`, `calendar_events.created_by`, `families.creator_id`, `app_flags.updated_by`) | They only matter when someone deletes an account. PF10 didn't add them because no slow query uses them; the SQL is in PF10 section 7 | PF10 sections 3 and 7 |
| 11 | Optional: decide whether the React Compiler goes in after all | PF11 tried it and dropped it. It made one interaction, dropping a to-do card, about four times faster (188 to 44 ms), and cost 5 to 7% more JavaScript on every page, 20 to 25% more build CPU, and may have made a rare hydration error on To-dos more common. Turning it on is one line in `next.config.ts` and one pinned dev dependency | PF11 sections 3 and 7 |

## Progress

| Task | What | Status | PR |
| --- | --- | --- | --- |
| PF1 | Baseline and budgets | done, except the VPS numbers (row 1 above); the signed-in lab numbers came with PF1b | #226 |
| PF1b | A local lab: signed-in pages measured without touching live data | done, except the VPS's round trip to Supabase (row 9) | #227 |
| PF2 | No endless loading | done | #228 |
| PF3 | Skeletons and a boundary per section | done, except the cold-load cost found (see PF3 section 7) | #229 |
| PF4 | Fewer round trips in the app | done, except one getClaims per request: waiting on row 4 | #230 |
| PF5 | Session gate and account on the server | done | #231 |
| PF6 | First data on the server for Home | done, except Lighthouse's simulated LCP (4.6 s; the observed slow-4G LCP is 1.4 s, see PF6 section 4) | #232 |
| PF7 | The same for Expenses, To-dos and Reminders | done | #233 |
| PF8 | Prefetching, waterfalls and stable data | done | #234 |
| PF9 | Smaller bundles | done, except Lighthouse's LCP on Home (still about 4.8 s, see PF9 section 4) and dnd-kit left in To-dos | #235 |
| PF10 | SQL: indexes and RLS for the slow queries | done, with no migration: the lab and the advisor found no index a slow query needs (see PF10 section 3); waiting on rows 6, 8 and 10 | #236 |
| PF11 | Smooth interaction | done, except the first open of a lazy sheet (about 250 ms on the 4x CPU, see PF11 section 4); React Compiler tried and dropped | #237 |
| PF12 | Lean runtime on the VPS | done, except the VPS numbers (the worker's heap limit is now 153 MB, the web container's stays on Node's own 432 MB, `preloadEntriesOnStart` stays on: it would save 23 MB, the bar is 50) | #238 |
| PF13 | Measure and close | done, except the production measurement (row 1) | #239 |
| PF13 follow-up | Expenses' first rows undimmed | done | #240 |
| PF13 follow-up | A time limit on the server's Supabase calls | done | #PRNUM |

## The short version

Phase 16 is done in the lab and **not yet measured in production**. Every number below is from the
lab on a laptop (a fake family, a copy of the backend, never the live project), measured again by
PF13 on `main` at `5329943`. None of it is a production number: the production half is one sitting
on the VPS (row 1 of "Waiting for George"), and until you run it, "fast" here means "fast in the lab".

**What you notice now**

- **Opening Home, Expenses, To-dos or Reminders on a slow phone.** On an emulated phone on slow 4G
  your data used to appear at 7.4 to 8.0 s, after the scripts and two round trips in a row. It now
  arrives with the page, at about **1.4 s** (Home 1.35, To-dos 1.37, Reminders 1.36). Expenses did
  show its first rows at about 1.4 s too, but dimmed until the scripts arrived (5.9 s): a side effect
  of PF11 that PF13 found. Fixed by #240: the rows are at full strength from the first paint (1.41 s).
- **Signed out.** A visit to any page is a redirect to the sign-in page from the server, with none of
  the app's code (PF5).
- **Tapping a tab** shows that page's skeleton about 60 ms later, and moving between Home, Expenses,
  To-dos and Reminders makes no request from the browser (PF3, PF8).
- **Nothing spins forever.** A page loaded in the browser says "taking longer than usual" at 8 s and
  shows an error with a retry at about 15 s (PF2). Since #PRNUM the server gives up on a Supabase call
  after 4 s too: with Supabase hung, a page loaded on the server shows its error with Try again at about
  8 s (it showed its skeleton for 75 s and more), and with the API failing, within about 4 s (was 10 to
  60 s). An outage of Supabase Auth is an error page now, not the sign-in page.
- **The page doesn't jump** (Home 0.156 to 0.000) and taps answer quickly: the month switch is 56 ms
  (was 1,040), Filters 184 ms (was 864) (PF11). The first open of the quick-add sheet is still 240 ms.
- **The code the browser needs before a page works** is 25 to 29% smaller on the four daily pages
  (Home 385.5 to 288.9 KiB gzipped) and CI now checks it on every build (PF9).

**Headline numbers (lab, median of three loads, slow 4G on the emulated phone, as the parent)**

| | Before (PF1b) | Now (PF13) | Command |
| --- | ---: | ---: | --- |
| Home, data on screen | 7,387 ms | **1,353 ms** | `npm run lab:measure -- /dashboard --user parent --runs 3` |
| To-dos / Reminders, data on screen | 7,528 / 7,366 ms | **1,365 / 1,359 ms** | the same, other pages |
| First-load JavaScript, Home (gzip) | 385.5 KiB | **288.9 KiB** | `npm run build && npm run size:routes -- --check` |
| Requests the browser makes for Home's data on a cold load | 6 | **0** | the same |
| Calls to Supabase Auth in a cold Home load (shared-secret keys) | 30 | **11** (0 with asymmetric keys) | the same, `npm run lab -- jwt asymmetric` |
| Calls to Supabase in a cold Home load | 49 | **24** (13 with asymmetric keys) | the same |

The full comparison, with the budgets and a pass or fail for each, is in PF13 section 4.

**What didn't work, or isn't fixed**

- Lighthouse's simulated LCP on Home is still 5.0 s at 40 ms to Supabase (0.9 s with none), though the
  observed LCP is 1.4 s: it simulates a streamed page badly. PF9's smaller bundles did not move it.
- The first open of a lazy sheet is 200 to 240 ms on a 4x slower CPU, just over the 200 ms bar.
- Insights, Investments, Net worth and Calendar still load in the browser: data at about 6.2 to 6.8 s
  on slow 4G, and Investments and Net worth jump (CLS 0.107 and 0.105, over 0.1).
- Every signed-in request still makes 2 Auth calls (a cold load 7 to 11) until the Supabase project
  moves to asymmetric signing keys (row 4).
- The React Compiler was tried and dropped (PF11). The SQL needed no index (PF10).

**What's left:** the VPS sitting (row 1), the exposed commit `ae29d84` (row 2), "Add a kid" in
production (row 3), the signing keys (row 4) and the budgets (row 5). Then the follow-up in PF13
section 7: the four pages still loaded in the browser (the server's time limit is done, #PRNUM). The one-line summary of each task:

| Task | In one line |
| --- | --- |
| PF1, PF1b | Baseline and budgets, and a local lab that times signed-in pages without touching live data |
| PF2 | A request that never answers ends in a slow notice at 8 s and an error with a retry at 15 s |
| PF3 | A skeleton the size of the content and an error screen for each section; Home stops jumping |
| PF4 | One wait fewer in a row on the data routes; long lists complete or refused |
| PF5 | The session check and the account come from the server: signed-out visits are a redirect, no `/api/account` |
| PF6, PF7 | Home, Expenses, To-dos and Reminders arrive with their data (7 s to 1.4 s on slow 4G) |
| PF8 | Moving between pages makes no request; a hydration error on To-dos fixed |
| PF9 | 25 to 29% less JavaScript before a page works, checked in CI |
| PF10 | No index needed; the one slow query is a policy helper, left as a decision (row 6) |
| PF11 | Month switch 1,040 to 56 ms, Filters 864 to 184 ms; the compiler tried and dropped |
| PF12 | The worker's heap limit now below its container's; the web container's left alone |
| PF13 | This comparison, the smoke test and the closing notes |

## Baseline and budgets

Written by PF1 on 9 November 2026, on commit `18e1719` plus PF1's own files (it changes no app
code). Every number below is one of three kinds, and says which:

- **measured**: I ran the command next to it;
- **from the code**: counted by reading the code (file and line given), not by running it;
- **not measured: needs the VPS**: it can only come from production, so there's a command for you
  to run (row 1 of "Waiting for George").

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
`getClaims()` still has to ask Auth [S3][S4]. This is row 4 of "Waiting for George".

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
| Time a signed-in cold load in a real browser, the same way every time, before and after a change | Say what real phones on real networks get: that's the production logs (`scripts/perf-report.sh`, row 1 of "Waiting for George") |
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
  title (since PF6: the month's total, one of the five newest expenses, a reminder's or an open
  to-do's title, because PF3 made the card's title part of the skeleton); Expenses, the description of one of this month's expenses; To-dos, an open card's title;
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

**Proposed by PF1, and used as working budgets until George changes them** (row 5 of "Waiting for
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
   (row 1 of "Waiting for George"), and send me the output.
6. Look at the budgets (row 5) and say if any should change.

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
  streams, whether it compresses. They're waiting on row 1 of "Waiting for George", and the
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

- **"Add a kid" is probably broken in production** (row 3 of "Waiting for George"; details in
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
  request. Removing them is the signing-keys decision (row 4 of "Waiting for George"); the code
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
  older `main`. This is the case for row 4 of "Waiting for George".

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

- **One `getClaims` per request: waiting on row 4 of "Waiting for George".** Not built, as the plan
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

### PF5: The session gate and the account on the server

#### 1. The problem

- **A signed-out visitor downloaded the app only to be told to sign in** (audit P12). Opening
  `/dashboard` without a session answered 200 with a grey loading screen, then 64 script files
  (432 KiB), then the app asked `/api/account` ("who am I?"), got a 401, and only then went to the
  sign-in page: 82 requests and 610 KiB to reach a form.
- **Every signed-in cold load started blank and waited for "who am I?".** The layout above every
  page was a browser component. On the server it could only draw that text-free grey screen; in
  the browser it asked `/api/account` after all the scripts had run, and drew the shell and the page
  only when the answer came. On the emulated phone the first text (FCP, the moment any text first
  appears) came at about **7.2 s**, after 48 requests had finished. PF3's skeletons couldn't help,
  because this screen came before them.

#### 2. What changed

**What a person notices**

- **Signed out:** any signed-in page (and `/`) answers with a redirect to
  `/login?next=<that page and its query>` straight from the server: no app code, no "Checking…"
  screen first. The browser downloads only the sign-in page.
- **Signed in, cold load:** the shell (sidebar or bottom bar, your name and picture) and the page's
  skeleton come in the first answer from the server. On the emulated phone the first text appears at
  **1.4 s instead of 7.2 s**, and the data lands 0.4 to 0.8 s sooner than before. On a fast network
  with a slow phone CPU the data lands 0.1 to 0.3 s *later* (4 explains why).
- **No `/api/account` request on a cold load.** The account comes with the page.
- **A password that must be changed** (a kid's first sign-in, or after a parent reset it) sends you
  to `/change-password` from the server, before the page shows.
- **Signing in, signing out, deleting your account and choosing a new password now end with a full
  page load** instead of a move inside the app. Without it, signing out and back in on the same tab
  could get stuck bouncing between the sign-in page and Home (found in the lab, 3 below).
- Loaded screens look the same as before; the first screen is now the shell with PF3's skeleton
  instead of the grey loading screen (screenshots in 4).

**How it works**

- `src/app/(app)/layout.tsx` is now a **server component**. It reads the session the same way
  `withUser` does (`getAuthenticatedUser`), then the account. No session → `redirect` to
  `/login?next=…`; `mustChangePassword` → `redirect("/change-password")`; otherwise it renders
  `AppShellClient` with the account.
- `src/lib/account/load-account.ts` (new): `loadAccount(user)` is the account response, moved out of
  `src/app/api/account/route.ts`, which now calls it (its tests are unchanged and pass).
  `loadPageAccount()` is the same for a server component: signed-in user's account, or `null`.
- `asPageCaller(fn)` (new, `src/lib/auth/index.ts`): runs a server component's reads as the
  request's cookie session inside `runWithSupabaseClient`, which gives it PF4's once-per-request memo.
- `src/app/(app)/app-shell-client.tsx` (new, browser): puts the account in SWR's `fallback` under
  `/api/account`, so `useAccount()` has it on the first render everywhere under the layout, and
  draws `AppShell` and the account-notice dialog from it. It keeps the old layout's client-side
  redirect to `/change-password` for an account that is loaded again while the app is open.
- `src/hooks/use-account.ts`: a hook that mounts while SWR's only copy of the account is the
  server's, less than 15 s after the page loaded (SWR's own dedupe window, now one constant,
  `DEDUPING_INTERVAL_MS` in `src/lib/api/client.ts`), doesn't ask `/api/account` again. Later
  mounts revalidate as before.
- `src/proxy.ts` puts the page's path and query on the request as `x-page-path` (overwriting any the
  client sent), because a layout isn't given the URL. `src/lib/http/page-path.ts` drops Next's
  `_rsc` parameter. The layout builds `next` with `loginUrl` (`src/lib/api/auth-redirect.ts`), which
  runs PF2's `safeNextPath`: anything that isn't a same-site path becomes `/dashboard`.
- `src/app/page.tsx` (`/`) is a server component that redirects to `/dashboard`; the layout there
  decides between the app and sign-in.
- `loadAfterSessionChange(path)` (new, `src/lib/api/auth-redirect.ts`) moves with a full page load.
  The sign-in form and the sign-in page (for a visitor who is already signed in), sign-out, "Sign out
  everywhere", account deletion, the change-password page and the shell's own password redirect use
  it instead of `router.replace`. `afterSignIn` and `afterPasswordChange` (`src/lib/api/invalidate.ts`)
  are gone: they only patched SWR's cache for a move inside the app, and a full load starts with an
  empty cache.
- **The hand-written `router.prefetch` list is gone** (`/dashboard`, `/expenses`, `/investments`,
  `/net-worth`, `/settings`). The links prefetch the sections they show, since PF3 gave every
  section a `loading.tsx`.
- Tests: `layout.test.tsx` (every redirect case, and that the layout's account equals what
  `GET /api/account` answers for the same data), `app-shell-client.test.tsx` (the shell and a page
  render with a fetcher that fails if `/api/account` is asked for; it asks again once the server's
  copy is older than 15 s; an account SWR already has wins over the server's; a reloaded account
  that must change its password redirects), `load-account.test.ts`, `page.test.ts`,
  `page-path.test.ts`, and additions to `proxy.test.ts`, `auth-redirect.test.ts` and
  `src/lib/auth/index.test.ts`. `src/test/redirect.ts` mocks `next/navigation`'s `redirect`.
- `scripts/lab/session-gate.mjs` (new): the lab probe behind the checks in 4. `measure.mjs` now
  exports its Chrome, DevTools and sign-in helpers for it.

#### 3. Why this way

- **The plan's design, checked against the installed docs.** The layout awaits the account because
  the redirects depend on it. A layout's own data holds up the first byte and isn't covered by
  `loading.js` (`layout.md`, "Interaction with loading.js"; `authentication.md`, "Auth and
  streaming"), but a layout doesn't render again on client navigation (`authentication.md`,
  "Layouts and auth checks"), so only a cold load pays. In the lab that is about 110 ms of server
  time (one Auth call, then the four account reads side by side, at 40 ms each).
- **The gate isn't the only check, by design.** The same doc warns that a layout check doesn't run
  on every navigation and doesn't stop the pages under it from rendering. Here every page's data
  comes from API routes that check the session themselves; a 401 sends the browser to sign in
  (PF2) and a 403 `password_change_required` to `/change-password`. The pages under the layout are
  browser components with no data of their own on the server, and Investments and Net worth only
  wrap browser panels, so a page that renders while the layout redirects has nothing private in it.
- **One loader for the route and the layout** (plan, Design 2; `swr.md`, "Provide initial data from
  a Server Component"): the layout's account is exactly what `/api/account` would have answered, so
  the same rules apply to a kid, a removed member, a deleted account and an expired session. The
  layout test compares the two for each case.
- **The account as a value in `fallback`, not a promise.** The SWR guide passes unawaited promises;
  here the layout has already awaited the account to decide the redirects, so there is nothing left
  to stream.
- **Skipping the first revalidation.** The SWR guide's default is to treat fallback data as stale
  and fetch again after hydration. That would be one `/api/account` request (2 Auth calls, 4 reads)
  per cold load to re-read what the server read a moment earlier. `revalidateIfStale: false`
  everywhere (an option the guide names) would also stop the account from refreshing when you open
  another page later, which is how a removed member or changed permissions show up today. So the
  skip is limited to "SWR has only the server's copy and the page is less than 15 s old": the same
  freshness SWR gives any answer it fetched itself.
- **A full page load across every change of session.** Running the lab's sign-out-and-in check four
  times, two runs got stuck: `/dashboard` → `/login?next=%2Fdashboard` → `/dashboard`… about 16
  times a second, with an empty page. The trace showed why. In the moment between the sign-out
  request and leaving the page, the router prefetched `/dashboard` and `/more` from the links on
  screen; the server, seeing no session, answered both with the layout's redirect to sign in, and
  the router kept that answer. After signing in, `router.replace("/dashboard")` followed the kept
  redirect without asking the server, the sign-in page saw an account and sent the browser back,
  and so on. Before PF5 the layout never redirected on the server, so a page prefetched while signed
  out was harmless. Next's own guide signs out with a Server Action, which clears the router's cache
  by itself; this app signs in and out through route handlers, which don't. A full page load is the
  one way that drops the router's memory whatever is in it, and it also keeps the last person's
  account (now part of the page the router keeps) from coming back on Back. Turned down:
  `router.refresh()` (its docs say it clears the current route only, not the prefetched ones).
- **The path in a header.** Layouts don't get the URL (`layout.md`). The alternative, deciding the
  redirect in the proxy, would need the proxy to know which paths are signed-in pages (route groups
  aren't in the URL) and would split the gate in two places.
- **`/` always goes to `/dashboard`.** Checking the session there too would cost one more Auth call;
  a signed-out visitor now goes `/` → `/dashboard` → `/login?next=%2Fdashboard`, which ends in the
  same place.
- **Dropping `router.prefetch`** (plan): the links already prefetch the sections they show, and
  PF3 found the hand list was where the extra 58 KB came from (`/investments`, `/net-worth` and
  `/settings` aren't linked from the phone's bottom bar, so their panel code came only from it).
- **Turned down:** reading only the user and the password flag before deciding, and streaming the
  rest (the shell needs the name, the picture and the membership to draw anything, so nothing would
  paint sooner); checking the session in the proxy instead of a second `getClaims` (waits on row 4,
  as the brief says).

#### 4. Numbers

All from the lab on George's laptop, 10–11 November 2026, with the shared-secret JWT like
production and 40 ms added to every call to Supabase (`npm run lab -- delay 40`). "Before" is `main`
at `618fee4`, "after" this branch. Medians of three cold loads; ± is half the spread. **Not
production numbers.** "Slow 4G" is the lab's emulated phone (`docs/lab.md`); "CPU only" keeps the
phone's 4× slower CPU but not the slow network, which is where server time shows.

```bash
npm run lab -- up && npm run lab -- delay 40
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3 --no-lighthouse
npm run lab:measure -- /dashboard /expenses /todos /reminders --user kid --runs 3 --no-lighthouse
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3 --throttle cpu --no-lighthouse
npm run lab:measure -- /dashboard /expenses /todos /reminders --user kid --runs 3 --throttle cpu --no-lighthouse
```

The tables below are read from the runs' JSON (`.lab/results/<time>-pf5-<before|after>-…/runs-*.json`):
`observed.fcp`, `observed.lcp`, `observed.settled` and `observed.content`, and `server.routes`.

**Slow 4G, parent, ms** (before → after):

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| FCP, the first text | 7,212 → **1,412** | 7,588 → **1,428** | 7,364 → **1,400** | 7,244 → **1,412** |
| LCP, the biggest thing on screen | 7,848 → **7,148** | 8,652 → **8,276** | 7,364 → **1,400** | 7,244 → **1,412** |
| Data on screen (every placeholder gone) | 7,906 → **7,546** | 8,545 → **8,167** | 8,057 → **7,643** | 7,866 → **7,049** |
| Requests finished before the first text | 48 → **3** | 52 → **3** | 49 → **3** | 48 → **3** |

**Slow 4G, kid, ms:**

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| FCP | 7,236 → **1,420** | 7,656 → **1,400** | 7,388 → **1,408** | 7,264 → **1,412** |
| LCP | 7,872 → **7,120** | 8,364 → **7,852** | 7,388 → **1,408** | 7,264 → **1,412** |
| Data on screen | 7,860 → **7,495** | 8,280 → **7,468** | 8,065 → **7,624** | 7,804 → **6,971** |

**CPU only, ms** (parent; kid in brackets):

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| FCP | 1,060 → **340** (1,052 → 344) | 1,136 → **328** (1,120 → 324) | 1,052 → **324** (1,056 → 324) | 1,048 → **340** (1,040 → 324) |
| LCP | 1,228 → 1,440 (1,244 → 1,376) | 1,356 → 1,628 (1,424 → 1,720) | 1,052 → **324** (1,056 → 324) | 1,048 → **340** (1,040 → 324) |
| Data on screen | 1,286 → 1,416 (1,254 → 1,383) | 1,727 → 1,963 (1,357 → 1,646) | 1,325 → 1,428 (1,309 → 1,419) | 1,253 → 1,383 (1,215 → 1,336) |
| Total blocking time | 4 → 215 | 730 → 1,231 | 98 → 308 | 41 → 244 |

**Per cold load, both users and both passes** (the counts didn't vary):

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| `/api/account` requests | 1 → **0** | 1 → **0** | 1 → **0** | 1 → **0** |
| Calls to Supabase Auth | 30 → **23** | 29 → **22** | 26 → **19** | 22 → **15** |
| All calls to Supabase | 49 → **42** | 48 → **41** | 40 → **33** | 33 → **26** |
| Link prefetches (`?_rsc=`) | 16 → **10** | 13 → **7** | 14 → **8** | 12 → **6** |
| JS on the wire, KiB | 491.5 → **433.1** | 494.4 → **454.1** | 505.6 → **445.1** | 484.5 → **425.0** |
| The page itself (gzipped / unzipped), KiB | 15.8 / 80 → 23.2 / 143 | 16.0 / 80 → 26.7 / 182 | 15.9 / 80 → 23.3 / 142 | 15.9 / 80 → 23.4 / 143 |
| Time to the page's first byte (TTFB), ms | 61 → 168 | 59 → 174 | 56 → 164 | 59 → 168 |

What it says:

- **The first text comes 5.8 s sooner on the slow phone** on every page, for both users: it is in
  the first answer now, and only the stylesheet and a font have to arrive before it paints. On
  To-dos and Reminders the biggest thing on screen is the subtitle in the skeleton, so LCP moves the
  same 5.8 s.
- **The data comes 0.36 to 0.83 s sooner on the slow phone** (Reminders most), mostly because
  `/api/account` no longer has to come and go first.
- **On a fast network with a slow CPU the data comes 0.10 to 0.29 s later, and LCP on Home and
  Expenses with it.** I looked at the request timings: the shell's own requests start about 60 ms
  *sooner* than before, but the page's data requests start 70 to 290 ms later (Expenses: 1,019 →
  1,276 ms). The page now arrives drawn by the server and has to be hydrated (React attaching itself
  to it) before its effects send the requests; before, React drew it from nothing right after
  `/api/account` answered, which on this pass happened earlier. The blocking time grew for the
  same reason (hydrating a full page is one long task). PF6 and PF7 start the data on the server,
  which takes these requests out of the browser's hands altogether.
- **7 fewer Auth calls per cold load**: −2 for `/api/account`, +1 for the layout's own check (the
  proxy has already checked once; asymmetric keys, row 4, would make both free), and −6 from the
  prefetches: the hand-written list's three sections that no link on the phone's screen points to
  (Investments, Net worth, Settings), each fetched twice. A prefetch doesn't render the layout again: the
  Supabase calls add up to exactly the page, the API requests, the prefetches' proxy checks and one
  browser report.
- **58 to 60 KiB less JavaScript per cold load**, the same size PF3 found the section prefetches
  added (57.9 KiB). This is the `router.prefetch` list: nothing else here changes what scripts load.
- **The page itself is about 7 to 11 KiB bigger on the wire** (the shell and the skeleton are in
  it), and its first byte comes about 110 ms later (the layout's Auth call and account reads).
- CLS (how much the page jumps) is unchanged except Expenses for the parent, 0.014 → 0.023: PF3
  measured 0.023 too, so the "before" here was the low one.
- **Home's "content" marker isn't a data string any more**: since PF3 the month card's title
  "Spent in November" is drawn before its amount, and now it is in the first HTML. So for Home I
  give "every placeholder gone" above; the marker says 7,106 → 1,354 ms, which is the title.

**Signed out, `/dashboard`** (Lighthouse 13.6.0, mobile preset, three runs, all three identical
except FCP ±3 ms):

```bash
npx lighthouse@13.6.0 http://localhost:3110/dashboard --only-categories=performance --output=json \
  --output-path=dashboard-1.json --chrome-flags="--headless=new --no-sandbox" --quiet
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3110/dashboard
```

| | Before | After |
| --- | ---: | ---: |
| First answer | 200, the app's loading screen | **307 to `/login?next=%2Fdashboard`** |
| Requests | 82 | **32** |
| Scripts | 64 files, 432.4 KiB | **22 files, 296.4 KiB** (the sign-in page's own) |
| Everything transferred | 610 KiB | **425 KiB** |
| App code from the signed-in pages (`app/(app)/…` chunks) | yes | **none** (`session-gate.mjs`) |
| Lighthouse FCP / time to interactive | 1,520 / 6,104 ms | 1,063 / 3,974 ms |

Every signed-in page answers the same way signed out: `curl` gave a 307 to `/login?next=<path>`
for all ten sections (`/` answers 307 to `/dashboard`, which then does the same; the query is kept: `/expenses?month=2026-10` →
`/login?next=%2Fexpenses%3Fmonth%3D2026-10`). The redirect's body is Next's own error shell, which a
browser doesn't read on a 307.

**Every case of the gate, checked for real** (`node scripts/lab/session-gate.mjs --width 1280`, then
`--width 390 --writes`; cold loads in headless Chromium, lab server in UTC as production's container
is, after midnight Bucharest time, so server and browser were on different dates; run on the first
build and again on the final one):

| Case | Where it ended | Unit test |
| --- | --- | --- |
| Signed out, each of the ten sections and `/` | 307 → `/login?next=<page>` (`/` goes through `/dashboard`), 21 to 22 scripts, all the sign-in page's, no `(app)` code | `layout.test.tsx`, `page.test.ts` |
| A damaged session cookie (what an expired session whose refresh failed looks like) | 307 → `/login?next=%2Fexpenses%3Fmonth%3D2026-10` | `layout.test.tsx` (no user) |
| A session ended from another device ("sign out everywhere" from a second sign-in) | 307 → `/login?next=%2Ftodos` | same |
| A kid whose password a parent just set (a kid's first sign-in), on `/dashboard` and `/reminders` | 307 → `/change-password` | `layout.test.tsx`, two cases |
| The same kid after choosing a password | `/dashboard`, the shell | `layout.test.tsx` |
| A member removed from the family (Sam) | `/dashboard`, the shell, and the "You were removed from the family The Example Family" dialog | `layout.test.tsx` (no membership, same as the route) |
| A deleted account (Casey), visiting with the cookies it had | 307 → `/login?next=%2Fdashboard` | `layout.test.tsx` (no user) |
| The parent and the kid on each of the ten sections, 390 and 1280 px | the section, no `/api/account` request | `app-shell-client.test.tsx` |
| Signing out and in as the kid in the same tab, through the buttons | before the full loads: 2 of 4 runs stuck in a `/login` ↔ `/dashboard` loop (3); after: 7 of 7 runs ended on the kid's More page naming `robin.lab` (2 with the probe, 5 with a trace script that isn't in the repo; a sixth trace run printed nothing, because that script didn't guard against the page reloading under it) | `auth-redirect.test.ts` (full load); `app-shell-client.test.tsx` (SWR's answer wins over the server's copy) |
| A database failure while reading the account | not checked in the lab | `layout.test.tsx`: it throws to the error boundary, neither redirects nor renders |

**The browser console on every one of those loads:** no errors and no warnings, so no React
hydration errors and no CSP report-only violations (the nonce still reaches next-themes' and Next's
scripts; S14 hasn't switched to enforcing yet). The only line is on the sign-in page: its own
"Checking your session…" asks `/api/account` and gets the 401 it expects, as before.

**Screenshots** (after; 390 and 1280 px, the server's first screen with every data request held,
and the loaded page), in `docs/performance/screenshots/pf5/`, named
`after-<page>-<width>-<loading|loaded>.jpg`: [Home, 390, first screen](performance/screenshots/pf5/after-dashboard-390-loading.jpg) ·
[Home, 1280, loaded](performance/screenshots/pf5/after-dashboard-1280-loaded.jpg) ·
[Expenses, 1280, loaded](performance/screenshots/pf5/after-expenses-1280-loaded.jpg).
They match PF3's `after-…` screenshots apart from the data (the seed moved a day). There is no
"before" picture of the old grey screen: it is the one PF1 describes ("Opening your ledger…", grey
boxes, no visible text).

Checks: `npm run lint`, `npx next typegen && npm run typecheck`, `npm test` (6,873 passed),
`npm run build`: all pass.

#### 5. How to check it yourself

1. `npm run lab -- up`.
2. Signed out: `curl -sI http://localhost:3110/expenses?month=2026-10` shows
   `307` and `location: /login?next=%2Fexpenses%3Fmonth%3D2026-10`. In a private window, open
   `/dashboard` with the network panel open: only the sign-in page's files load.
3. Sign in (`.lab/users.json`), then reload Home with the network panel open: no `/api/account`
   request, and the shell and skeleton are in the page's own HTML.
4. `node scripts/lab/session-gate.mjs` prints every case above, one JSON line each; `--writes` adds
   the kid's first sign-in, a removed member and a deleted account (it changes the lab's data, so
   run it last).
5. `npm run lab -- down`.

#### 6. Risks and how to undo it

- **This layout decides who sees the app.** A mistake here locks people out or lets a page render
  for the wrong person. The cases are in 4, each checked in the lab and in a unit test. Even if the
  gate failed open, every request for data still checks the session itself.
- **A cold load's first byte now waits for the account** (about 110 ms in the lab: one Auth call
  and the reads). If Supabase is slow, the whole first screen waits; before, the grey screen came
  at once and the wait came later. If the account can't be read at all, the page shows the root
  error screen ("We couldn't load this page", Try again) instead of the layout's own error. That
  should be what happens: the unit test shows the layout throws, but I didn't break the database in
  the lab to watch it.
- **Hydration is now a long task** on every cold load (blocking time +100 to +500 ms on the 4×
  CPU), and on a fast network with a slow CPU the data comes 0.1 to 0.3 s later (4). A component that
  draws something different on the server and in the browser (the clock, local time zones) would now
  show a hydration error; none did in the lab, with the server in UTC.
- **Signing in and out are full page loads now.** Each costs a page load where it was a move inside
  the app (on the phone, sign-in now lands on a cold load of Home: 1.4 s to the first text in the
  lab, 4). If a place that changes the session is added later and moves with `router.replace`, the
  loop in 3 can come back; `loadAfterSessionChange` says why in its comment.
- **The 15 s skip of the account's first refresh depends on `performance.now()`** being the time
  since the page loaded, which it is in every browser. If it weren't, the account would be
  refreshed on mount as before, which is safe.
- **Sections no link on screen points to aren't prefetched any more.** On a phone, Investments, Net
  worth and Settings are reached through More or the Money tabs, whose links prefetch them once they
  are on screen. A tap that beats that prefetch should wait for the server before the skeleton
  shows; I didn't measure it.
- No migration, nothing stored. To undo: revert the PR.

#### 7. Left open

- **The layout's Auth call is the proxy's twice over.** The proxy checks the session, then the
  layout checks it again: with the shared-secret JWT that is two Auth round trips before the first
  byte. Asymmetric keys (row 4) make both free; passing the proxy's answer on is the workaround the
  brief said not to build.
- **The CPU-only slowdown in 4** is for PF6 and PF7, which start each page's data on the server.
- **Whether production's proxy streams** (row 1) still isn't known. PF5's gain doesn't depend on
  it: the layout sends the page in one piece once the account is read. PF6 and PF7's will.
- **No request line for a page render.** The layout's Supabase calls (one Auth call, four reads)
  show in the delay proxy's log in the lab, but in production they appear in no `request` line:
  those are written only for API requests. `/api/account` used to log them. A line per page render
  would need a request context for server components; I didn't add one.
- **`/api/account` still reads your `profiles` row three times** (PF4's note); it is now on the
  first-byte path of every cold load, side by side, so it costs Supabase calls but no wait.
- **The sign-in page still asks `/api/account` on every visit**, to send an already signed-in
  visitor on. A server check there would remove the 401 on every signed-out visit; it wasn't in
  this task.
- **Not done from the `/simplify` review:** `revalidateIfStale: false` for the account (it would
  stop the refresh on page changes, see 3); moving the session check to React's `cache()` instead of
  `asPageCaller` (PF4 chose `AsyncLocalStorage` for one memo across route handlers, MCP and pages);
  writing the server's account into SWR's cache on every server render (it would refetch at once).
- **No lint rule.** Nothing the review found is a pattern a syntax rule can check: the duplicated
  constant is now one, and the lab scripts' copied helpers are now imports. The sign-in loop isn't
  either: `router.replace("/login")` is right for a visitor who was never signed in (the invite and
  consent pages do it) and wrong after signing out, and only the code around it says which.

### PF6: First data on the server for Home

#### 1. The problem

After PF5, opening Home showed the shell and four grey cards at once, but the numbers came much
later: the browser first had to download and run the app's scripts, and only then asked
`/api/dashboard`, `/api/reminders` and `/api/todos`. On the emulated phone the month's total
appeared at **6.8 s**, five and a half seconds after the first text. On a fast network with a slow
phone, PF5 had even made the data **0.1 to 0.3 s later**, because the requests now waited for React
to attach itself to the server's page (hydration) before they could start.

#### 2. What changed

**What a person notices**

- **Home arrives with its numbers.** The month's total, the five newest expenses, what's due and the
  to-dos are in the page the server sends. On the emulated phone they are on screen at **1.36 s
  instead of 6.77 s** (the same moment as the first text); with a fast network and a slow phone, at
  **0.3 to 0.7 s instead of 1.37 s**.
- **No request for Home's data on a cold load.** The browser no longer asks `/api/dashboard`,
  `/api/reminders` or `/api/todos` when Home opens (the nav badge's `/api/reminders/summary` and
  the account notices still go, as before).
- **Nothing jumps.** The page's layout shift on the emulated phone is now 0.000 (was 0.012 for the
  parent and 0.085 for the kid), because the grey cards are gone before anything paints.
- **A kid without the expenses permission gets no expense data in the page at all**, not even
  hidden: the server never loads it.
- Home looks the same as U7's signed-off screens (screenshots in 4). Moving to Home from another tab
  also gets the data from the server, in the same answer as the page.

**How it works**

- `src/app/(app)/dashboard/page.tsx` is now a **server component**. It reads which blocks this person
  has (`homeBlocks`, the rule the browser uses: spending needs the expenses permission, to-dos a
  family), **starts** one load per block without waiting for it, and hands the unfinished loads to
  the page as SWR's `fallback` (`loadHomeFallback`, `src/lib/home/load-home.ts`).
- **Loaders** (`src/lib/expenses/load-dashboard.ts`, `src/lib/reminders/load-reminders.ts`,
  `src/lib/todos/load-todos.ts`) return exactly what `GET /api/dashboard`, `/api/reminders` and
  `/api/todos` answer for a query. The three routes now call them; their tests are unchanged and pass.
- `prefetch(page, key, loader)` (`src/lib/server-prefetch.ts`) runs a loader as the signed-in user
  with the key's own query. If it fails, it logs `server_prefetch_failed` (the page and the API path,
  never the data) and leaves that key to the browser, which fetches it as before.
- **Keys**: the page builds them with the same functions the blocks use. Home's month key is now one
  function, `homeDashboardApiKey()` in `src/lib/api/keys.ts`, read on the application's calendar.
- **In the browser** (`src/lib/api/server-fallback.tsx`): `ServerFallback` puts the server's loads in
  SWR's `fallback`. The blocks' hooks (`useHomeDashboard`, `useReminders`, `useTodoBoard`) now use
  `useServerFirstSWR`, which is `useSWR` plus two things while the copy on screen is the server's:
  it doesn't ask again on mount while that copy is under 15 s old, and it writes the copy into SWR's
  cache, so Done, Snooze and a new expense change it like any answer SWR fetched. Later visits,
  focus and polling revalidate as before. The To-dos and Reminders pages use the same hooks; with no
  server copy there, they behave exactly as `useSWR`.
- **Each block streams on its own**: `HomeScreen` wraps each one in a `StreamedSection`
  (`src/components/ui/streamed-section.tsx`), a `<Suspense>` whose fallback is the block's loading
  card (`MonthCardPending`, `DueRemindersPending`, `RecentExpensesPending`, `FamilyTodosPending`,
  each a `HomeBlockPending` in `home-skeleton.tsx`, and each also the block's own "no data yet"
  branch). The greeting and the date are outside every boundary.
- **The layout and the page share one request's reads**: `asPageCaller` now keeps one cookie client
  and one memo per server render (React's `cache`), and `loadPageAccount` is cached the same way, so
  the page reuses the layout's user, membership and account instead of reading them again.
- `/dev/preview` and the quick-add test render Home's screen (`HomeScreen`) instead of the page,
  which now needs a server.
- New lint rule `local/streamed-section` (3) and a lab probe, `scripts/lab/first-render.mjs` (5).
  `scripts/lab/measure.mjs`'s Home marker now waits for real data (4).

#### 3. Why this way

- **The plan's pattern, from the installed Next docs** [N1]: a server component passes unawaited
  promises as SWR's `fallback`, and the client components keep their `useSWR` keys. Every optimistic
  update and undo from phase 17 still works on the same cache entries.
- **The SWR spike** (done first, recorded at the top of `load-home.ts`): with SWR 2.4.1, a
  component calling plain `useSWR(key)`, without `suspense: true`, waits for a promise in
  `fallback` (SWR calls React's `use()` on it whatever `suspense` says). In a production build in
  the lab, the server sent the boundary's fallback, then streamed the component with the data when the
  promise resolved. So the blocks didn't change, only got boundaries. The spike also showed the two
  things that needed code: right after hydration SWR asked for the key again, and a promise that
  resolved to nothing left the key to the browser (which is how a failed load falls back).
- **Skipping the first revalidation, like PF5's account, but not the same code.** Fallback data is
  stale to SWR, so without the skip every cold load would still send the three requests, just
  later. PF5's rule ("only the server's copy, page under 15 s old") wasn't enough here, for two
  reasons found in the lab and the tests: the copy's age has to count from when it reached the
  browser (a move to Home from another tab brings a new copy long after the page loaded), and once
  one block wrote the copy into SWR's cache, the block that hydrated after it saw "cached data" and
  asked again (the kid's and the solo user's Home sent `/api/dashboard` that way before the fix). So
  `useServerFirstSWR` remembers when each server copy arrived. Writing the copy into the cache is
  needed because SWR never stores fallback data: a write's `mutate(current => …)` would start from
  nothing, so marking a reminder done would have shown an empty list for a moment. I left
  `useAccount` as PF5 made it: its writes only refetch, so it doesn't have that problem, and changing
  it would change PF5's tested behaviour.
- **`StreamedSection` instead of a bare `<Suspense>`** (found in the lab, not in the plan). The first
  build had a layout shift of **0.34** on the emulated phone, 6.2 s after load. A probe showed every
  card's padding change at hydration. The cause: Chakra's styles are Emotion's, written as `<style>`
  tags next to the elements, and Emotion writes each rule once per cache. The loading card wrote the
  card's rules first; the streamed content, under the same cache, didn't write them again; when the
  content replaced the card, the card's `<style>` tags were removed with it, and the content had no
  padding until the page hydrated. In the HTML, each streamed block used 9 to 14 classes it didn't
  define. `StreamedSection` gives the content its own Emotion cache on the server (Emotion makes one
  when the context holds `null`; the browser keeps its single cache), so each block carries every rule
  it uses: CLS went to 0.000 and no console warnings. Emotion's own source comment says this "could
  change in the future because of suspense". Turned down: waiting for all the data before sending
  the page (no boundaries, so nothing to lose, but the slowest load would hold the whole page,
  against the plan [N4]); putting Emotion's styles in `<head>` with a style registry
  (`useServerInsertedHTML`), the cleaner fix, but it needs `@emotion/cache` as a new direct
  dependency, which this phase doesn't add, and it changes how every page gets its styles. Worth a
  look in PF9.
- **The lint rule**: a bare `<Suspense>` with a fallback is exactly what a machine can spot, and PF7
  will add more boundaries. It covers `src/components` and the `*-client.tsx` page bodies PF7 will
  create. The 8 `useSearchParams` boundaries in today's page files never show their fallback on the
  server, so they are outside its files for now (docs/lint-rules.md).
- **Permissions on the server are the browser's rule plus the route's check.** The page decides the
  blocks with `homeBlocks(account)`, the same function `useHomeBlocks` now uses, so the server loads
  exactly what will be drawn; the dashboard loader also runs `requirePermission("expenses", "edit")`
  itself, the route's own check (free in the route: the membership is already in the request's memo).
- **The memo through React's `cache`.** PF4's memo is an `AsyncLocalStorage` store that a route
  request enters once; a page render has no single entry point (the layout and the page are rendered
  separately), so each `asPageCaller` call used to start a new memo. React's `cache` lasts one server
  render, so it finds the render's memo. Without it the page would have asked Supabase Auth for the
  user a second time.
- **Logging**: `server_prefetch_failed` at `error`, as the plan says. I didn't add a request line for
  page renders (as PF5 didn't): it needs a request context for server components, and the loaders'
  calls are the same queries the API routes log when the browser asks.

#### 4. Numbers

All from the lab on George's laptop, 11 November 2026, shared-secret JWT like production and 40 ms
added to every Supabase call. "Before" is `main` at `f004404` (PF1–PF5), "after" this branch's final
build (after `/simplify`; a build before it measured the same within the spread); both builds
measured with this branch's `measure.mjs` (its Home marker fixed, below). Medians of three cold
loads, ± half the spread. **Not production numbers.**

```bash
npm run lab -- up && npm run lab -- delay 40
npm run lab:measure -- /dashboard --user parent --runs 3                                  # slow 4G + Lighthouse
npm run lab:measure -- /dashboard --user kid --runs 3
npm run lab:measure -- /dashboard --user parent --runs 3 --throttle cpu --no-lighthouse    # fast network, 4x slower CPU
npm run lab:measure -- /dashboard --user kid --runs 3 --throttle cpu --no-lighthouse
```

Read from each run's `summary.json` (`.lab/results/<time>-pf6-<before|after>-…`).

**Home, slow 4G (the emulated phone), ms**, parent (kid in brackets):

| | Before | After |
| --- | ---: | ---: |
| Real data on screen (the marker: the month's total, an expense, a reminder or a to-do) | 6,774 (6,732) | **1,357 (1,343)** |
| Every placeholder gone | 7,247 (7,194) | **1,357 (1,343)** |
| FCP, the first text | 1,416 (1,408) | 1,412 (1,388) |
| **LCP**, the biggest thing on screen (the month's total, both times) | 6,832 (6,792) | **1,412 (1,388)** |
| CLS, how much the page jumps | 0.012 (0.085) | **0.000 (0.000)** |
| TTFB, the page's first byte | 173 (169) | 171 (167) |
| TBT, time the page's code blocks taps | 199 (194) | 287 (264) |
| Lighthouse (simulated) LCP | 5,784 ±238 (5,491 ±219) | 4,582 ±2,021 (4,579 ±1,836) |
| Lighthouse FCP / CLS / TBT | 914 / 0.012 / 375 (915 / 0.085 / 298) | 910 / 0.012 / 373 (912 / 0.000 / 412) |

**Home, fast network and slow CPU (`--throttle cpu`), ms**, the pass where PF5 got slower:

| | Before | After |
| --- | ---: | ---: |
| Real data on screen | 1,369 ±77 (1,308 ±23) | **691 ±200 (689 ±15)** |
| Every placeholder gone | 1,369 (1,375) | 691 (689) |
| FCP | 344 (336) | 316 (328) |
| LCP | 1,444 (1,384) | **752 ±214 (748 ±14)** |
| CLS | 0.012 (0.085) | 0.000 (0.000) |
| TTFB | 180 (167) | 166 (171) |
| TBT | 207 (205) | 339 (304) |

**Per cold load of Home** (same for both users and both passes):

| | Before | After |
| --- | ---: | ---: |
| Requests to Home's APIs (`/api/dashboard`, `/api/reminders`, `/api/todos`) on first render | 3 | **0** |
| All API requests | 5 | 2 |
| Calls to Supabase | 42 | **32** |
| Calls to Supabase Auth | 23 | **17** |
| Real data in the first HTML | no | **yes** (every run) |
| The page itself, unzipped, KiB | 146.0 (145.1) | 214.1 (204.8) |

**One page render** (`node scripts/lab/first-render.mjs /dashboard --users parent,kid,solo`, which
counts the delay proxy's lines for one `fetch` of the page with a phone's User-Agent):

| | Parent | Kid (with expenses) | Kid without expenses | No family (solo) |
| --- | ---: | ---: | ---: | ---: |
| Supabase calls for the render | 13 (2 Auth, 8 REST, 3 RPC) | 13 | 11 | 10 |
| First byte / last byte, ms | 174–201 / 219–236 | 200–203 / 230–246 | 199–200 / 228–235 | 199 / 223–224 |
| Home's API requests in Chromium's first render | 0 | 0 | 0 | 0 |
| Console errors or warnings | none | none | none | none |

Before, a render made 6 calls (PF5: the proxy's and the layout's Auth calls, four account reads);
now the data's 5 to 7 reads are added, and still only 2 Auth calls: the dashboard loader's user check
reuses the layout's. A run sometimes counted 14 with a third Auth call, from a background request
overlapping the window. The gzipped page is 30.6 to 33.1 KiB after (`curl` with
`accept-encoding: gzip`, three each); PF5 measured 23.2 KiB before. The first byte didn't move: the
shell is sent before the data, and the data follows 25 to 45 ms later in the same answer.

What it says:

- **LCP is under 2.5 s in the lab's observed passes: 1.41 s on the slow-4G phone, 0.75 s on the
  CPU-only pass.** It is **not** under 2.5 s in Lighthouse's simulated pass: 4.6 s for both users
  (was 5.8 and 5.5), and it swings by ±2 s between runs. Lighthouse doesn't throttle a real load; it loads the page
  unthrottled and then estimates. In those unthrottled loads LCP happened at 320 to 600 ms, but every
  script the page started before that moment (about 40 files) is counted as something LCP waited for,
  though they are `async` and the total is drawn by the server's HTML. In two of three runs a second
  LCP entry came after hydration (600 ms), which makes it worse, and the runs swing by ±2 s for the
  same reason. The observed pass, which really throttles, shows the total painting
  with the first text. Fewer scripts (PF9) is what moves Lighthouse's number. Lighthouse also gets
  the page unstreamed: Next treats its User-Agent as a crawler and renders the page whole.
- **PF5's slowdown on the CPU-only pass is gone and reversed**: data 1.37 → 0.69 s for the parent
  (1.31 → 0.69 s for the kid). It comes at one of two moments, about 0.3 s or about 0.7 s (5 of 12
  runs over both builds at 0.28 to 0.31 s, 7 at 0.69 to 0.72 s). React 19.2 holds back a streamed
  block's reveal until 300 ms after the last paint, to batch reveals (`$RC` in the page's inline
  script: `$RT+300`): when the blocks arrive with the shell, they paint with it; when they arrive just
  after the first paint, they wait for that window. On the slow-4G phone the shell itself takes
  longer than that, so the blocks paint with the first text. Waiting for all the data before sending
  the page would avoid it, at the cost described in 3.
- **The price is hydration**: TBT is 70 to 130 ms higher (the page hydrates four filled blocks
  instead of four skeletons), and the page is 7 to 10 KiB bigger gzipped (the data, twice: as HTML
  and in React's payload; and the blocks' style tags, now repeated per block).
- **10 fewer Supabase calls and 6 fewer Auth calls per cold load**: three API requests (each with its
  own Auth call, password check and membership read) became reads inside the page's one render.

**The marker** (`scripts/lab/measure.mjs`): until now Home's "content" was the month card's title,
"Spent in November", which PF3 made part of the loading card, so it measured the frame (PF5 had to
quote "every placeholder gone" instead). It now waits for one of the month's total as the card writes
it, the five newest expenses, a reminder's or an open to-do's title, read from the same APIs. Both
builds above were measured with it.

**Kid without the expenses permission, for real.** `node scripts/lab/first-render.mjs /dashboard
--users kid,parent --kid-without-expenses` turns the seeded kid's expenses off through the parent's
API, loads Home as the kid, and turns it back on. With it off: `/api/dashboard` answers the kid 403,
none of the kid's 6 expense strings (the month's total and five descriptions, read before turning it
off) is anywhere in the page, scripts and React's payload included, the dashboard's key isn't in the
page, and the first render asks for nothing. Unit tests check the same (`load-home.test.tsx`).

**Screenshots** (after, loaded; `--shots docs/performance/screenshots/pf6`), compared with U7's
signed-off ones in `docs/ui-styling/screenshots/` (`u7-home-*`): same layout, cards, type and spacing;
only the data differs (the lab's family, not the fixtures).
[Parent, 390](performance/screenshots/pf6/after-dashboard-parent-390.jpg) ·
[Parent, 1280](performance/screenshots/pf6/after-dashboard-parent-1280.jpg) ·
[Kid, 390](performance/screenshots/pf6/after-dashboard-kid-390.jpg) ·
[Kid without expenses, 390](performance/screenshots/pf6/after-dashboard-kid-no-expenses-390.jpg) ·
[Kid without expenses, 1280](performance/screenshots/pf6/after-dashboard-kid-no-expenses-1280.jpg) ·
[No family, 390](performance/screenshots/pf6/after-dashboard-solo-390.jpg) ·
[No family, 1280](performance/screenshots/pf6/after-dashboard-solo-1280.jpg).

**Moving to Home from To-dos** (a scratch probe, 1280 px, no throttling): Home's data was on screen
423 ms after the tap, from the RSC answer for `/dashboard`; no request to Home's APIs, no console
warnings.

Tests: `src/lib/home/load-home.test.tsx` (the page's keys for a parent, a kid with and without the
permission, a user without a family and no session; each answer equals its route's; the page
rendered in the browser asks for nothing; a failing load is logged and fetched by the browser),
`src/lib/api/server-fallback.test.tsx` (no request on mount, the copy in SWR's cache, a second block
mounting later, the 15 s window, a failed load, an answer SWR already has),
`src/components/ui/streamed-section.test.tsx` (streamed content defines every class it uses), the
rule's tests, and `src/lib/auth/index.test.ts` (one memo for the layout and the page of a render).
Checks: `npm run lint`, `npx next typegen && npm run typecheck`, `npm test`, `npm run build`: all pass.

#### 5. How to check it yourself

1. `npm run lab -- up && npm run lab -- delay 40`.
2. Sign in as the parent (`.lab/users.json`), open Home with the network panel open and reload: no
   `/api/dashboard`, `/api/reminders` or `/api/todos` request, and the numbers are there at once.
3. "View source" (or `curl -N -b <the session cookie> http://localhost:3110/dashboard`): the month's
   total and the expenses' names are in the HTML.
4. `node scripts/lab/first-render.mjs /dashboard --users parent,kid,solo` prints, per user and
   width, what's in the HTML, the Supabase calls of one render, the data requests on the first
   render and any console warnings. Add `--kid-without-expenses` for the permission check (it
   changes the kid's permission while it runs and puts it back).
5. `npm run lab -- down`.

#### 6. Risks and how to undo it

- **Home's first byte now depends on nothing new, but its last byte does.** If one load is slow,
  that block keeps its loading card while the rest show; if a load fails, the browser fetches that
  block as before (logged as `server_prefetch_failed`). A load that hangs keeps the page's answer open
  until Supabase's own timeout; the blocks already sent stay usable. I didn't hang Supabase in the
  lab for this.
- **Each move to Home now reads Home's data on the server**, even when the browser already has it
  (the server can't know). That is 5 to 7 Supabase reads per visit; the browser then shows its own
  copy and revalidates as before.
- **`StreamedSection` relies on how Emotion behaves on the server** (a `null` cache in the context
  makes a fresh one). An Emotion or Chakra upgrade could change it; the test in
  `streamed-section.test.tsx` fails if streamed content stops carrying its styles.
- **Server and browser can disagree on time-relative text** ("12 minutes late"): the overdue label
  is marked `suppressHydrationWarning`, and the clock redraws it. Other labels are per day; a render
  just before midnight could show yesterday's greeting until the clock ticks (the same as since PF5).
- **The skip of the first revalidation** means data up to 15 s old is shown without a check, the
  same freshness SWR gives any answer it fetched.
- No migration, nothing stored. To undo: revert the PR. The routes keep their answers either way.

#### 7. Left open

- **Lighthouse's simulated LCP (4.6 to 4.9 s)** stays over 2.5 s; see 4. The observed passes meet it.
  PF9's smaller bundles are the lever.
- **React's 300 ms reveal window** (4): on a fast network the blocks sometimes paint 0.4 s after the
  first text. Not changed; it is React's own batching, and the slow-4G phone doesn't see it.
- **Styles in `<head>` instead of per element** (an Emotion registry) would remove the duplicated
  style tags and the need for `StreamedSection`. It needs `@emotion/cache` as a direct dependency,
  so it's a decision, not done here.
- **Whether production's proxy streams** (row 1) matters more now: if it buffers, the page arrives
  in one piece about 30 to 45 ms later (the data's time), which is still a win over the browser
  fetching it.
- **No request line for page renders**, as in PF5: only failures are logged.
- **`useAccount` keeps PF5's own skip.** Moving it to `useServerFirstSWR` would make one mechanism
  (PF8 touches the account hook).
- **Not done from the `/simplify` review:** SWR's own `preload()` in place of `useServerFirstSWR`'s
  freshness bookkeeping (it would let the hooks go back to plain `useSWR`, but it only works with
  SWR's default cache, which the tests replace, and a re-mounted page could hand SWR an old promise
  as a fresh answer; worth a try in PF8); starting the reminders load before the account is read (it
  would stream about two round trips sooner, but a signed-out visit would then log a failed load);
  starting the browser's clock at the server's time instead of `suppressHydrationWarning` (the other
  date labels change per day, not per minute); moving the lab scripts' console listeners into one
  helper (`session-gate.mjs` and `first-render.mjs` want different answers from `call`); the Emotion
  registry (above). Done from it: one `HomeBlockPending` for the four loading cards, the dashboard's
  permission check inside its loader, and `first-render.mjs` reading Home's strings from
  `measure.mjs` (`homeStrings`) instead of a copy.
- **Not done from the plan:** a separate test file per loader; the three loaders are tested together
  against their routes in `load-home.test.tsx`, and the routes' own tests pass unchanged.

#### The pattern for PF7

Written out at the top of `src/lib/server-prefetch.ts`. In short, for Expenses, To-dos and Reminders:

1. A loader per resource in `src/lib/<feature>/load-*.ts` that returns what the route answers for a
   query; the route calls it.
2. The page becomes a server component: it awaits only what decides which blocks there are (the
   account, `loadPageAccount()`, already read by the layout in this render), then builds
   `{ [key]: prefetch(page, key, loader) }` without awaiting and renders
   `<ServerFallback fallback={…}>` around the client body (moved to a `*-client.tsx`). A block the
   person can't see gets no entry.
3. Keys come from `src/lib/api/keys.ts`; give the page's key a builder both sides call, and read
   "today" and "this month" from the application calendar. For Expenses, read the month and the
   viewed member from the URL the way `url-state.ts` and `resolveViewedUser` do, inside the loader.
4. The client hooks swap `useSWR` for `useServerFirstSWR` (same arguments).
5. Every block that waits gets a `StreamedSection` with its loading card as the fallback (the lint
   rule enforces it in `*-client.tsx` and `src/components`); the heading stays outside.
6. Tests like `load-home.test.tsx`: the keys per kind of user, each answer equal to its route's, the
   page rendered with a fetcher that records requests (it must record none), a failing loader.
7. In the lab: `first-render.mjs <page>` for the HTML, the first render's requests and the console;
   its data strings are Home's, so give it the page's own (like `measure.mjs`'s `probesFor`).

### PF7: The same for Expenses, To-dos and Reminders

#### 1. The problem

After PF6, Home arrived with its numbers, but the three pages next to it still did what Home used to
do: the shell and grey placeholders came at once, and the data only after the browser had downloaded
and run the app's scripts and then asked the APIs. On the emulated phone the first expense, card or
reminder appeared at **6.8 to 8.1 s**, five to six seconds after the first text. Expenses made **four
data requests** (this month, last month, the saved tabs, the family list), To-dos two, Reminders one.
Expenses also jumped a little while its data arrived (layout shift 0.023 for the parent, 0.014 for the
kid).

#### 2. What changed

**What a person notices**

- **All three pages arrive with their data.** On the emulated phone the first expense, card or
  reminder is on screen at **1.36 to 1.42 s instead of 6.8 to 8.1 s**, with the first text. With a
  fast network and a slow phone it is **0.6 to 1.1 s instead of 1.5 to 2.2 s**.
- **No data request on a cold load.** Expenses no longer asks for the month, the month before, the
  saved tabs or the family list; To-dos not for the board or the family list; Reminders not for the
  list. Only the nav badge's `/api/reminders/summary` and the account notices go, as on Home.
- **Expenses stops jumping** (CLS 0.023 and 0.014 became 0.000), so the saved-tab chips PF3 saw
  moving "+ Tab" and "Filters" needed no fix of their own: the chips and the ledger now arrive together.
- **Fewer calls to the server's database** per cold load: Supabase calls 41 → 26 (Expenses), 33 → 26
  (To-dos), 26 → 23 (Reminders); Auth calls 22 → 14, 19 → 15, 15 → 13.
- **Permissions are the same, and nothing extra reaches the page.** A kid with the expenses
  permission off gets the "turned off" message and none of the expense data (checked in the lab, see 4).
  Another member's expenses are in the page only for someone allowed to view them.
- The pages look the same as before (screenshots in 4).

**How it works** (PF6's pattern, unchanged; it's described at the top of `src/lib/server-prefetch.ts`)

- Each page is now a **server component** that reads what it needs to decide what to load, starts the
  loads without waiting, and puts them in SWR's `fallback` through `ServerFallback`. The page's old body
  moved to a `*-client.tsx` file and sits in a `StreamedSection` with its loading screen as the fallback.
- **Reminders** (`src/lib/reminders/load-reminders-page.ts`): the list, one key, for anyone signed in.
- **To-dos** (`src/lib/todos/load-todos-page.ts`): the open board and the family list (the filter
  chips' members and colours), only for someone in a family.
- **Expenses** (`src/lib/expenses/load-expenses-page.ts`), for the URL the browser will draw, read the
  way the page reads it: `?month=` (a future month goes back to this one), `?member=` (a member's id,
  your own id meaning yourself, or `all`) and `?tab=`.
  - The main ledger: this month and the month before (for "27% more than October so far"), and the
    saved tabs, unless it is the family view, which has no tabs.
  - The family list, for anyone in a family: the member picker and the colours read it.
  - A saved tab: the tabs, then that tab's ledger for the filters in the URL. Its key carries the tab's
    `updatedAt`, so the page waits for the tabs before it renders (one more round trip, only for a
    `?tab=` URL).
  - Another member's data only if the person may view it (`family_finance` at "view", or a parent).
    A kid who may not gets nothing started, not even a refused load. A kid with the expenses
    permission off gets nothing at all.
- **Loaders return what the routes return.** New: `loadExpenses`, `loadExpenseTabs`,
  `loadExpenseTabLedger` (`src/lib/expenses/load-expenses.ts`) and `loadFamily`
  (`src/lib/family/load-family.ts`); `GET /api/expenses`, `/api/expense-tabs`,
  `/api/expense-tabs/[id]/expenses` and `/api/family` now call them. Each runs the route's own checks
  (the `expenses` permission, `resolveViewedUser` / `resolveFamilyViewers`). Route tests are unchanged
  and pass. `loadTodos` and `loadReminders` already existed from PF6.
- **Keys** are built with `src/lib/api/keys.ts` (`mainExpensesApiKey`, `expenseTabsApiKey`,
  `expenseTabExpensesApiKey`, `FAMILY_API_KEY`, `TODOS_API_KEY`, `REMINDERS_API_KEY`); the month is on
  `APPLICATION_TIMEZONE`'s calendar.
- **In the browser**, the hooks on seeded keys became `useServerFirstSWR`: the tabs, the month and the
  month before (`ledger-panel.tsx`), a saved tab's ledger (`custom-expense-tab.tsx`), the family list
  (`use-viewing.ts`, `use-member-colors.ts`, `viewing-picker.tsx`, `todo-board-screen.tsx`). The
  To-dos and Reminders hooks already were.
- `/dev/preview` and the quick-add test draw the three pages' client bodies, since the pages need a server.
- `useServerFirstSWR` got one fix (see 3): it no longer lets an error from SWR's own callbacks
  surface as an unhandled rejection.
- The lab's `first-render.mjs` now takes `/expenses`, `/todos` and `/reminders` (any query), with a
  `--prefix` for the screenshots' names; `measure.mjs` exports `probesFor` for it.

#### 3. Why this way

- **PF6's pattern, as the plan says.** One commit per page; each can be reverted alone (the shared
  parts, `loadFamily` and the `useServerFirstSWR` fix, are in the To-dos commit, which the Expenses
  commit builds on).
- **The family list is seeded on To-dos and Expenses, though the plan doesn't list it.** The first
  test run, which records every key the browser asks for, showed `/api/family` going out on first
  render on both pages (the filter chips, the member picker, the member colours). Without it the page
  would still make a data request, and the chips would appear after the board and shift it.
- **Another member's data is gated twice**: the page's own check (`family_finance`) keeps a refused
  load from being started and logged for something a kid typed into the URL, and each loader runs
  `resolveViewedUser`, so an id outside the family or a malformed one is refused as the route refuses
  it (a failed load is logged as `server_prefetch_failed` and left to the browser, which gets the 404).
- **A bug in `useServerFirstSWR` that PF6 missed.** When React replays a component that suspended on
  the server's promise, SWR 2.4.1 keeps a callback from the first, unfinished render. The first write
  of a key's value into SWR's cache calls it and it throws "Cannot access 'returnedData' before
  initialization". The cache is written before the callback runs and the value is the one on screen, so
  nothing is lost, but the throw was an unhandled promise rejection (vitest caught it in the To-dos
  test). I now drop it (`.catch(() => undefined)` on that one call, with a comment). It happens only when the
  server's copy resolves before the first render, which is every case here.
- **One boundary around each whole page**, not one per block: these pages' blocks (the ledger's total,
  the rows, the tabs) read the same few keys, and the lab shows the data arriving with the shell.
  Per-block boundaries, as on Home, would add streaming steps for no gain. The heading is inside the
  boundary, so it appears with the data (on To-dos and Reminders the LCP element is the heading's
  subtitle, as PF1b found; its time moved from the loading screen's to the real page's).
- **The nav badge stays the shell's request.** The plan says "the list and the badge count" for
  Reminders. The badge is drawn by the shell, outside the page's `ServerFallback`, so a page can't
  seed it; seeding it would mean the layout loading it on every page, which is not this task. The
  request is the same as on Home and on every other page.
- **Turned down:** reading `?tab=`'s ledger without the tabs (its key needs the tab's `updatedAt`);
  seeding Insights' or the Import page's keys that share these hooks (not in scope).

#### 4. Numbers

All from the lab on George's laptop, 11 November 2026, shared-secret JWT like production, 40 ms added to
every Supabase call. "Before" is `main` at `94aea98` (PF1 to PF6), "after" this branch's code (the lab
build of `8ff195a`; only the docs came after it); both measured with this
branch's `measure.mjs`. Medians of three cold loads. **Not production numbers**, and the laptop was
busy with other work while they ran (load average 17 to 37), so the CPU-only pass in particular is
noisier than PF6's: read differences under about 100 ms as noise.

```bash
npm run lab -- up && npm run lab -- delay 40       # before: at 94aea98; after: npm run lab -- app --delay-ms 40
for page in /expenses /todos /reminders; do
  for user in parent kid; do
    npm run lab:measure -- $page --user $user --runs 3 --label pf7-<before|after>-mobile-$user-<page>
    npm run lab:measure -- $page --user $user --runs 3 --throttle cpu --no-lighthouse --label pf7-<before|after>-cpu-$user-<page>
  done
  node scripts/lab/first-render.mjs $page --users parent,kid,solo
done
```

Read from each run's `summary.json` (`.lab/results/<time>-pf7-<before|after>-…`). "Data on screen" is
the measure marker: one of the page's own data strings drawn outside a placeholder.

**slow 4G, the emulated phone, ms**, parent (kid in brackets), before → after:

| Page | Data on screen | LCP | FCP | CLS | TTFB | TBT | Lighthouse LCP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Expenses | 8,094 → **1,421** (7,282 → **1,361**) | 8,252 → **1,488** (7,664 → **1,424**) | 1,436 → **1,488** (1,412 → **1,424**) | 0.023 → **0.000** (0.014 → **0.000**) | 231 → **178** (197 → **183**) | 1,415 → **663** (439 → **281**) | 5,980 → 1,061 (5,988 → 913) |
| To-dos | 7,459 → **1,393** (7,441 → **1,398**) | 1,408 → **1,452** (1,416 → **1,460**) | 1,408 → **1,452** (1,416 → **1,460**) | 0.000 → **0.000** (0.000 → **0.000**) | 178 → **182** (169 → **181**) | 355 → **332** (358 → **399**) | 915 → 946 (915 → 911) |
| Reminders | 6,903 → **1,378** (6,815 → **1,362**) | 1,428 → **1,440** (1,404 → **1,404**) | 1,428 → **1,440** (1,404 → **1,404**) | 0.000 → **0.000** (0.000 → **0.000**) | 184 → **166** (173 → **211**) | 270 → **231** (262 → **229**) | 3,962 → 909 (913 → 913) |

**fast network, 4x slower CPU, ms**, parent (kid in brackets), before → after:

| Page | Data on screen | LCP | FCP | CLS | TTFB | TBT |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Expenses | 2,196 → **1,069** (1,776 → **1,008**) | 2,268 → **1,280** (1,904 → **992**) | 340 → **380** (352 → **500**) | 0.014 → **0.000** (0.000 → **0.000**) | 192 → **206** (178 → **220**) | 1,417 → **830** (421 → **452**) |
| To-dos | 2,132 → **726** (1,488 → **739**) | 752 → **368** (356 → **352**) | 556 → **360** (328 → **340**) | 0.000 → **0.000** (0.000 → **0.000**) | 220 → **188** (169 → **173**) | 511 → **373** (364 → **376**) |
| Reminders | 1,984 → **631** (1,472 → **738**) | 568 → **364** (348 → **796**) | 396 → **348** (348 → **424**) | 0.000 → **0.000** (0.000 → **0.000**) | 210 → **172** (172 → **174**) | 503 → **313** (223 → **256**) |

**Per cold load** (same in both passes), parent (kid), before → after:

| Page | Data requests on first render | All API requests | Supabase calls | Auth calls | Data in the first HTML |
| --- | ---: | ---: | ---: | ---: | --- |
| Expenses | 4 (solo: 3) → **0** | 6 → **2** (6 → **2**) | 41 → **26** (41 → **26**) | 22 → **14** (22 → **14**) | no → **yes** |
| To-dos | 2 (solo: 0) → **0** | 4 → **2** (4 → **2**) | 33 → **26** (33 → **26**) | 19 → **15** (19 → **15**) | no → **yes** |
| Reminders | 1 → **0** | 3 → **2** (3 → **2**) | 26 → **23** (26 → **23**) | 15 → **13** (15 → **13**) | no → **yes** |

What it says:

- **The data is on screen with the first text on all three pages, for both users**: 1.36 to 1.42 s on
  the emulated phone (was 6.8 to 8.1 s), 0.63 to 1.07 s on the CPU-only pass (was 1.5 to 2.2 s).
  The first byte did not move (166 to 211 ms, within the noise).
- **LCP, the moment the biggest thing on screen appears.** On Expenses it was the "27% more than
  October" line, at 8.3 s, and is now at 1.49 s, with the data. On To-dos and Reminders the observed LCP
  was already ~1.4 s *before*: the element was the subtitle inside the loading screen (the `inBusy`
  flag in `summary.json`'s `lcpElements`), so it measured the frame, not the data (PF1b's finding).
  It is still ~1.4 s after, now the real subtitle with the data. Judge those two by "data on screen".
  The slow-4G LCP is under 2.5 s on all three. On the CPU-only pass it is under 1.3 s except one run
  of three on the kid's Reminders (1.03 s, 0.42 s, 0.80 s; React's 300 ms reveal window and the busy
  laptop, see PF6's 4).
- **Lighthouse's simulated LCP** (separate column; it simulates, it doesn't throttle a real load, see
  PF6's 4): Expenses 6.0 → 1.1 s (parent) and 6.0 → 0.9 s (kid); Reminders 4.0 → 0.9 s; To-dos 0.9 s both
  times (its LCP was the loading screen's subtitle). Single runs of three still land on 3 to 5.3 s
  (after: Expenses 5.3 and 4.9 s, To-dos 3.2 s, Reminders 3.4 s), as PF6 found; the medians are under 2.5 s.
- **TBT** (how long the page's code blocks taps) fell on Expenses (1,415 → 663 ms, parent) and stayed
  the same elsewhere, unlike Home's rise in PF6: these pages' filled blocks hydrate at the same cost as
  their skeletons did, and the old way also ran every request's response through React.
- **No jump anywhere**: CLS 0.000 on all six page and user pairs.
- **The cost:** the page's HTML is bigger (Expenses' is 442 KB unzipped in the median run, with the data
  twice: as HTML and in React's payload; PF6 saw the same on Home). I did not measure the before size or the gzipped size.

**One page render** (`node scripts/lab/first-render.mjs <page> --users parent,kid,solo`, one `fetch` of
the page with a phone's User-Agent; the proxy's lines for it):

| | Parent | Kid | No family (solo) |
| --- | ---: | ---: | ---: |
| Expenses: Supabase calls (before → after) | 6–7 → 10–11 | 7 → 11 | 6–7 → 9–10 |
| To-dos | 6–7 → 9 | 7 → 9–10 | 6–7 → 6 |
| Reminders | 6 → 8 | 6 → 8 | 6–7 → 8 |
| Data strings in the HTML, outside scripts (Expenses / To-dos / Reminders) | 15/15 · 14/14 · 10/10 | 8/8 · 14/14 · 2/2 | 0/0 · 0/0 · 1/1 |
| Same, before | 0 on all three | 0 | 0 |
| Data requests in Chromium's first render, besides the badge | 0 · 0 · 0 | 0 · 0 · 0 | 0 · 0 · 0 |
| Console errors or warnings | none | none | none |

The render makes 3 to 5 more Supabase calls (the page's own reads); the browser's requests used to make
more (each with its own Auth call, password check and membership read), hence the lower totals above. Kid with the expenses permission: the kid's page
has the same 8 strings as their own month; a solo user has no family, so no member or family reads.

**Permissions, for real in the lab** (`node scripts/lab/first-render.mjs /expenses --users kid,parent --widths 390 --kid-without-expenses`
and a scratch probe that fetched `/expenses?member=…` with each user's cookie and searched the whole
page, scripts and React's payload included, for 8 of the other person's expense descriptions):

| Who asks for | Result |
| --- | --- |
| Kid, expenses turned off | the "turned off" message; **0 of 8** of the kid's own descriptions in the page; `/api/dashboard` is not in it; the first render asks for nothing (turned on again afterwards: the kid's permissions read `expenses: "edit"` again) |
| Kid (family finance off) viewing the parent, `?member=<parent>` | **0 of 8** of the parent's descriptions |
| The same kid, `?member=all`, and `?member=<parent>&tab=x` | **0 of 8** of the parent's, 0 of 8 of the kid's own |
| Parent viewing the kid, `?member=<kid>` | **8 of 8** of the kid's descriptions (allowed) |
| Parent, `?member=all` | **8 of 8** of the kid's descriptions (allowed) |
| Parent, `?member=<an id outside the family>` | 0 of 8 of the parent's own; the load is refused and logged, the browser gets the 404 as before |

**A write right after a cold load** (a scratch probe in Chromium, lab, parent, 1280 px, no throttling):

- **To-dos:** opened `/todos`, "Add a card" in To do, typed a title, Enter, the moment the board was
  there: one `POST /api/todos`, the new card on screen, and the other cards still there (the page's
  text grew from 161 to 164 lines). A write that started from an empty cache would have left only the new card; I did not
  run that case, the unit test covers it. No data request.
- **Reminders:** opened `/reminders`, tapped "Mark Book the dentist done" at once: the row left Today
  within 60 ms, the other reminders stayed (no empty list at any point), then `POST …/complete`,
  `GET /api/reminders/summary` (the badge went to "1, 1 due") and `GET /api/reminders` (the refetch the
  write asks for). 
- Unit tests do the same from the server's copy (below). Expenses' writes (add, edit, delete with
  Undo) go through the same cache entries as before (`use-expense-writes.ts`, unchanged);
  I did not repeat them by hand in the lab.

**Screenshots** (after, loaded; `--shots docs/performance/screenshots/pf7`), to compare with the signed-off
screens in `docs/ui-styling/screenshots/` and PF3's: same layout, cards, type and spacing; only the lab's
data differs. Expenses: [parent, 390](performance/screenshots/pf7/after-expenses-parent-390.jpg) ·
[parent, 1280](performance/screenshots/pf7/after-expenses-parent-1280.jpg) ·
[kid, 390](performance/screenshots/pf7/after-expenses-kid-390.jpg) ·
[kid, 1280](performance/screenshots/pf7/after-expenses-kid-1280.jpg) ·
[kid without the permission, 390](performance/screenshots/pf7/after-expenses-kid-no-expenses-390.jpg) ·
[1280](performance/screenshots/pf7/after-expenses-kid-no-expenses-1280.jpg) ·
[family view, 390](performance/screenshots/pf7/after-family-expenses-member-all-parent-390.jpg) ·
[1280](performance/screenshots/pf7/after-family-expenses-member-all-parent-1280.jpg). To-dos:
[parent, 390](performance/screenshots/pf7/after-todos-parent-390.jpg) ·
[parent, 1280](performance/screenshots/pf7/after-todos-parent-1280.jpg) ·
[kid, 390](performance/screenshots/pf7/after-todos-kid-390.jpg) ·
[kid, 1280](performance/screenshots/pf7/after-todos-kid-1280.jpg). Reminders:
[parent, 390](performance/screenshots/pf7/after-reminders-parent-390.jpg) ·
[parent, 1280](performance/screenshots/pf7/after-reminders-parent-1280.jpg) ·
[kid, 390](performance/screenshots/pf7/after-reminders-kid-390.jpg) ·
[kid, 1280](performance/screenshots/pf7/after-reminders-kid-1280.jpg). (The To-dos screenshots show a card,
"Probe card after cold load", that the write check above added to the lab's board.) I looked at one
Expenses screen at each width and the To-dos 390 and the no-permission screens; the others were taken
by the same run and I did not open each one.

**Tests.** `src/lib/expenses/load-expenses-page.test.tsx` (14: the keys for a parent, a month from the
URL and a future one, a saved tab and an unknown tab, the family view, another member, the person's own
id, a kid without the permission and a kid who may not view others, no session, an id outside the family,
a failing month; each answer equal to its route's; the page mounted in the browser asks for nothing),
`src/lib/todos/load-todos-page.test.tsx` (7, including a move from the server's board and a user without
a family), `src/lib/reminders/load-reminders-page.test.tsx` (5, including marking done right after a
cold load), `src/test/mount-server-page.tsx` (the shared helper), the Expenses page's old tests (moved to
`expenses-client.test.tsx`) and `viewing.test.tsx` (its SWR mock gained `useSWRConfig`). Checks:
`npm run lint`, `npx next typegen && npm run typecheck`, `npm test`, `npm run build`: all pass (6,926 tests passed, 1 skipped; run on this branch before the last commit).

**Calendar, Insights, Investments, Net worth and Settings.** The plan says to list them "next" if PF1's
numbers say they are slow too. PF1 and PF1b measured only Home, Expenses, To-dos and Reminders signed in;
for these five I ran one quick pass now (slow 4G, parent, three runs, no Lighthouse) on this branch's build:

Slow 4G on the emulated phone, parent, median of three cold loads (`npm run lab:measure -- /calendar /insights /investments /net-worth --user parent --runs 3 --no-lighthouse`; Settings alone in a second call; this laptop was busy). These pages have no content marker, so "LCP" is the biggest thing on screen, which is the data on the first three and the page's frame on the other two:

| Page | LCP | CLS | TBT | API requests | Supabase calls | Auth calls | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Insights | 7,424 ms | 0.073 | 255 ms | 4 | 39 | 25 | **next**: data at the end of the chain, and it jumps |
| Investments | 6,856 ms | 0.107 | 364 ms | 4 | 33 | 19 | **next**, same, and the worst jump |
| Net worth | 6,980 ms | 0.105 | 400 ms | 4 | 36 | 21 | **next**, same |
| Calendar | 1,420 ms (the page's frame) | 0.002 | 326 ms | 9 | 62 | 29 | **next**: its LCP is the frame, but 9 API requests and 62 Supabase calls per load are the most of any page; when its events appear was not measured |
| Settings | 1,404 ms (the page's frame) | 0.000 | 262 ms | 5 | 41 | 28 | later: forms and switches, no big data; its requests are the account's and the notices |

So **Insights, Investments and Net worth are as slow as Expenses was** (data at about 7 s, a visible jump of 0.07 to 0.11 CLS, over the 0.1 limit on two of them) and should be the next pages to get PF6's pattern; Calendar next after them. This task leaves all five loaded in the browser, as the plan says.

#### 5. How to check it yourself

1. `npm run lab -- up && npm run lab -- delay 40`.
2. Sign in as the parent (`.lab/users.json`), open Expenses, To-dos and Reminders one after the other
   with the network panel open, reloading each: no request for the ledger, the board, the tabs, the
   family list or the reminders (only `/api/reminders/summary` and `/api/account/notices`), and the data is there
   at once. "View source" or `curl -N -b <the session cookie> http://localhost:3110/expenses` has the
   expenses' descriptions in it.
3. `node scripts/lab/first-render.mjs /expenses --users parent,kid,solo` (and `/todos`, `/reminders`):
   per user and width, the strings in the HTML, the Supabase calls of one render, the data requests of
   the first render and any console warnings. Add `--kid-without-expenses` for the permission check on
   Expenses (it changes the kid's permission while it runs and puts it back). A query works:
   `/expenses?member=all`.
4. In the browser, as the kid, open `/expenses?member=<the parent's member id>`: the page has no
   expense in it ("view source" and search for one of the parent's descriptions).
5. On To-dos, add a card the moment the page opens: the other cards stay. On Reminders, tap the tick
   on a reminder at once: it leaves Today and the others stay.
6. `npm run lab -- down`.

#### 6. Risks and how to undo it

- **A page's first byte doesn't change, but its last byte now depends on its loads** (the data follows
  the shell by 25 to 100 ms in the same answer). A slow load keeps the page's one boundary on its
  loading screen; a failed one is logged as `server_prefetch_failed` and the browser fetches as before.
  I didn't hang Supabase in the lab to see a slow load. Because there is one boundary per page here, the
  slowest of Expenses' reads (the month, the month before, the tabs, the family list) decides when
  the page shows; they run at once, so it's the slowest one, not the sum.
- **Each visit to one of these pages now reads its data on the server**, even when the browser has it
  (the server can't know): 3 to 5 more Supabase reads per render, then the browser shows its own copy
  and revalidates as before.
- **Expenses' `?tab=` URLs wait for the tab list before the page renders** (one extra round trip).
- **The `useServerFirstSWR` throw is dropped, not understood.** I traced it to SWR's callback of a
  replayed hook (3). If SWR fixes it, the `.catch` is harmless; if it hid a different error from the
  same call, nothing would show. The test run that found it now has no unhandled errors.
- **Time-relative text and the clock**: the same as Home (a render just before midnight could show
  yesterday's day groups until the clock ticks).
- **A garbage `?member=` logs one to three `server_prefetch_failed` lines** per page view when the
  person may view other members (the loaders refuse it). The data isn't in the log.
- No migration, nothing stored. To undo one page: revert its commit (To-dos' commit also holds
  `loadFamily` and the `useServerFirstSWR` fix, which the Expenses commit uses, so revert Expenses
  first). To undo all: revert the PR. The routes keep their answers either way.

#### 7. Left open

- **Checks:** `npm run lint`, `npx next typegen && npm run typecheck`, `npm test` (338 files, 6,926 tests passed, 1 skipped) and `npm run build` pass. A first full test run on the busy laptop had timeouts (5 s) in unrelated preview and dialog tests and, genuinely, in `viewing.test.tsx`, whose SWR mock lacked `useSWRConfig`; fixed, and the second full run was clean. `npm run test:db` not run: no SQL touched.
- **The nav badge** (`/api/reminders/summary`) is still the browser's request on every page (3).
- **Lighthouse's simulated LCP** has single runs of 3 to 5 s on Expenses, To-dos and Reminders; its
  medians are under 2.5 s but the spread is PF9's (fewer scripts).
- **Expenses' writes in the lab** (add, edit, delete) were not repeated by hand after the change; their
  code is untouched and unit-tested.
- **Gzipped page size** for these pages is not measured.
- **Not measured at all:** the VPS (see "Waiting for George").

### PF8: Prefetching, waterfalls and stable data

#### 1. The problem

After PF7 a cold load of Home, Expenses, To-dos or Reminders arrives with its data, but **moving
between them did not**. I scripted the click-through (Home, Expenses, Reminders, To-dos, Home, and
round again, one tap every 16 s) and looked at what the browser asked for on each tap:

- **Every tap asked for the account again** (`/api/account`), and the to-dos and expenses pages also
  for the family list (`/api/family`), though nothing had changed. SWR, the library that keeps the
  browser's copy of each answer, calls an answer "stale" 15 s after it fetched it and asks again
  whenever a page that reads it opens. The account and the family list are read by nearly every page.
- **Every tap asked for the page's own data too**, right after the server had sent the same data with
  the page. Moving to Expenses made five requests (the account, the family list, this month, last
  month, the saved tabs), Home four, To-dos three, Reminders two. On a revisit SWR already had an
  older copy, preferred it to the fresh one the page had just brought, and refreshed the older one
  from the network.
- **Each tap cost 6 to 12 Auth calls** (the check that you are signed in, one per request) and 18 to 36
  Supabase calls, half of them for answers that were already in the page.
- **A cold load still made two requests of its own**, from the shell: the Reminders count in the nav
  and the "you were removed from the family" notice check. They start only once the app's scripts
  have run, so they are the "waits in a row" PF1 counted.
- **Opening any page prefetched Settings, More and every settings page** along with the daily ones:
  16 prefetch requests on a cold desktop load, 10 on a phone, each one a session check plus the page's
  scripts, for pages nobody opens on most visits.

#### 2. What changed

**What a person notices**

- **Moving between Home, Expenses, To-dos and Reminders makes no request at all** (account, family list,
  colours or the pages' data): the page's skeleton shows within 40 to 125 ms of the tap (43 to 194 ms
  before; see 4), and the fresh data comes in the same answer. Auth calls per tap fell from 6 to 12
  to **2** (4 on the first visit, which also prefetches), Supabase calls from 18 to 36 to **8 to 13**.
- **A cold load makes no request from the shell either**: the Reminders count and the notices come with
  the page and stream in.
- **Settings, More and the settings pages are prefetched when you point at them**, not when they
  scroll into view. A cold load makes two prefetch requests fewer (one link).
- **To-dos no longer gives a hydration error** that this task's change exposed (see "The hydration
  error" in 3).
- **A page you have been to before takes the server's fresh copy**, which comes with the page, instead
  of asking again for its own older one. Nothing refetches it.
- **The account and the family list are read again when you come back to the app** (the tab or the
  installed app regains focus) and after your own writes, not when a page opens.

**How it works**

- **`STABLE_DATA`** (`src/lib/api/stable-data.ts`): `revalidateIfStale: false` and `revalidateOnFocus:
  true`. `useAccount()` passes it; the new `useFamily(enabled)` (`src/hooks/use-family.ts`) passes it
  for the family list and now serves `useMemberColors`, `useViewing`, the viewing picker, the to-do
  board and form, the event form and the calendar, which used to call SWR on the key themselves. The
  family settings pages read the list with plain `useSWR` on purpose: opening them shows the newest.
  A new lint rule, `local/stable-data-options`, flags any other SWR read of these two keys without
  it.
- **Writes**: one was missing. Changing your currency updated the account but not the family list,
  which shows each member's currency (`afterCurrencyChanged` in `src/lib/api/invalidate.ts`, called
  from the settings page's `useSettingsWrites`). The others already updated their keys (checked in
  the table in 3) and now have a test each.
- **`useServerFirstSWR`** (`src/lib/api/server-fallback.tsx`) knows which data its own `ServerFallback`
  (the page's) sent. When SWR holds an older answer for that key, it shows it at once, does not ask
  the network, and writes the server's copy in when it arrives (if that copy is missing, because the
  loader failed, it asks). A reader of a key the page did not send behaves as before.
- **The shell's two requests** (`src/app/(app)/layout.tsx`): the layout starts `reminderSummary` and,
  with the family feature on, `loadNotices` (new, `src/lib/account/load-notices.ts`; the route calls
  it too) without waiting, and the shell's `ServerFallback` hands them to the nav badge and the notice
  dialog, each in a `StreamedSection` of its own (`RemindersBadge` in `nav-badge.tsx`), so a slow
  count never holds the shell.
- **Prefetching** (`src/components/layout/intent-link.tsx`): `IntentLink`, a `Link` that prefetches on
  hover, focus or touch (the pattern in the Next prefetching guide). The Settings row, the More tab and
  every row of the settings list use it; every other navigation link keeps the default.
- **The to-do board's drag-and-drop** (`todo-board.tsx`) got `id="todo-board"`, and a lint rule,
  `local/dnd-context-id`, asks for one on every `DndContext`.
- **Lab**: `scripts/lab/navigation.mjs`, the scripted click-through (see 4).

#### 3. Why this way

- **Stable data: the account.** The plan says `revalidateIfStale: false` for the account, and PF5
  skipped it because the account would then never refresh on other pages. What PF5 did instead was a
  15 s window after the page loaded, so after 15 s every page asked again. I took the plan's option and
  gave the account what the window protected: a read on focus, and the writes' own updates. A change made
  elsewhere (a parent changes a kid's permissions on another device) now shows when the kid returns
  to the app, not when they open the next page. The server checks permissions on every request, so
  a stale screen can show a button that is then refused, never the other way round. The same choice
  for the family list.
- **Categories**: there is no categories request to cache. The category list is in the code; I found
  nothing in the app that fetches it.
- **Why not `revalidateOnFocus` off**: then a long-open installed app would never see a change until
  reload; before this task any page change refreshed it.
- **Every write that changes stable data** (what each updates; `src/lib/api/invalidate.test.ts` and
  `src/components/family/use-family-writes.test.ts` check each one):

  | Write | Account | Family list |
  | --- | --- | --- |
  | Create a family, join one (an invite), delete it | reloaded | cached from the answer, or "no family" |
  | Add a kid, delete a kid's account, set permissions, choose a colour | | cached from the answer |
  | Remove a member | | reloaded |
  | Profile picture set or removed | reloaded | reloaded |
  | Currency | cached from the answer | reloaded (**was missing**) |
  | Sign out | cleared | cleared |

- **SWR's `preload()` instead of `useServerFirstSWR`'s own bookkeeping** (PF6's `/simplify` idea).
  I tried it in a scratch test and turned it down:
  - It works for the first mount: a preloaded answer is used by the first fetch, no request, and ends
    up in the cache.
  - But SWR keeps an unused preload until some fetch for the key uses it. A hook that doesn't fetch
    (`revalidateIfStale: false`, the account's and the family list's option) never uses it, and the
    next `mutate(key)` or focus revalidation then **returns that old server copy without asking the
    network**. I reproduced it: after `preload(key)` and a mount with the option, `mutate(key)` made no
    request and left the old copy. For a page that can be open for hours that is a stale-data bug waiting
    for the first write.
  - It is a no-op on the server and has to be called while the page renders in the browser, so it
    would still need the arrival bookkeeping for the dedupe window and the same cache write.
  So the hook stays, now with one rule fewer to explain (it no longer matters whether SWR's copy
  or the server's is older: the page's own copy wins).
- **Prefetch: where I ended up.** I measured what a cold load prefetches after PF5 (4). The sections'
  skeletons (PF3) are what make a tab tap show a page in 43 to 86 ms, so the daily links keep
  Next's default prefetch. The cost is the other links, each one a request through the session check
  plus the page's scripts: Settings is the one that is on screen on every page (sidebar row, More tab)
  and the one least used. I took it, the More tab and the settings list out of "prefetch when visible"
  and into "prefetch on hover, focus or touch". I did not defer Investments, Net worth, Insights or
  the Calendar (only on the desktop sidebar, where bandwidth is not the constraint, and the phone
  doesn't link them), and I added no router.prefetch list (PF5 removed one).
- **`staleTimes`**: left at its defaults. The plan's trigger was a tab tap's RSC request taking more
  than 100 ms; in the lab it takes 234 to 347 ms (the page's server render with its data, 8 to 13
  Supabase calls at 40 ms each). But the skeleton, from the prefetched shell, is on screen after 40 to
  125 ms and the data arrives in that same answer, so what a person waits for is the server's reads,
  not a missing cache. `staleTimes.dynamic` would show a page's payload from up to N seconds ago:
  old data, to save a wait that ends with the data. Not the trade.
- **The hydration error.** Once the shell stopped asking for its two requests, `/todos` logged React
  error #418 ("the server's HTML didn't match") in about 1 load in 4 (5 of 20, 4 of 25: parent and kid) and
  the page redrew itself. A dev-mode run named the attribute: `aria-describedby` on the board's cards.
  dnd-kit numbers that text (`DndDescribedBy-3`) from a counter of renders, and a repeated render on
  one side moves the counter; my change shifted when renders repeat. The same build on `main` showed
  0 errors in 55 loads, so it is latent in the board and not new, but I exposed it. Fix: give
  `DndContext` an id. After it: 0 errors in 120 loads (To-dos for both users, Reminders and Expenses
  for the kid, 30 each). Two single errors earlier on kid Reminders (1 of 20) and kid Expenses at 1280
  px (once) were never explained; none in the 60 loads of those two pages after the fix.
- **Turned down:** a combined endpoint (no two requests always go together on a page any more, since
  the pages bring their data), and the proxy `getClaims` shortcut (waits for George's signing-keys
  decision, as told).

#### 4. Numbers

All from the lab on George's laptop, 11 November 2026, shared-secret JWT like production, 40 ms added to
every Supabase call, parent user. "Before" is `main` at `a4cd4af` (PF1 to PF7), "after" this branch
(the lab build of the final code). Medians of three cold loads. **Not production numbers.** The laptop
was busy in places (load average 5 to 9 during two passes, which made one CPU-only pass 400 ms slower on
Home; I repeated it with the load under 3 and use that one): read differences under about 100 ms as noise.

**Requests when you move between the four pages** (`node scripts/lab/navigation.mjs --width 1280`, and
`--width 390`; Home loaded cold, then taps on Expenses, Reminders, To-dos, Home, Expenses, Reminders,
To-dos, one every 16 s, which is past SWR's 15 s window; the same seven taps at both widths).
Totals over the seven taps, before → after:

| | 1280 px | 390 px |
| --- | ---: | ---: |
| Data requests from the browser (account, family list, the pages' data) | 20 → **0** | 20 → **0** |
| Auth calls | 56 → **16** | 56 → **16** |
| Supabase calls | 177 → **69** | 177 → **69** |
| Waterfall depth of a tap (RSC request, then a script, then a data request) | up to 3 → **1** | up to 3 → **1** |
| URL changes / skeleton shows, ms after the tap | skeleton 43 to 87 → **53 to 102** | skeleton 7 to 194 → **48 to 126** |
| Page loaded (data on screen), ms after the tap | 354 to 482 → **343 to 411** | 353 to 595 → **347 to 404** |

The same at 1280 px, tap by tap (data requests; Auth calls; Supabase calls), before → after:

| Tap | Data requests before | Auth | Supabase |
| --- | --- | ---: | ---: |
| Expenses (first) | `/api/account` | 6 → **4** | 18 → **12** |
| Reminders | `/api/reminders`, `/api/account` | 6 → **2** | 19 → **8** |
| To-dos | `/api/account`, `/api/family`, `/api/todos` | 8 → **2** | 25 → **9** |
| Home | `/api/account`, `/api/dashboard`, `/api/reminders`, `/api/todos` | 10 → **2** | 36 → **13** |
| Expenses (again) | `/api/account`, `/api/family`, two months of expenses, `/api/expense-tabs` | 12 → **2** | 35 → **10** |
| Reminders (again) | `/api/reminders`, `/api/account` | 6 → **2** | 19 → **8** |
| To-dos (again) | `/api/account`, `/api/family`, `/api/todos` | 8 → **2** | 25 → **9** |

After, every tap's data requests are none. The first Expenses tap's 4 Auth calls include two prefetches it
triggers. The skeleton is as fast as before (within the noise; the single 194 ms before and 126 ms
after at 390 px are one-off taps), and the page's own data still comes in the tap's RSC answer, which
takes 234 to 333 ms (244 to 347 before). I did not remove that wait: it is the server's reads.

**A cold load** (`npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3
--no-lighthouse --label …`, slow 4G on the emulated phone; the same with `--throttle cpu`; the server and
request numbers are the same in both passes), before → after:

| | Home | Expenses | To-dos | Reminders |
| --- | ---: | ---: | ---: | ---: |
| Data requests from the browser | 2 → **0** | 2 → **0** | 2 → **0** | 2 → **0** |
| Waterfall depth (the lab's measure: page, scripts, data) | 3 → **0** | 3 → **0** | 3 → **0** | 3 → **0** |
| Auth calls | 17 → **11** | 14 → **8** | 15 → **9** | 13 → **7** |
| Supabase calls | 32 → **24** | 26 → **18** | 26 → **18** | 23 → **15** |
| Prefetch (RSC) requests | 10 → **8** | 7 → **5** | 8 → **6** | 6 → **4** |
| All requests | 70 → **66** | 67 → **63** | 68 → **64** | 63 → **59** |
| JS transferred, KiB | 430.0 → **435.4** | 457.9 → **461.0** | 449.0 → **453.4** | 428.4 → **431.8** |
| Data on screen, slow 4G, ms | 1,454 → **1,393** | 1,581 → **1,433** | 1,377 → **1,424** | 1,365 → **1,382** |
| Data on screen, CPU-only, ms | 758 → **802** | 945 → **850** | 752 → **590** | 748 → **740** |
| LCP, slow 4G, ms | 1,516 → **1,452** | 1,640 → **1,492** | 1,436 → **1,484** | 1,424 → **1,444** |
| LCP, CPU-only, ms | 820 → **884** | 1,072 → **1,008** | 344 → **352** | 388 → **848** |
| CLS | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |

What it says:

- **Depth**: no cold load has a data request from the browser, so the lab's measure is 0 (it was 3:
  the page, its scripts, then the badge and the notices). In a tap it is 1.
- **Auth calls fell by 6 per cold load**: 4 from the two requests (two each) and 2 from the prefetches.
  The Auth call per remaining prefetch is untouched; that is the proxy `getClaims` question, still
  waiting on the signing-keys decision (row 4 above).
- **Data on screen did not move beyond the noise.** The two requests were not on the way to the data
  any more after PF7. The reminders LCP, CPU-only (388 → 848 ms) is not a slowdown: before, the biggest
  element was the subtitle inside the loading screen (the run's `inBusy` flag was true), now it is the
  real subtitle, drawn with the data; its data-on-screen time is 748 → 740 ms.
- **The cost: JS grew by 3.4 to 5.4 KiB** (`jsBytes`, transferred) per cold load: the new hook, the intent
  link and the badge's boundary. I did not look for where; PF9 is about bundles.

**What prefetching costs now** (the lab's request lists): a cold desktop load makes 14 prefetch requests
(16 before) and a phone 8 (10 before); Home's are the bottom bar's four tabs and the cards' links. The two
removed are Settings and More. Tapping them with no pointer over them first (what a script's click is)
commits the navigation after 106 to 160 ms; with a 120 ms hover before the tap, 39 to 146 ms (More at 390 px
39 and 46 ms; Settings at 1280 px 146 and 70 ms):
`node scripts/lab/navigation.mjs --moves More,Home,More [--hover 120]`. A real touch has its `touchstart`
tens of ms before the click, so the hover case is the closer one. The four daily tabs are unchanged
(40 to 126 ms in the table above).

**Hydration** (`node <scratch stress script>`: a fresh Chromium, sign in, load the page, wait 2.5 s, count console
errors; the script is not in the repo): `/todos` before the board fix, this branch: parent 5 of 20, kid 4 of 25
loads logged React error #418; `main` (`a4cd4af`): 0 of 55. After the fix: 0 of 30 each for
parent To-dos, kid To-dos, kid Reminders and kid Expenses at 1280 px. `first-render.mjs` (4 pages, 3 users,
2 widths, before the fix): no data request on any first render except one in the run that hit the
error; no other console message.

**Screenshots** (after; the badge "4" on Planning came from the layout, no request):
[Reminders, 390](performance/screenshots/pf8/after-reminders-parent-390.jpg) ·
[Reminders, 1280](performance/screenshots/pf8/after-reminders-parent-1280.jpg). Nothing else on any page
changed; I looked at the 390 px one.

**Tests.** `src/hooks/stable-data.test.tsx` (new: with the option a page opening later asks for neither
the account, the family list nor the colours; without it, the control, it asks for both; a key with no
answer is fetched; focus reads them again; `useFamily(false)` asks for nothing),
`src/lib/api/invalidate.test.ts` and `src/components/family/use-family-writes.test.ts` (each write
that changes the account or the family list updates its key, one case per write),
`src/lib/api/server-fallback.test.tsx` (the server's copy replaces an older answer without a request,
the older one shows meanwhile, a failed copy asks, a key the page didn't send is left alone),
`src/app/(app)/layout.test.tsx` and `app-shell-client.test.tsx` (the summary and the notices start
in the layout, equal to their routes' answers, failure logged and left to the browser, shell drawn
before they arrive), `src/components/layout/intent-link.test.tsx` (which links prefetch when visible),
and the two lint rules' RuleTester files. Checks: `npm run lint`, `npx next typegen && npm run typecheck`,
`npm test` (342 files, 6,984 tests passed, 1 skipped), `npm run build`: all pass.

#### 5. How to check it yourself

1. `npm run lab -- up && npm run lab -- delay 40`.
2. `node scripts/lab/navigation.mjs --width 1280` (about 3 minutes): the table in 4 for your machine.
   Every tap should list no `api` requests and `depth 1`.
3. In the browser, signed in as the parent, with the network panel open, move Home → Expenses →
   Reminders → To-dos: no `/api/…` request at all, on the first visit or later. Leave the tab, come
   back: `/api/account` and `/api/family` are read again once.
4. Settings → change the currency: `/api/account` is updated and `/api/family` is read again.
5. Open To-dos about twenty times (reload): the console has no "hydration" error.
6. `npm run lab -- down`.

#### 6. Risks and how to undo it

- **A change made elsewhere shows later.** The account and the family list are read again when you return
  to the app and after your own writes, not when a page opens. A kid whose permissions a parent changes on
  another device keeps the old buttons until they return to the app (the server refuses what they may
  no longer do either way). Someone who joins the family shows in the member list at the next return.
  Settings → Family reads the list on every visit.
- **Focus revalidation is throttled by SWR** (a return within 5 s of the page mounting doesn't read again).
- **The page's server copy replaces SWR's own.** If SWR's answer for a page's key were newer than the
  copy (a refresh landing while the page's answer is still streaming), the older one wins until the
  next read. I did not see it; the window is the page's few hundred ms.
- **The layout starts two more reads on every cold load** (`reminderSummary`, `loadNotices`; Supabase
  calls per cold load still fell by 8 because the browser's two requests each cost four). A failure of
  either is logged as `server_prefetch_failed` (route `(app) layout`) and the browser asks instead.
- **Settings and More are no longer prefetched by sight.** A tap with no earlier hover or touch commits in
  100 to 160 ms (lab). One line each to undo (`prefetchOnIntent` in `nav-items.ts`, and `IntentLink` in
  `settings-nav.tsx`).
- **The hydration error was in the board before this task** and could surface again if a render is
  repeated in a way the id doesn't cover; the lint rule keeps new boards from having none.
- No migration, nothing stored. Revert the PR to undo everything; the routes' answers are unchanged.

#### 7. Left open

- **Calendar** (9 API requests, 62 Supabase calls per load) was not touched, as asked. Its waterfall
  was not measured here beyond that count; moving it to the server is its own task.
- **Auth calls per prefetch**: every link prefetch still costs one Auth call (the proxy's `getClaims`).
  Cold loads now make 11, 8, 9 and 7. The workaround waits on the signing-keys decision (row 4).
- **`useServerFirstSWR` bookkeeping** stays (see 3 for why `preload()` didn't replace it).
- **Categories**: there is nothing to cache (the list is in the code).
- **Not measured**: the VPS and a real phone; Lighthouse (not run, the observed numbers are the
  evidence); the gzipped size of the JS added (+3.4 to 5.4 KiB, transferred); the hydration error
  on Home, Insights, Investments and the Calendar beyond one 20-load run of kid Home (0).
- **Two unexplained hydration errors** (see 3), on kid Reminders and kid Expenses once each, before the
  board fix. 60 loads of those two pages after it showed none.
- The lab sweep of Expenses' and To-dos' writes after the change (add, edit, delete) was not repeated by
  hand; their code is untouched and their unit tests pass.

### PF9: Smaller bundles

#### 1. The problem

Every page started by downloading about 400 KiB of JavaScript (gzipped, Home 397.3, Expenses 422.3,
To-dos 413.3, Reminders 395.0 at the start of this task), and none of it could be skipped: the
browser needs the scripts before the page responds to a tap, and the phone spends time running
them. The budgets PF1 proposed were 20% less (Home 308.4, Expenses 329.4, To-dos 322.2, Reminders
307.4 KiB). A look inside the files showed three things that no page needed:

- **Zod**, a validation library (about 23 KiB gzipped), was on every page, even the offline page.
  The browser's error reporter used the server's Zod schema to check each report, and the shared
  expense-filter code, which every page imports for the SWR keys, also imported Zod.
- **Chakra's theme carried a style recipe for each of its 75 or so components**, including date
  pickers, trees and sliders the app never shows: about 15 KiB gzipped.
- **Things used by a tap or a hover were in the first load**: the quick-add sheet's four forms, every
  dialog and sheet, and the code that places menus and tooltips next to their buttons (about 26 KiB).

#### 2. What changed

**What a person notices.** Nothing looks different (checked at 390 and 1280 px, see 5). Pages are
smaller to download before they work (see 4); in the lab the main thread is busy for less time while
the page loads (observed blocking time down 7 to 52% on the four pages). Menus and tooltips appear after the
page does: the browser fetches that code when it is idle or when a finger, the pointer or the
keyboard reaches a button. Until then the button is a plain button that looks the same; a tap before
the code arrives opens the menu as soon as it does.

**How it works.**

- **No Zod in the shared code.** `src/lib/log/client-event.ts` (new) holds the report's types, limits
  and a hand-written `isClientEvent`; `client-report.ts` keeps the Zod schema for the server and
  re-exports it. `src/lib/expenses/tab-filters.ts` (new) holds the filter types, the URL parameters and a
  hand-written reader; `filters.ts` keeps the schema. `instrumentation-client.ts` sets Zod's
  `jitless` flag on `globalThis.__zod_globalConfig` instead of importing Zod. Tests run the hand-written
  and the Zod versions on the same inputs and fail if they disagree, and the schema fails to compile
  if its type drifts from the hand-written one.
- **A trimmed Chakra theme** (`src/components/ui/theme/chakra-defaults.ts`): `defaultBaseConfig` plus
  the default tokens and only the 12 recipes and 16 slot recipes of components the app imports. The
  tests check the page CSS is identical to the full default theme's, every kept recipe equals the full
  theme's, and no component imported anywhere in `src` has its recipe left out.
- **Sheets and dialogs load when first wanted** (`lazySheet` and `useOpenedOnce`, `src/components/ui/lazy-sheet.tsx`):
  the quick-add sheet, the edit-expense sheet, the tab dialog and the delete confirmation, the reminder,
  snooze and log-expense dialogs, the to-do dialog, the sign-out confirmation and the account notice. The
  saved expense tab's screen is loaded with `next/dynamic`.
  Each is preloaded when a pointer, a focus or a touch reaches its page or button (`preloadOnIntent`); the quick-add
  sheet is also preloaded when the browser is idle (`preloadWhenIdle`), so its `+` is as quick as before.
  A tap before the script has come shows a dimmed screen with a spinner.
- **Menus and tooltips load when idle** (`lazy-menu.tsx`, `menu-parts.tsx`): the six menus and the icon
  button's tooltip render a plain button first and swap to the real one when the code is in, keeping focus.
  A new lint rule, `local/lazy-popper`, stops anyone importing Chakra's `Menu`, `Tooltip` and the like directly.
- **The budget and the checks.** `docs/performance-budget.json` holds the numbers; `npm run size:routes -- --check`
  fails when a page is more than 2% over; `scripts/server-only-check.mjs` fails when `openai`, `unpdf`, `web-push`,
  `sharp`, `fflate` or `@modelcontextprotocol/server` is in a browser chunk. Both run in the "Lint, types, tests and
  build" job after the build, which now sets `BUNDLE_MODULES=1` so the build writes which modules are in each browser chunk
  (`src/lib/build/client-modules-plugin.ts`, off otherwise).
- **Avatars** have a width and height, decode asynchronously and load lazily (the sidebar's and the More page's are eager).
- `import "server-only"` was added to `mcp/define-tool.ts`, `mcp/server.ts`, `imports/pdf-text.ts` and
  `notifications/push.ts`, the four server files that import those packages without it.

#### 3. Why this way

- **Measured per step, not guessed.** Gzipped first-load JS of Home, Expenses, To-dos, Reminders
  (`npm run build && npm run size:routes`):

  | Step | Home | Expenses | To-dos | Reminders |
  | --- | ---: | ---: | ---: | ---: |
  | `main` at 0c4db9a | 397.3 | 422.3 | 413.3 | 395.0 |
  | Zod out of the reporter, quick-add sheet lazy | 369.6 | 394.2 | 382.7 | 370.3 |
  | Zod out of the filters (so out of every page) | 342.9 | 394.5 | 356.3 | 343.8 |
  | Trimmed Chakra theme | 331.7 | 383.2 | 345.0 | 332.6 |
  | Sheets and dialogs lazy | 317.9 | 335.0 | 332.2 | 308.9 |
  | Menus and tooltips lazy | 289.8 | 308.6 | 300.7 | 280.9 |

  Each lazy group saves at least 10 KiB on every page it was applied to: sheets and dialogs 13.8, 48.2, 12.8 and 23.4
  KiB; menus and tooltips 28.1, 26.4, 31.5 and 28.0 KiB. The quick-add sheet was measured together with the reporter's
  Zod, not on its own (the two changes were one step), so its own saving is **not measured**. A single dialog (the
  reminder one, say) saves less than 10 KiB alone: they only leave the page together, because the dialog machinery (Chakra's
  Dialog, a focus trap) is shared by all of them, so I kept them as one group.
- **`instrumentation-client.ts` could not import Zod's `config`**: even `import { config } from "zod/v4/core"`
  pulled the whole core (23 KiB) into every page, because Zod marks one module as having side effects.
- **Why a deep import for the theme.** `@chakra-ui/react/theme` imports every recipe, and a recipe is plain data that no
  bundler removes (I tried it: the pages got 3.9 KiB bigger). Importing the files directly through an alias
  (`@chakra-theme`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`) is the only way to leave them out.
  It depends on Chakra's file layout, which is pinned (3.36.1); an upgrade that moves the files fails the build.
- **Why `lazySheet` is not `next/dynamic`.** `dynamic` suspends the first time it renders even when its script is
  already loaded. My first version cost a quick-add tap 270 ms on a 4x slower CPU (175 ms to 449 ms); the
  replacement renders the loaded component at once (195 ms, see 4). `next/dynamic` stays for the saved tab, which
  is content, not a sheet.
- **A pending state on the sheet, not on the button.** The brief asked for a pending button. A dimmed screen with a spinner
  appears at once and works for every opener (row actions, shortcuts), without each button learning a loading state.
  Plain Chakra, not `AppDialog`, so the dialog code stays out of the first load. I judged this equivalent; say if you want
  the button version.
- **dnd-kit stays.** The to-do board's cards call `useSortable` and the columns are drop targets inside one `DndContext`;
  a read-only first render would be a second copy of both, swapped in after loading (remounting every card). That is the
  case the plan says to leave. It is 16.8 KiB gzipped of To-dos' 299.8.
- **Avatars, no `next/image`**, as the plan said: they are small WebP squares already, and the optimiser would run sharp
  in the web container for every new size [N11]. The avatar route already answers `Cache-Control: private,
  max-age=31536000, immutable` (checked in its test). `loading="lazy"` has little effect here: Chakra's avatar loads the
  picture itself with a script `Image` before it shows the `<img>`.
- **Dependencies**: I checked every dependency against `src`, `scripts` and the configs. Each is used; I removed none.
- Sources: [N8] (analyzer), [N10] (lazy loading), [N11] (images), read in `node_modules/next/dist/docs/`.

#### 4. Numbers

Gzipped first-load JS per page, from `npm run build && npm run size:routes` (`main` at 0c4db9a, then this branch). Budgets from
`docs/performance-budget.json`:

| Page | Before (KiB) | After (KiB) | Budget (KiB) |
| --- | ---: | ---: | ---: |
| Home `/dashboard` | 397.3 | 288.9 | 308.4 |
| Expenses | 422.3 | 308.9 | 329.4 |
| To-dos | 413.3 | 299.8 | 322.2 |
| Reminders | 395.0 | 279.9 | 307.4 |
| `/login` (not a target) | 278.9 | 241.6 | 273.1 |
| Shared by all pages | 247.9 | 210.6 | |

All 24 pages are within their budget (`npm run size:routes -- --check`). Every target page is 19 to 27 KiB under it.

**Server-only packages.** `BUNDLE_MODULES=1 npm run build && node scripts/server-only-check.mjs`: none of the six is in any
of the 238 browser chunks. I also proved the check works: a test import of `fflate` in a client component failed it (exit 1),
and I reverted that.

**The lab** (`npm run lab:measure -- /dashboard /expenses /todos /reminders --json`, slow 4G mode with Lighthouse 13.6.0
and 3 runs; then `--throttle cpu --no-lighthouse`; delay 40 ms; same machine, `main` built and measured first, then this branch;
Lighthouse was run only in the slow-4G pass). "Data" is when the page's first data string is on screen. Observed values are medians of 3.

| Page | JS transferred, whole cold load (KiB) before / after | LCP, observed, ms | TBT, observed, ms | TBT, Lighthouse, ms | LCP, Lighthouse, ms |
| --- | --- | --- | --- | --- | --- |
| Home | 435.4 / 439.7 | 1,412 / 1,416 | 276 / 170 | 491 / 368 | 4,515 / 4,822 |
| Expenses | 461.0 / 455.0 | 1,472 / 1,452 | 559 / 521 | 1,907 / 1,064 | 5,020 / 5,131 |
| To-dos | 453.4 / 452.0 | 1,428 / 1,428 | 260 / 130 | 306 / 253 | 2,804 / 909 |
| Reminders | 431.8 / 428.9 | 1,420 / 1,408 | 202 / 97 | 311 / 216 | 913 / 909 |

| Page | Data on screen, slow 4G, ms | LCP, CPU only, ms | Data on screen, CPU only, ms | TBT, CPU only, ms |
| --- | --- | --- | --- | --- |
| Home | 1,369 / 1,357 | 784 / 684 | 717 / 606 | 330 / 208 |
| Expenses | 1,410 / 1,410 | 908 / 776 | 768 / 651 | 665 / 625 |
| To-dos | 1,368 / 1,369 | 320 / 356 | 746 / 577 | 300 / 174 |
| Reminders | 1,363 / 1,350 | 536 / 644 | 692 / 586 | 216 / 138 |

What this says, and what it does not:

- **The JS the browser downloads in a whole cold load did not fall** (435 to 440 KiB on Home). The first-load files are 108 KiB
  smaller, but the lab's load runs on until the page is idle, and by then the browser has also fetched the menu code, the quick-add
  sheet and the scripts of the pages Next prefetches (PF3). The code is the same size; it now arrives after the page is usable
  instead of before. I did not set out to cut total bytes and did not.
- **Blocking time fell** on every page (observed 38%, 7%, 50% and 52% on Home, Expenses, To-dos and Reminders; in the CPU-only pass 37%, 6%, 42% and 36%).
  The page's own work no longer includes starting Zod or building the whole theme.
- **LCP did not move on slow 4G** (observed, same 1.4 s): its cost is the network latency of the page and its data, not the scripts.
  Lighthouse's simulated LCP is noisy and did not improve on Home (4.5 to 4.8 s; its three runs span 0.7 s) and moved by large amounts on To-dos
  (2.8 s to 0.9 s) that I do not take as a result of this change (it is a simulation, and the page's data arrives at the same time in both builds). **PF6's hope that smaller bundles would
  bring Home's Lighthouse LCP down was not met in this measurement.** With the CPU slowed only, observed LCP and data fell on Home and
  Expenses (by 70 to 130 ms) and Reminders' LCP rose by 108 ms: the spread across runs is of that size, so I call that noise.
- The laptop was busy (load average 3 to 9) and the runs are 3 each; treat differences under about 100 ms as noise.

**First tap on a sheet** (CPU 4x slower, 390 px for quick-add, 1280 px for Edit, median of 5 fresh browsers; a scratch script,
not committed):

| Tap | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Quick-add `+`, 6 s after load (preloaded) | 175 | 195 |
| Quick-add `+`, 0.1 s after load (not preloaded) | 584 | 622 |
| Edit on an expense row, 6 s after load | 481 | 542 |
| Edit on an expense row, 0.1 s after load | 1,616 | 1,283 (4 of 5 runs failed to find the button, **not reliable**) |

A tap after the preload costs 20 to 60 ms more than before: the sheet's first render now also builds the form's Zod schemas, which
used to be built when the page loaded.

#### 5. How to check it yourself

1. `npm run build && npm run size:routes -- --check`: the table, every page "OK". Edit a number in `docs/performance-budget.json`
   down by 30 and run it again: it fails and says which page.
2. `BUNDLE_MODULES=1 npm run build && node scripts/server-only-check.mjs`.
3. `npm run lab -- up`, sign in (`.lab/users.json`) at <http://localhost:3110>. At 390 px and 1280 px: open Home, Expenses, To-dos and
   Reminders (they look as before), tap `+` (the amount field has focus), tap an expense's Edit, tap `⋯`, hover a row action (its tooltip).
   `npm run lab -- down` when done.
4. The numbers in 4: `npm run lab -- app --delay-ms 40`, then `npm run lab:measure -- /dashboard /expenses /todos /reminders` on `main`
   (`git switch --detach origin/main` first) and on the branch.

#### 6. Risks and how to undo it

- **Menus and tooltips swap their buttons when the code arrives.** The swap keeps focus (tested) but remounts the button, so a hover in
  progress loses its tooltip once. A tap before the code is in opens the menu on arrival. If the code never loads (offline), menus do not
  open; they try again on the next touch. Revert PR to undo.
- **The theme's deep import depends on Chakra's file layout.** An upgrade that moves the files breaks the build with a clear
  error, and the theme test compares the CSS with the full theme's. A component whose recipe is left out renders unstyled with no error;
  `theme.test.tsx` checks the imports in `src` against the kept list.
- **The hand-written report and filter checks must follow their schemas.** Tests run both on the same inputs; a new field needs both.
- **The sheet's first render is 20 to 60 ms slower after the preload** (see 4).
- **The size check is as loose as its numbers.** Non-target pages are held to their PF1 baseline, which they are now 40 to 100 KiB
  under: a regression of that size would pass. Tighten them in `docs/performance-budget.json` if you want.
- Everything is one commit: reverting the PR restores all of it, including the budget file and the CI steps.

#### 7. Left open

- **George has not confirmed the budgets** (Waiting for George, row 5). They are in `docs/performance-budget.json`.
- **dnd-kit (16.8 KiB) was left in To-dos' first load**, see 3. Chakra's runtime (about a third of every page) is the next lever, as PF1 said;
  its own plan, not done here.
- **`@next/bundle-analyzer` was not added.** `next analyze` works (Turbopack), but its chunks differ from the real build's and it counts
  lazy chunks; I used a small webpack plugin (`BUNDLE_MODULES`) for the real build's modules instead. Chakra's share of the shared
  files is not re-measured here.
- **Not measured:** the VPS, a real phone; the quick-add sheet's saving alone; the "Edit, 0.1 s after load" tap; Lighthouse in the CPU-only pass.
- **Lighthouse LCP on Home is still about 4.8 s** (see 4): the lever PF6 named did not move it here.
- The decimal.js (12 KiB) in Expenses and the SWR/Next runtime stayed; they are the page's own content.

### PF10: SQL: indexes and RLS for the slow queries

#### 1. The problem

The plan expected a migration of indexes for slow database queries. Nothing a person waits for
suggested one. The slow pages (Insights, Investments and Net worth settle in about 1.3 s in the lab with a fast network and 40 ms to
Supabase, and PF7 saw them at about 7 s on slow 4G) are slow from the number of requests one after
another, not from the database: PF7 counted 9 API requests and 62 Supabase calls on one Calendar load, and
each call pays the network round trip, not the query. The question for this task was whether the database
itself was the slow part anywhere, and whether an index would fix it.

#### 2. What changed

**Nothing in the app or the database.** No migration, no function, no policy and no index is added.
Only this document changed (and a line in `docs/lab.md` on turning on `pg_stat_statements`).

The reason is the plan's own rule: "add only what a slow query uses". I looked for slow queries four ways
(section 3) and none of them was slow because an index was missing. What I did find is one query that is
slow for another reason, and a fix I measured but did not ship (section 3, "The one slow query").

#### 3. Why this way

**What I looked at**

1. **The performance advisor on the live project** (`get_advisors`, type `performance`, read-only, 11 November 2026,
   19:07 UTC). It reported three kinds of finding:
   - `auth_rls_initplan` (a policy calls `auth.uid()` once per row instead of once per query): **none**.
   - Five foreign keys without an index (`app_flags.updated_by`, `calendar_events.created_by`, `families.creator_id`,
     `todos.completed_by`, `todos.created_by`), level INFO.
   - Eight unused indexes (the list for you is in section 7).
2. **The policies themselves, on the lab's database** (built from the migrations, the same schema as live). The plan
   said 4 of 46 `auth.uid()` calls in policies were still bare. Searching the migrations for `auth.uid()` finds 46
   lines, and every one is either wrapped as `(select auth.uid())`, a comment, or the body of
   `app_private.current_user_id()`. Checking the result rather than the text: of the 69 policies in the `public` schema, none
   has a call to `uid()` or `current_user_id()` outside a `( SELECT … )` (the query is in section 5). So the
   "4 bare calls" were a miscount of comments and that function's body, and there is nothing to rewrite. This agrees with the advisor.
3. **`pg_stat_statements` on the lab** (the extension was already on; I set `pg_stat_statements.track = 'all'` so queries inside
   functions show up, then reset it). I ran PF4's route probe (28 routes, 5 runs each, 40 ms delay) and loaded Calendar, Insights,
   Investments and Net worth once. The top entries by total time are in section 4.
4. **`explain (analyze, buffers)` on the queries behind the top entries**, as the signed-in parent (role `authenticated` with the
   user's JWT claims, so row level security applies), on the lab's data: 6,665 expenses over three years (Alex 3,729, Sam 2,656,
   Robin 264, one solo user 16). Then again with the smaller tables scaled up inside a transaction that was rolled back (1,500 extra
   calendar events with attendees, 3,000 investment orders, 40 net-worth items with 36 valuations each), to see whether
   a plan changes when the tables are a lot bigger than the seed.

**What I found**

- Every expenses query uses one of the existing indexes (`expenses_user_date_created_idx`, `expenses_user_category_date_idx`).
  Own-rows queries take 0.1 to 2.5 ms. Calendar's month query takes 0.74 ms with 1,514 events (it reads the whole table, 171 buffers, because
  a month window is not selective enough for the planner to prefer the index; reading the last two years uses
  `calendar_events_family_id_starts_at_idx` in 3.2 ms). Investments with 3,005 orders takes 1.2 ms and Net worth with 43 items and
  about 1,450 valuations 1.6 ms. An index added to any of these would save well under a millisecond, and every index slows every write.
- **The one slow query: reading another family member's rows.** The select policy on `expenses` (and on the other finance tables)
  is `user_id = (select current_user_id()) or family_private.can_view_finance_of(user_id)`. Your own rows pass the first half
  at once. Someone else's rows call the helper once **per row**, and each call does four small indexed lookups
  (`family_members` by user, `my_family_id()`, `member_level()`, `member_permissions`). That is 2,812 calls and 639 ms of the lab's
  total in the table below. Alex reading Sam's month page: 5.5 ms. Alex reading Sam's dashboard (a year of 1,605 rows): **113.6 ms and 7,182
  buffers**. An index can't help: each lookup is already an index lookup, there are just a lot of them. A ledger search on Sam's rows
  reads about 4,600 buffers for the same reason (the plan applies the policy to every row the index returns, before the search's `ilike`).
- **A fix that works, which I did not ship.** Replace the helper call with a sub-select that Postgres runs once per query:
  `user_id = (select app_private.current_user_id()) or ((select family_private.member_level('family_finance')) in ('view','edit') and user_id in (select m.user_id from public.family_members m where m.family_id = (select family_private.my_family_id())))`.
  In a rolled-back transaction on the lab it took Sam's dashboard from 113.6 ms to 10.1 ms (656 buffers), and the parent still sees 6,649 rows
  of the 6,665. With it applied to the lab's `expenses` policy I ran the route probe again: the family dashboard (`/api/dashboard?member=all`)
  went from 303 to 229 ms of server time (median of 5, 40 ms delay) and the family expenses list from 255 to 232 ms; no other route moved by more than
  noise (a few ms). I then ran `npm run test:db` with that policy as a temporary migration: 876 assertions pass, and one fails:
  `family_finance_rls.sql` test 4 ("every select policy checks the owner first, then can_view_finance_of"), which pins the policy's text.
  The plan says RLS tests must pass unchanged, the policy is on financial data, and the author of that migration chose the per-row helper on purpose
  (its comment calls it "acceptable at family scale"), so I left it as a decision (Waiting for George, row 6). If you say yes, it needs the same
  rewrite on the other five finance policies, that test updated to the new shape, and the existing RLS tests run unchanged against it.
- **The five unindexed foreign keys** matter only when a row they point to is deleted (the database looks for rows that refer to it, and without an
  index that is a scan of the table). Mainly account deletion does that. In the lab the scan costs nothing measurable (the largest of those tables has 22 rows), and no slow query uses them. They are not in a migration. If you want them anyway (cheap, and the
  family tables will grow), this is the SQL, with the index name the advisor would expect:

  ```sql
  create index if not exists todos_created_by_idx on public.todos (created_by);
  create index if not exists todos_completed_by_idx on public.todos (completed_by);
  create index if not exists calendar_events_created_by_idx on public.calendar_events (created_by);
  create index if not exists families_creator_id_idx on public.families (creator_id);
  create index if not exists app_flags_updated_by_idx on public.app_flags (updated_by);
  ```

**Options turned down.** Adding the five foreign-key indexes anyway "because the advisor says so": the plan says only what a slow query
uses, and the advisor itself rates them INFO. A covering index on `expenses (user_id, expense_date) include (amount, category)` for the
dashboard, so it could skip the table: the own-rows dashboard scan already takes 0.58 ms. A trigram index for the ledger's `ilike`
search: the index on user and category already cuts the rows to a few thousand, and the search then takes about 2 ms. A cache or a
function to hold the member list: PF10 allows no functions. Sources: [S5] for wrapping `auth.uid()` and indexing policy columns (nothing left to do
here), [S6] and [S7] for the advisor and `pg_stat_statements` used above.

#### 4. Numbers

The lab, 40 ms to Supabase, the parent signed in. Top statements by total time after the route probe and four page loads
(`pg_stat_statements`, reset first, `track = 'all'`; the query that produced it is in section 5, run on the lab). Authentication
queries and Postgres' own are left out.

| Total ms | Calls | Mean ms | Buffers per call | Statement |
| ---: | ---: | ---: | ---: | --- |
| 639 | 2,812 | 0.23 | 6 | `family_private.can_view_finance_of(owner)`, the per-row policy helper |
| 570 | 27 | 21.11 | 647 | `rpc get_expense_dashboard` (the function body alone: 525 ms, 19.4 mean); a few of the 27 calls are other members' |
| 265 | 73 | 3.62 | 177 | `rpc get_family()` |
| 190 | 25 | 7.61 | 165 | the tab ledger: expenses in some categories for one owner, newest first |
| 185 | 10 | 18.46 | 138 | the same with a search on description, notes, category or subtype |
| 181 | 20 | 9.05 | 161 | the Expenses page: one owner, one month, newest first, with a count |
| 167 | 104 | 1.60 | 91 | `rpc get_my_membership()` |
| 163 | 3,204 | 0.05 | 2 | `family_private.my_family_id()` (called by the policy helper and the family policies) |
| 125 | 2,812 | 0.04 | 2 | the lookup inside `member_level()` (called by the policy helper) |

The next entries are under 80 ms in total each. A route's `dbMs` is mostly the delay, not the queries: `/api/dashboard` makes 5
database calls and reports 265 ms, about 40 ms each plus a few ms of query time.

`explain (analyze, buffers)` as the parent, before (nothing changed, so there is no "after"):

| Query | Plan | Execution | Buffers |
| --- | --- | ---: | ---: |
| Dashboard rows, own, 12 months (1,605 rows) | bitmap scan on `expenses_user_date_created_idx` | 0.58 ms | 99 |
| `get_expense_dashboard`, own | the same, inside the function | 2.5 ms | 344 |
| Expenses page, own, one month (57 rows) | the same index, sort 57 rows | 0.11 ms | 12 |
| Tab ledger, own, 3 categories (2,032 rows, limit 1000) | bitmap scan on `expenses_user_category_date_idx` | 1.0 ms | 75 |
| Tab ledger search, own | the same, then `ilike` on 2,032 rows | 2.2 ms | 75 |
| Expenses page, Sam's month (40 rows), read by Alex | the same index, policy helper per row | 5.5 ms | 399 |
| `get_expense_dashboard`, Sam's (1,605 rows), read by Alex | the same, helper per row | **113.6 ms** | **7,182** |
| The same with the rewritten policy (rolled back, not shipped) | sub-select once | 10.1 ms | 656 |
| Calendar, one month, 1,514 events (scaled) | seq scan 171 buffers, then attendees by key | 0.74 ms | 583 |
| Calendar, two years (scaled) | `calendar_events_family_id_starts_at_idx` | 3.2 ms | 9,556 |
| Investments, 3,005 orders (scaled) | seq scan, top-N sort | 1.2 ms | 40 |
| Net worth, 43 items, about 1,450 valuations (scaled) | seq scan on items, valuations by `net_worth_valuations_item_valued_on_idx` | 1.6 ms | 657 |

Page timings in the lab before this task (no migration, so none after): the CPU-only pass, 40 ms delay, parent, median of 2 loads.
"Settled" is when the last loading placeholder left; Home, Expenses, To-dos and Reminders have data in the HTML so their "content"
is the same moment.

| Page | Content or settled (ms) | Supabase calls in the load | Auth calls |
| --- | ---: | ---: | ---: |
| `/dashboard` | 647 | 24 | 11 |
| `/expenses` | 672 | 18 | 8 |
| `/todos` | 637 | 18 | 9 |
| `/reminders` | 531 | 15 | 7 |
| `/calendar` | 1,560 | 54 | 23 |
| `/insights` | 1,368 | 32 | 19 |
| `/investments` | 1,257 | 25 | 13 |
| `/net-worth` | 1,280 | 28 | 15 |

Route server times with 40 ms to Supabase, before and with the prototype policy applied (lab only, median ms of 5; only the rows that moved):

| Route | Before | Prototype policy |
| --- | ---: | ---: |
| `/api/dashboard?member=all` | 303 | 229 |
| `/api/expenses?member=all` | 255 | 232 |

The other 26 routes were within 10 ms of their "before" in the three probe runs I made (for example `/api/calendar` list 225, 225, 229).

Commands (all against the lab, `npm run lab -- up`, then `npm run lab -- delay 40`):

```bash
node scripts/lab/search-compare.mjs > /dev/null                       # makes the tab the probe needs
node scripts/lab/route-probe.mjs .lab parent 5 > routes.json          # the per-route table
npm run lab:measure -- /dashboard /expenses /todos /reminders /calendar /insights /investments /net-worth \
  --user parent --runs 2 --no-lighthouse --throttle cpu               # the page table
# the statements table and the explain rows: the queries in section 5, run with psql inside the lab's database container
```

#### 5. How to check it yourself

1. **The advisor, read-only.** In the Supabase dashboard open Advisors, Performance. You should see the five unindexed
   foreign keys and the eight unused indexes, and no `auth_rls_initplan` item.
2. **The policies, on any database built from the migrations.** This returns no rows when every policy wraps its caller lookups:

   ```sql
   select tablename, policyname
   from pg_policies
   where schemaname = 'public'
     and (coalesce(qual, '') || coalesce(with_check, '')) ~* '(uid|current_user_id)'
     and regexp_replace(coalesce(qual, '') || coalesce(with_check, ''), '\( *SELECT +[a-z_.]*(uid|current_user_id)\(\)', '', 'gi') ~* '(uid|current_user_id)\(\)';
   ```

   Run it on the live project in the SQL editor too: it only reads.
3. **The real query mix (Waiting for George, row 8).** In the live project's SQL editor, which only reads here:

   ```sql
   select calls,
          round(total_exec_time::numeric, 0) as total_ms,
          round(mean_exec_time::numeric, 2) as mean_ms,
          round((100 * total_exec_time / sum(total_exec_time) over ())::numeric, 1) as pct_of_all,
          rows / greatest(calls, 1) as rows_per_call,
          (shared_blks_hit + shared_blks_read) / greatest(calls, 1) as buffers_per_call,
          left(regexp_replace(query, '\s+', ' ', 'g'), 220) as query
   from pg_stat_statements
   where query !~* '^(set|begin|commit|show|deallocate|rollback)'
     and query !~* 'pg_stat_statements|pg_get_|pg_class|pg_attribute|pg_namespace|supabase_migrations|cron\.'
   order by total_exec_time desc
   limit 20;
   ```

   The default setting is `pg_stat_statements.track = 'top'` (the lab's was), so a function's inner queries show up as the one call,
   not as separate lines; the lab's numbers above used `all`. Anything with a mean over about 20 ms and many calls is worth an
   `explain (analyze, buffers)` in the lab before an index is proposed.
4. **Reproduce the lab numbers.** `npm run lab -- up`, then in the database container
   (`docker exec -it supabase_db_expense-tracker-lab psql -U supabase_admin -d postgres`) run
   `alter system set pg_stat_statements.track = 'all'; select pg_reload_conf(); select pg_stat_statements_reset();`, run the commands
   in section 4, and read `pg_stat_statements`. For an `explain` as a signed-in user, inside a transaction:
   `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<user id from .lab/users.json>","role":"authenticated"}', true);`
   and then `explain (analyze, buffers) …`; finish with `rollback`.
5. **That nothing changed:** `git diff --stat origin/main -- supabase` is empty on this branch. `npm run test:db` passes as on `main`.

#### 6. Risks and how to undo it

There is no code or schema change, so there is nothing to undo; reverting the PR only removes this text.

- **The conclusion rests on the lab's data.** It is three years of a four-person family, plus scaled-up copies of the small tables. Production's
  stats may differ (more months, more tabs, other usage). That is why row 8 asks for the real `pg_stat_statements` before anyone says "no index is needed" for good.
- **The advisor sees only what has run on live.** "Unused" means no scans since the stats were last reset; a young project reports
  many indexes unused.
- **The measured fix in section 3 is not tested against the whole suite.** I ran `npm run test:db` with it: one failure, the test that pins the policy's text.
  The other 876 assertions pass, but I haven't written the matching update, and I only changed the `expenses` policy.

#### 7. Left open

- **No migration, so nothing to apply live.** The plan's checkpoint ("George approves applying PF10's migration live") has nothing to approve unless
  you choose one of rows 6 or 10. The plan's "done when no route's server p95 is over 300 ms" couldn't be checked here: it needs the VPS's request
  lines (row 1, `scripts/perf-report.sh`). In the lab three routes are over 300 ms: the family dashboard (303), the Everything tab (435, a 629 KB response from four
  expenses reads) and a search on it (317). Only the first is slow in the database.
- **Waiting for George:** row 6 (the policy rewrite), row 8 (`pg_stat_statements` on live) and row 10 (the five foreign-key indexes).
- **The advisor's eight unused indexes, for you.** I dropped none. The migration comments say why each exists, and most of them are there to make a delete
  or a cascade cheap, which is why they show no scans:

  | Index | On | Why it exists (from its migration) |
  | --- | --- | --- |
  | `categories_user_id_idx` | `categories` | Legacy tracker table; not in the current migrations, so I can't say |
  | `expenses_user_id_category_id_idx` | `expenses` | Legacy category foreign key, with `expenses_category_id_user_id_idx` (migration `20260823152318`) |
  | `expenses_category_id_user_id_idx` | `expenses` | The same legacy foreign key |
  | `ai_request_leases_expires_at_idx` | `private.ai_request_leases` | Clearing expired AI request leases |
  | `profiles_managed_by_family_idx` | `profiles` | Deleting a family sets its kids' `managed_by_family` to null (partial index) |
  | `reminder_completions_expense_id_idx` | `reminder_completions` | Deleting an expense (cascade) |
  | `todos_assignee_member_id_idx` | `todos` | Removing a member (cascade) and the assignee filter |
  | `ai_usage_user_id_created_at_idx` | `ai_usage` | The AI gate's spend sums and the owner's reads |

  I would keep the ones that serve a cascade or a delete (the cost is a few kilobytes and one extra write per row). The two legacy `expenses`
  indexes and `categories_user_id_idx` are the candidates for a drop, because their table (`categories`) is legacy; check that nothing in the
  legacy tracker still reads it first. Not checked: whether anything outside this repository uses them.
- **"Add a kid" (`permission denied for function my_kid_ai_permitted`, row 3)** changes a function's grants, so it is not in this task. Nothing here
  changes it.
- **Not measured:** the live database's own query times and plans, the VPS, and `get_family()` and `get_my_membership()` beyond their
  3.6 and 1.6 ms means (they are small and run on indexed tables; they are called many times per page, which is PF4's and PF7's subject, not an index).

### PF11: Smooth interaction

#### 1. The problem

On a phone-speed CPU, three things on Expenses made a tap feel stuck. Tapping the previous or next month froze
the screen for about a second. Tapping "Filters" froze it for 0.9 s, and each letter typed in the search took
about 0.3 s to appear. The month with the most rows (the lab's family has about 290 expenses in a full month; you
see about 150 of them as yourself) was the worst case. Other taps were fine: quick add, a reminder's Done,
dropping a to-do card and typing an amount each took 0.05 to 0.4 s.

INP, "Interaction to Next Paint", is the time from a tap or key press until the screen next changes. A page's INP
is its slowest interaction, and "good" is under 200 ms for the 75th percentile of visits [S12].

Adding a net-worth value was already optimistic when this task started (phase 17's U9 built it): the plan's
description of it as "left" was out of date. What it lacked was SWR's own rollback and a test against real SWR.

#### 2. What changed

**Behaviour**
- Expenses: a month's rows draw in two steps (the first 30, then the rest, while the browser can still answer a
  tap). The old month stays, dimmed, until the new one is in. Rows no longer draw again when you open Filters, type in the
  search or delete another row. Typing in the search is answered first and the list follows a moment later.
- The pages' menus and tooltips: when their code arrives, the buttons swap in 24 at a time instead of all at once.
- Expenses, Reminders and Home start loading their dialogs when the browser is idle after the page loads, not at
  your first touch. To-dos keeps loading on touch (section 3).
- Net worth: adding a value uses SWR's `optimisticData` and `rollbackOnError`. It looks the same as before: the row
  shows the value at once, the sheet closes when the server answers, and a refused value puts the row back and shows the
  error in the sheet.
- No React Compiler (section 3).

**Files**
- `src/components/net-worth/use-net-worth-writes.ts`: `addValuationOptimistically` is one `mutate` call with `optimisticData`,
  `rollbackOnError: true`, `populateCache: false`. Tests: `use-net-worth-writes.swr.test.tsx` (real SWR, 422 and 500 roll back,
  starts from the cached copy) and `use-net-worth-writes.test.ts`.
- `src/components/expenses/expense-rows.tsx`: memoized row items, `useDeferredValue(expenses, firstRows)`, stable handlers.
  `ledger-panel.tsx`: the search is a deferred value and the filtered list is memoized. `expense-rows.test.tsx`: a test
  that unchanged rows don't draw again.
- `src/lib/client/lazy-module.ts` (`NOTIFY_BATCH`, `notifyInBatches`) with `lazy-module.test.ts`.
- `src/lib/client/preload.ts` (`usePreloadWhenIdle`) and its three callers (`expenses-client.tsx`, `reminders-screen.tsx`,
  `home-reminders.tsx`); `preload.test.ts`.
- `src/app/dev/preview/fixtures.ts`: `/dev/preview/expenses?expenses=300` makes each month 300 rows long.
- `scripts/lab/interactions.mjs` (the INP measurement, described in `docs/lab.md`).

#### 3. Why this way

**What the profiler showed.** I profiled the tap on "previous month" with Chrome's CPU profiler in the lab at 4x
slow CPU. 863 of the first 1,000 ms was React drawing, inside the tap's own event, and most of it was Chakra working out
styles for about 900 buttons and 290 rows. Two causes, both PF9's side effects:
1. *The swap.* PF9 loads the menu and tooltip code after the page and every button then swaps itself for the real
   menu. A row has a `⋯` menu and two hover buttons with tooltips, so a month of 290 rows swapped about 900 widgets in one
   block, and the first tap on any button started that load. Telling them in batches of 24 (a timer between batches)
   makes the same swap take the same total time without ever blocking for more than a few tens of ms.
2. *The rows.* A month switch, Filters and each key in the search all drew every row again. A memoized row skips
   unchanged work (Filters: 300 row draws before, 0 after; four keys typed in the search: 236 before, 0 after; counted in a dev
   build of `/dev/preview/expenses?expenses=300`, with an effect in `ExpenseRow` that counts commits). A new list is drawn first-30-then-the-rest, which
   matters most for a month switch.

**Options turned down**
- *Windowing.* The plan says only if a month can pass 1,000 rows. The seed's busiest month is about 290 and 300 rows
  in a month is already a lot for a family; the deferral fixes the freeze without the cost of windowing (find in page, focus,
  the delete animation). If a month ever passes about 1,000, revisit.
- *Menus that only swap on touch.* More general (rows would never swap) but a swap on a phone's touchstart would replace the button
  under the finger and lose the tap. Batching keeps PF9's behaviour.
- *Closing the sheet before the server answers for a net-worth value.* A 422 shows field errors in the sheet, so it stays open
  until the answer, as the expense form does.
- *Idle preload on To-dos.* I added it first and took it out: with it, To-dos' cold load logged React error #418 (a hydration
  mismatch) in 2 of 36 loads, and 0 of 36 without it (the lab's `first-render.mjs`). Samples are small, but the interaction
  numbers don't need it.
- *Deferring the quick-add form until after the sheet's frame.* Tried: the sheet's frame alone opens in about 150 ms, but React drew the
  form in the same frame, so the first tap stayed at 248 ms. Reverted.

**The React Compiler: tried, not kept.** The plan's rule: keep it only if interactions get measurably faster, all tests pass and
the build stays under +30%. I tried `reactCompiler: true` with `babel-plugin-react-compiler@1.0.0` (the build used it: 43 chunks contain its cache
code) on the unfixed code and on the fixed code [N12][S13].
- *Faster?* On the **unfixed** code it fixed the search (280 to 72 ms a key) and the to-do drop (184 to 96 ms) but not the month switch
  (1,040 to 1,120 ms) or Filters (864 to 952), which are the swap and the first draw. On the **fixed** code it changes nothing on the list.
  The one gain left was dropping a to-do card: 188 ms median (p75 208) without it, 44 ms (p75 104) with it, 10 repetitions each. Annotating only the
  board (`compilationMode: "annotation"`) gave 152 ms (p75 168), within noise.
- *Cost.* First-load JavaScript, gzipped: Expenses 309.1 to 330.0 KiB, Home 288.9 to 305.5, To-dos 299.9 to 319.2, Reminders 280.0 to 294.9,
  Net worth 301.9 to 325.1 (+5 to 8%). The size check still passed, but only through its 2% tolerance, using up the headroom PF9 left.
  `npm run build` from a clean `.next`: 49.7, 47.0 and 67.2 s without (76.7, 75.5, 91.5 s of CPU) and 57.4 and 57.4 s with (92.4, 99.9 s of CPU):
  about +18% on the median clock time (the 67 s run was a busy laptop) and +22 to +30% CPU.
- *Risk.* To-dos' hydration error (the `id="todo-board"` fix from PF8) showed up in 4 of 18 cold loads of the compiled build with
  `first-render.mjs` (and 1 of 80 with a quieter script), against 0 of 40 on `6dd1233`. The cause isn't known and the samples are small, but
  the brief said the compiler must not disturb that.
- So it is **dropped**: the manual fixes bring every list interaction under 200 ms, the compiler's one clear gain is
  a to-do drop that is already about 176 ms, and it costs bytes on every page. Row 11 of "Waiting for George" has the switch if you want it. The dev
  dependency isn't in `package.json`. The compiler's lint rules (`eslint-plugin-react-hooks` 7's `react-hooks/refs`, `purity`,
  `set-state-in-effect` and the others) were already on through `eslint-config-next`, and `npm run lint` passes with them.

**Lint rule: none added.** What I found (a swap that fans out to hundreds of subscribers, rows drawn inside a discrete event) can't be
told from correct code by looking at the syntax.

#### 4. Numbers

Measured in the lab (`docs/lab.md`: 40 ms to Supabase, a production build) with `node scripts/lab/interactions.mjs --width W --scenario S --reps N`,
CPU 4x slower, a new browser for every repetition. Each cell is median / p75 in ms (Event Timing rounds to 8 ms; under 16 ms reads as 0).
Before is `6dd1233`, five repetitions; after is this branch, seven. Expenses scenarios use the last full month. All runs were on a busy laptop
(load 2 to 5), so differences under about 40 ms are noise.

| Interaction | Width | Before | After |
| --- | --- | --- | --- |
| Switch month (first tap) | 390 | 1,040 / 1,192 | **56 / 64** |
| Switch month (first tap) | 1280 | 648 / 880 | **80 / 96** |
| Open Filters | 390 | 864 / 1,368 | **176 / 184** |
| Open Filters | 1280 | 1,928 (one repetition; the rest missed the tap) | **192 / 192** |
| One key in the search | 390 | 280 / 328 | **64 / 72** |
| One key in the search | 1280 | 264 / 280 | **64 / 72** |
| Open quick add, first tap | 390 | 392 / 416 | 248 / 264 |
| Open quick add, first tap | 1280 | 280 / 304 | 256 / 256 |
| Open quick add, chunk already loaded | 390 | 80 / 96 | 56 / 64 |
| One key typing an amount | 390 | 48 / 64 | 48 / 48 |
| Mark a reminder done | 390 | 176 / 240 | 128 / 208 |
| Drop a to-do card | 1280 | 184 / 192 | 160 / 176 |
| Net worth: open the Add value sheet, first tap | 1280 | 304 / 312 | 200 / 208 |
| Net worth: tap Save value (the tap itself) | 1280 | 152 / 160 | 88 / 104 |
| Net worth: the list shows the new value, after the tap | 1280 | 93 / 95 | **52 / 54** |
| Net worth: the server answers, after the tap | 1280 | 371 / 442 | 263 / 273 |

- **Still over 200 ms at p75:** opening quick add the first time (248 to 264) and, just, the Add value sheet and Reminders' Done (208).
  The first open of a lazy sheet builds Chakra's dialog and the form for the first time; the second open is 24 to 64 ms. I couldn't
  split it (section 3). The plan's "under 200 ms on the target pages" is therefore met for the interactions that were slow, not for these.
- Compiler arms (same commands, five repetitions; the to-do drop ten): unfixed code with the compiler: month 1,120 / 1,136, Filters 952 / 1,136, a search key
  72 / 96, to-do drop 96 / 96. Fixed code with the compiler: month 64 / 64, Filters 176 / 176, search key 56 / 64, to-do drop 44 / 104 (ten
  runs), reminder Done 208 / 272 (without: 180 / 272, eight runs each).
- CPU profile of the tap on previous month before: 863 of 1,000 ms was React drawing in the tap's own event
  (`node` script on the Chrome DevTools protocol; not committed).
- Render counts in a dev build of `/dev/preview/expenses?expenses=300`: Filters 300 row draws to 0; four keys in the search 236 to 0.
  Month switch can't be counted there: the preview's month links leave the preview.
- First-load JavaScript with this branch and no compiler: Home 288.9 KiB, Expenses 309.1, To-dos 299.9, Reminders 280.0 (PF9: 288.9, 308.9, 299.8, 279.9), `npm run size:routes -- --check` passes.
- **Lighthouse timespan mode: not measured.** The Event Timing script measures the same thing (the interaction's time to the next frame) for each
  tap with a known cause, which timespan mode only totals. INP itself needs real visits (row 1).

#### 5. How to check it yourself

1. `npm run lab -- up`, then `npm run lab -- delay 40`.
2. `node scripts/lab/interactions.mjs --width 390 --scenario month,search --reps 5`: the first prints the month switch, the second Filters and the keys.
3. In the app as a parent, on Expenses, go to a full month and tap the previous month: the rows should arrive in two
   steps (briefly dimmed) without the page freezing. Open Filters and type: each letter shows at once.
4. Net worth, a row's `⋯` (or its Add value icon on desktop): enter a value, Save. The row shows it before the sheet closes. Stop the API
   (`docker stop supabase_rest_expense-tracker-lab`) and save again: the row goes back and the sheet shows the error.
5. `/dev/preview/expenses?expenses=300` shows a 300-row month.

#### 6. Risks and how to undo it

- The batching in `lazy-module.ts` also applies to the lazy sheets (one subscriber each: no change). A button can show as plain for a few
  hundred ms longer on a very long list; a tap on it still works (`asked`).
- `useDeferredValue` in `ExpenseRows` means a new list shows one pass late, and the old rows are dimmed meanwhile. The Expenses
  server-rendered HTML now has the first 30 rows, not all of them.
- Idle preload downloads the dialogs about a second after load on three pages (they are not part of the first-load budget).
- Undo: revert the PR. Each part is separate: `ledger-panel.tsx` and `expense-rows.tsx` (rows), `lazy-module.ts` (batching), `preload.ts` and its callers (idle preload).

#### 7. Left open

- The first open of a lazy sheet (quick add about 250 ms, Add value about 200 ms at 4x slower CPU). Worth trying: render the form after
  the sheet has painted (`requestAnimationFrame` twice) or keep a closed sheet mounted at idle.
- **React #418 on To-dos.** The hydration error returned in about 1 of 6 to 18 cold loads in some builds of this branch (with idle preload on To-dos
  and with the compiler); final build: 0 of 56. Cause not found. If it reappears in real use, `web_vital`/client-log lines will show it.
- Net worth only has an optimistic *add*; there is no screen for editing a value, so there is nothing to make optimistic.
- Not measured: INP from real visits (needs the VPS, row 1); a month over about 300 rows; the compiled build's page-load times (LCP) and
  the compiled tests (vitest runs the uncompiled source).
- The 1280 px Filters baseline has one usable repetition: at 1280 the harness's tap often missed because the page moved under it.
- `babel-plugin-react-compiler` was installed locally while trying it; `npm ci` removes it from `node_modules`.

### PF12: Lean runtime on the VPS

Nothing a person using the app sees changes in this task. It is about how much memory the two containers use and
where Node draws its own line, measured on this machine with the production image and the production memory limits.
**I have no access to the VPS**, so every number here is from the lab, and the same checks for production are in
"Waiting for George", row 1.

#### 1. The problem

Nobody had looked at how much room the two containers on the VPS (the web app, 768 MB, and the notifications
worker, 256 MB) really have. Two questions:

- **Where does Node stop?** Node has its own ceiling for the memory it uses for objects, called the **heap limit**.
  If it is higher than what the container is allowed, a runaway process is not stopped by Node with a clear
  "JavaScript heap out of memory" line in the log: the kernel kills the whole container instead, with no message from
  the app. If it is too low, a normal busy moment fails for no reason.
- **Is Next's start-up preloading worth its memory?** At start, Next loads the code of every page into memory, so the
  first visit to each page is quick, in exchange for a larger container [N11]. The plan says to turn it off only if
  that saves more than 50 MB and the first request after a deploy still takes under 2 s.

#### 2. What changed

**Behaviour**
- **The worker container now gets a heap limit of 153 MB** (60% of its 256 MB), passed to Node as
  `NODE_OPTIONS=--max-old-space-size=153`. Before, Node's own ceiling in that container was **259 MB, above the 256 MB
  the container is allowed**. It takes effect on the next production deploy after this PR merges.
- **The web container is unchanged.** Node's own ceiling in the 768 MB container is 432 MB (56%), which is in the
  60 to 70% band the plan asks for, so nothing is set. `WEB_HEAP_MB` sets one if you ever want it.
- **`experimental.preloadEntriesOnStart` stays on (the default).** Turning it off saves about 23 MB right after start,
  not the 50 MB the plan asks for (section 4). `next.config.ts` is not touched.
- `scripts/deploy.sh` has two new optional inputs, `WEB_HEAP_MB` and `WORKER_HEAP_MB` (whole MB, checked like the
  other inputs: a positive integer, smaller than the container's memory limit; anything else stops the deploy before
  it builds or stops anything). Set them in `/etc/vps-apps/expense-tracker.sh` like `WEB_MEMORY_LIMIT`. With both
  unset, the web container starts exactly as before and the worker gets the 60% value.

**Files**
- `scripts/deploy.sh`: `memory_size_to_mb`, `require_heap_mb`, `set_runtime_flags`, which adds
  `--env NODE_OPTIONS=--max-old-space-size=<MB>` to both `docker run` calls, and the worker's default (`WORKER_HEAP_PERCENT=60`).
- `scripts/deploy.test.mjs` (new): runs the script against a fake `docker` and checks what each container gets and
  what is refused. 8 tests.
- `scripts/lab/runtime.sh` and `scripts/lab/runtime-driver.mjs` (new): the measurements below, so PF13 or you can repeat
  them. `docs/lab.md` lists them.
- `README.md` ("Hardened containers") and `docs/incident-checklist.md`: the two inputs, and what a heap error in the
  logs means.

#### 3. Why this way

**Measure before setting anything** (the plan's order). In the production image (Node 24.22.2) the heap limit Node
picks depends on the container's memory limit like this (`scripts/lab/runtime.sh heap <limit> <image>`):

| Container limit | 128m, 256m, 384m, 512m | 768m (web) | 1g | 2g |
| --- | --- | --- | --- | --- |
| Node's heap limit | 259 MB | 432 MB | 560 MB | 1,120 MB |

Above 512 MB it follows the container (about half of it for objects, plus a young generation of up to 48 MB, which
the number includes: 432 = 384 + 48). Below that it never goes under about 256 MB. That floor is why the worker
is the one that needs a setting and the web container does not. (The plan's source [S10] describes this sizing from the container's limit; the table is my own measurement.)

**MB, not a percentage.** The image's `node --help` does list `--max-old-space-size-percentage`, and it works in
`NODE_OPTIONS` (65 gave 547 MB in the 768 MB container, measured). I still use MB: it works on every Node version (a
future base image without the percentage flag would probably stop the container from starting, as Node refuses a flag it does not know in `NODE_OPTIONS`; not tried), `WEB_HEAP_MB` has to be MB
anyway, and an MB number can be checked against the container's limit in the script.

**The number.** `--max-old-space-size` sets the part for long-lived objects; the young generation comes on top (in
the worker 153 gave a ceiling of 156 MB, in a 400 setting the web container showed 448). Memory outside the heap
(code, buffers, sharp) comes on top of that again. 60% leaves the worker 100 MB of the 256 MB for that, while it uses
47 MB in total.

**Options turned down**
- A default for the web container too (60 to 70% of 768 MB = 460 to 540 MB). Node's own 432 MB is already in the
  plan's band, nothing measured needs more, and a higher ceiling only means a container fills up before Node starts to
  collect garbage harder.
- Turning `preloadEntriesOnStart` off for 23 MB: below the plan's bar, so no (section 4).
- Reading `/sys/fs/cgroup` or setting `--max-old-space-size` in the Dockerfile: the limit lives in `deploy.sh`, which
  already knows both limits.

#### 4. Numbers

Where: the production `Dockerfile` built as is (`docker build --build-arg GIT_SHA=local -t expense-tracker:pf12 .`),
run on Docker Desktop (Apple silicon, Node 24.22.2) with the flags `deploy.sh` gives the web container
(`--read-only`, the two tmpfs mounts, `--cap-drop ALL`, `--memory 768m --memory-swap 768m`), on the lab's Supabase
(the seeded family: 6,660 expenses) with no delay. The container has the lab's keys and a loopback address only
(`scripts/lab/guard.mjs` checks the env file) and shares the lab's gateway container's network, so nothing leaves the
machine and `.env.local` is not in the image (`.dockerignore`). Memory is `docker stats` (what Obsy shows, in MiB).
"After every page" is after signed in as the lab's parent: 22 pages and 18 GET routes, twice.
Command: `scripts/lab/runtime.sh web <image>`, three times per setting, alternating. The "off" image is the same image
with `"preloadEntriesOnStart":true` changed to `false` in its `server.js` (the standalone server's copy of the
config), which is the line `next.config.ts` would produce.

**`preloadEntriesOnStart`, web container, 3 runs each (MiB)**

| | On (today) | Off | Difference |
| --- | --- | --- | --- |
| Memory 10 s after start | 72.1, 74.7, 69.2 | 50.4, 48.8, 48.1 | **about 23** (the bar is 50) |
| After the first sign-in and Home | 124.1, 127.0, 128.7 | 118.4, 119.1, 118.6 | about 8 |
| After every page | 180.0, 180.3, 178.2 | 172.3, 172.2, 176.2 | about 6 |
| Sign-in request, the first one (ms) | 292, 236, 185 | 301, 375, 467 | off slower, all under 0.5 s |
| Home page, the first one (ms) | 370, 319, 296 | 359, 353, 523 | within the noise |
| 40 requests, first time through (ms, total) | 1,826, 1,449, 1,377 | 1,400, 1,476, 1,548 | within the noise |

The saving shrinks as pages get visited, as [N11] says. The first request after a deploy took under 0.6 s in
every run, with it on or off (the slowest was 523 ms). A first run on a brand new image, which I threw away because
it also warms Docker's own caches, took 1,258 ms for the sign-in and 842 ms for Home: still under 2 s. So the second
half of the plan's test passes either way, and the first half decides: **23 MB is below 50 MB, so it stays on.**

**Heap limit and memory, 768 MB web container (on)**

| What | Result | Command |
| --- | --- | --- |
| Heap limit Node picked | 432 MB (56% of the container) | `scripts/lab/runtime.sh web <image>` (last line) |
| Memory after every page | 176.6 to 180.3 MiB, 23% of 768 | same |
| After a burst: 4,800 requests, 8 at a time, 80 s, no errors | 282.6 to 291.9 MiB; the container's peak (`memory.peak`) 291 to 296 MiB, 38% | `scripts/lab/runtime.sh load <image>` (run twice) |
| PF1's budget, steady state under 60% of the limit | 461 MB: **met in the lab**; production **not measured: needs the VPS** | |

The memory after a burst stays up: Node keeps what it asked for until something needs it back, so Obsy will show a
step up after the busiest hour that does not come down by itself.

**Worker container (256 MB), 4 minutes, 8 ticks, same flags**

| | Node's own (today) | `--max-old-space-size=153` (this PR) |
| --- | --- | --- |
| Heap limit | **259 MB**, above the container's 256 MB | 156 MB |
| Memory, first and last sample (MiB) | 44.5, 47.7 | 45.9, 47.5 |
| Restarts, OOM kills | 0, none | 0, none |

Commands: `scripts/lab/runtime.sh worker <image> [-e NODE_OPTIONS=--max-old-space-size=153]`. The lab's worker has
little to do (push is not configured, four users): production's is not measured, needs the VPS.

**The deploy script** (not production: Docker Desktop, throwaway names, `expense-network` created and removed,
`IMAGE_SOURCE=build`, `LOG_DRIVER=json-file`, a fake env file with fake keys, a loopback Supabase address):

| Check | Result |
| --- | --- |
| `bash -n scripts/deploy.sh` and `shellcheck scripts/deploy.sh` | no output, exit 0 |
| `npx vitest run scripts/deploy.test.mjs` | 8 passed |
| Real run, both variables unset | web: no `NODE_OPTIONS`, heap limit 432 MB; worker: `NODE_OPTIONS=--max-old-space-size=153`, heap limit 156 MB; both healthy |
| Same run, old script (`origin/main`) against the new one, the arguments of both `docker run` calls, diffed | the only difference is `--env NODE_OPTIONS=--max-old-space-size=153` on the worker |
| `WEB_HEAP_MB=400 WORKER_HEAP_MB=120` | web 448 MB, worker 123 MB heap limits |
| `WEB_MEMORY_LIMIT=1536m WORKER_MEMORY_LIMIT=1g` | web 864 MB (Node's own), worker `--max-old-space-size=614` |
| `WORKER_HEAP_MB=300`, `256`, `WEB_HEAP_MB=abc`, `0`, `-5`, `768`, and `WEB_MEMORY_LIMIT=512m WEB_HEAP_MB=512` | each stops with a message before anything is built or stopped |

#### 5. How to check it yourself

Not in production until the next deploy after merge. To repeat what I measured (needs Docker; about 10 minutes):

```bash
scripts/lab.sh up && scripts/lab.sh stop-app
docker build --build-arg GIT_SHA=local -t expense-tracker:pf12 .
scripts/lab/runtime.sh web expense-tracker:pf12        # memory after start, first request, every page; heap limit
scripts/lab/runtime.sh heap 256m expense-tracker:pf12  # 259: the worker's ceiling today
scripts/lab/runtime.sh heap 256m expense-tracker:pf12 -e NODE_OPTIONS=--max-old-space-size=153   # 156
scripts/lab.sh down && docker rmi expense-tracker:pf12
```

To see the script's decision without Docker: `npx vitest run scripts/deploy.test.mjs`.

**On the VPS after the next deploy** (read-only; paste the output into the PR or send it to me; this is row 1 of
"Waiting for George"):

```bash
# The limits the deploy gave, and the NODE_OPTIONS each container has (the web one has none; the worker's is 153)
for c in expense-tracker-web expense-tracker-worker; do
  docker inspect -f '{{.Name}} memory={{.HostConfig.Memory}} oom_killed={{.State.OOMKilled}} restarts={{.RestartCount}}' "$c"
  docker inspect -f '{{json .Config.Env}}' "$c" | tr ',' '\n' | grep NODE_OPTIONS || echo "  no NODE_OPTIONS"
  printf '  heap limit (MB): '
  docker exec "$c" node -e "console.log(Math.round(require('v8').getHeapStatistics().heap_size_limit / 2**20))"
done
# Memory now, against the limit; run it a few times over a day or two for steady state
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.MemPerc}}' expense-tracker-web expense-tracker-worker
# The most each container has used since it started (the kernel's own peak; the file may not exist on an old kernel)
for c in expense-tracker-web expense-tracker-worker; do
  printf '%s peak MiB: ' "$c"; docker exec "$c" cat /sys/fs/cgroup/memory.peak | awk '{ printf "%.0f\n", $1 / 1048576 }'
done
```

What I expect to see, not a result: web heap limit 432, worker 156, web steady state well under 461 MB.

**Obsy** (read from its repo's code at `61bf4b0`, `~/Documents/github/obsy`; I can't open the live one): the
Expense Tracker row shows the web container's memory used, and its details panel adds a bar for its share of the container's
limit (`docker stats`' `MemPerc`), so with 768 MB a bar at 25% is 192 MB. The limit **as a number is not shown**, although
Obsy reads it (`memoryLimitBytes`, never displayed). There is **no peak**, and **the worker is not listed**:
`config/apps.json` has only `expense-tracker-web` and `investment`. The memory sparkline on the overview is the
whole VPS's, not the container's. So look at the web card's bar over a few days: steady state is a flat line and
the bar should stay under about 60%. If you want the worker and the limit shown, here is the change for the Obsy repo (not made):

```text
config/apps.json: add { "id": "expense-tracker-worker", "name": "Expense Tracker worker", "container": "expense-tracker-worker", "accent": "violet" }
app/page.tsx, the "Memory" metric of the app row and details: show
  `${formatBytes(app.memoryBytes)} / ${formatBytes(app.memoryLimitBytes)}` instead of formatBytes(app.memoryBytes)
```

(The worker has no port or health check; check that Obsy's card copes with an app without a `port` before adding it.)

**For the vps-apps README** (optional, nothing in vps-apps has to change): "`/etc/vps-apps/expense-tracker.sh` may also
set `WEB_HEAP_MB` and `WORKER_HEAP_MB` (whole MB, below `WEB_MEMORY_LIMIT` and `WORKER_MEMORY_LIMIT`): Node's heap
limit for the web and worker containers. Unset, the web container keeps Node's own limit and the worker gets 60% of
its memory limit. See the expense-tracker README, "Hardened containers"."

#### 6. Risks and how to undo it

- **The worker's heap is capped at 153 MB from the next deploy.** In the lab it uses 47 MB of memory in total, so there
  is a lot of room, but production's worker has push and real data: if it ever ran out of heap, it would exit with
  `JavaScript heap out of memory` in `docker logs` and Docker would restart it (`--restart unless-stopped`).
  Raise it with `WORKER_HEAP_MB` (anything below the container's limit) or `WORKER_MEMORY_LIMIT`, in
  `/etc/vps-apps/expense-tracker.sh`, and force a deploy; or revert the PR. There is no "unset" value: the worker always
  gets a number now.
- The deploy script runs on every production deploy. The new code only adds a validation and one `--env` argument, the
  old and new arguments were diffed (section 4), and a bad value stops the deploy before it touches a running
  container. A failed worker start only warns, as before.
- `docs/incident-checklist.md` has the first thing to do when the worker restarts.

#### 7. Left open

- **Production's numbers** (row 1): the heap limits, the steady state and peak of both containers, and whether the
  worker's heap limit takes effect. Until then "steady-state memory is within PF1's budget" is true in the lab only.
- The lab is one laptop with Docker Desktop's Linux VM, an idle 4-person dataset and a worker with push off. The VPS's
  kernel, cgroup version and real traffic can differ; the deploy's journald log driver was not used (json-file instead).
- The preload decision was measured with one signed-in user and a copy of `server.js` with the flag flipped, not a
  second build; the standalone config has the flag in one place and the memory differs as [N11] says it should.
- Obsy does not show the limit as a number, the peak or the worker (above); a change for its repo is written out, not made.
- `preloadEntriesOnStart` can be revisited if the VPS gets tight: 23 MB is what it would give back.

### PF13: Measure and close

#### 1. The problem

Twelve tasks each reported their own before and after, measured on different days against different
bases. Nobody had put the whole phase side by side with PF1's baseline, and the plan's closing check,
"the budgets are met, or each miss has a reason and a place it moves to", hadn't been done. The
production half of the baseline (what real phones get, the server's p95 per route, memory on the VPS)
has never been measured at all, because the VPS is behind Tailscale and this work has no access to it.

What a person would have seen if this task hadn't run: a phase marked "done" in the roadmap with
nothing saying which of its goals were checked, and two problems nobody had noticed (section 7: the
Expenses list is dimmed on a cold load (fixed since, #240), and a server-loaded page whose API is down can show its
skeleton for 11 to 40 s).

#### 2. What changed

**Behaviour:** nothing in the app. This task changes only documents.

- This section; "The short version" rewritten as a final summary; "Waiting for George" rewritten as
  one ordered list (its rows are renumbered, and every "row N" in this document was updated to match).
- `docs/family-hub-roadmap.md`: the phase 16 section says "done, except the production measurement
  (waiting on George)", links the plan and this document, and its starting point is corrected (a global
  `SWRConfig` did exist before the phase).
- The probes I wrote for the smoke test (a net-worth refusal, a navigation with the API down, the
  mid-load screenshot) are scratch scripts and are **not committed**; section 5 gives the steps to do
  the same by hand, and the committed lab scripts do the rest.

**Files:** `docs/performance.md`, `docs/family-hub-roadmap.md`.

#### 3. Why this way

- **Same commands as PF1b, same conditions.** The baseline in "Signed-in lab baseline" is the
  shared-secret JWT, no added delay, slow 4G with Lighthouse, as the parent (and the kid on Expenses).
  I ran exactly that again (`npm run lab:measure`, three runs, median). I did not run all of
  `npm run lab:baseline` (about 80 minutes, four JWT and delay combinations plus a repeat): I ran the
  combinations the headline needs: shared 0 ms on both passes, shared 40 ms on both passes, and
  asymmetric 40 ms on the CPU-only pass.
- **PF7's "next" pages** (Calendar, Insights, Investments, Net worth, Settings) with PF7's command, so
  its table has a "now" column.
- **A smoke test in the lab**, because production can't be touched. Each item has a production
  column for you (section 5).
- **Which numbers are comparable with the baseline, and which aren't.** The measuring changed twice
  after PF1b, and some numbers moved because the page is different, not because it is faster:

  | Number | Comparable? |
  | --- | --- |
  | Home "content visible" | Yes. PF1b ran before PF3, when the month card's title was drawn only with its data, so it timed the data. PF6 then fixed the marker to the month's total once the title became part of the skeleton; the number now is that |
  | Expenses "content visible" | **No, and it reads worse than it is.** The marker ignores anything inside a loading placeholder (`aria-busy`). Since PF11, a cold load draws the first 30 rows dimmed and marked busy until the scripts arrive and the rest are drawn (5.9 s on slow 4G). The rows were on screen from about 1.4 s. Section 7 has the evidence. Fixed by #240: the number is now 1.4 s |
  | To-dos and Reminders "LCP" | The LCP element is the page's subtitle both before and now (PF1b's finding). Judge them by "content visible" |
  | Lighthouse FCP | Not used. PF1b showed it is wrong for these pages (it says 0.9 s on every one); I use the observed first paint and FCP |
  | Lighthouse LCP | Comparable to PF1b's baseline only at the same delay. PF1b's slow-4G table was at 0 ms; PF6 and PF9 measured at 40 ms. Both are given |
  | TBT and time to interactive | TBT rose on Home and Expenses because the filled page now hydrates real content (PF6, PF7). Not a budget |
  | "JS on the wire" in a whole cold load | Comparable, and it **rose** (below): the code that left the first load arrives afterwards (PF9's finding) |
  | Auth and Supabase calls, depth, requests | Yes, the same counting at the delay proxy |

- **Noise.** The laptop's load average was 2.3 to 3.5 during the sweep (PF1b: "treat differences under
  100 ms on the mobile pass and 150 ms on the CPU-only pass as noise"). Cells show the median of three
  loads and ± half the spread.
- **The plan's "at least 3 days after the last deploy" is the production step's rule**, not the lab's.
  The lab measures `main` as built, whatever is deployed.

#### 4. Numbers

**Conditions.** The lab on George's laptop, 12 November 2026, on `main` at `5329943` (PF1 to PF12 merged;
the app code is exactly `main`'s). Production build, `next start` on Node 23.4, Chromium 1194, Lighthouse 13.6.0,
the emulated Moto G Power. Medians of three cold loads, ± half the spread. Docker Desktop's Linux VM; the machine's load average
was 2.3 to 3.5. **None of these is a production number.**

```bash
npm run lab -- up                       # 75 s; the lab is built from this checkout
# the baseline's own cells (shared-secret JWT, no added delay), slow 4G with Lighthouse, then the CPU-only pass
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3
npm run lab:measure -- /expenses --user kid --runs 3
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3 --throttle cpu --no-lighthouse
npm run lab:measure -- /expenses --user kid --runs 3 --throttle cpu --no-lighthouse
# PF7's five "next" pages
npm run lab:measure -- /calendar /insights /investments /net-worth --user parent --runs 3 --no-lighthouse
npm run lab:measure -- /settings --user parent --runs 3 --no-lighthouse
# 40 ms to Supabase ("like production"), shared secret, then asymmetric keys: the same CPU-only commands
npm run lab -- delay 40
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3 --throttle cpu --no-lighthouse   # and kid /expenses
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3                                  # slow 4G + Lighthouse at 40 ms
npm run lab -- jwt asymmetric
npm run lab:measure -- /dashboard /expenses /todos /reminders --user parent --runs 3 --throttle cpu --no-lighthouse   # and kid /expenses
# sizes, routes and taps
npm run build && npm run size:routes -- --check
node scripts/lab/search-compare.mjs > /dev/null && node scripts/lab/route-probe.mjs .lab parent 5      # at delay 40, shared; again with 3 runs asymmetric
node scripts/lab/interactions.mjs --width 390 --scenario quick-add,month,search,reminder-done --reps 5   # delay 40
node scripts/lab/interactions.mjs --width 1280 --scenario net-worth,todo-drag --reps 5
```

(The measuring runs are in `.lab/results/pf13/`, which is git-ignored and which `npm run lab -- down` keeps.)

##### 4.1 Cold load on the emulated phone, slow 4G (the baseline's own table)

Shared-secret JWT, no added delay, the parent (the last column is the kid). Before is "Signed-in lab
baseline" ("The baseline: like production today"), after is PF13. Milliseconds unless it says otherwise.

| | Home | Expenses | To-dos | Reminders | Expenses, kid |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Content visible** | 7,387 → **1,353** ±11 | 7,990 → 5,903 ±11 (†) | 7,528 → **1,365** ±7 | 7,366 → **1,359** ±13 | 7,656 → 5,883 ±96 (†) |
| First paint | 1,400 → 1,396 | 1,404 → 1,448 | 1,396 → 1,424 | 1,392 → 1,420 | 1,388 → 1,424 |
| FCP, the first text (observed) | 6,800 → **1,396** | 7,064 → **1,448** | 6,836 → **1,424** | 6,760 → **1,420** | 7,032 → **1,424** |
| **LCP** (observed) | 7,448 → **1,396** | 8,136 → **1,448** | 7,604 → **1,424** | 7,324 → **1,420** | 7,732 → **1,424** |
| What the LCP element is now | the month's total (data) | the "28% more than October" line (data) | the subtitle (not the cards) | the subtitle (not the list) | the same line as Expenses |
| CLS (page jump) | 0.156 → **0.000** | 0.009 → **0.000** | 0 → 0 | 0 → 0 | 0 → 0 |
| TBT / time to interactive (observed) | 2 / 7,437 → 192 / 5,186 | 720 / 8,623 → 173 / 7,326 | 120 / 7,568 → 136 / 5,186 | 39 / 7,385 → 108 / 3,842 | 64 / 7,757 → 149 / 7,346 |
| TTFB now, the first byte (not recorded in the baseline) | 57 ±4 | 75 ±5 | 56 ±5 | 51 ±3 | 63 ±7 |
| **Lighthouse LCP**, 0 ms (simulated) | 5,523 → **913** | 5,953 → **909** | 5,674 → **910** | 5,518 → **909** | 5,677 → **910** |
| Lighthouse LCP now at 40 ms (not in the baseline) | 4,988 ±326 (PF6's before, at 40 ms: 5,784) | 1,057 ±1,756 | 908 | 907 | not run |
| Lighthouse TBT | 357 → 337 | 1,010 → 464 | 279 → 265 | 315 → 258 | 441 → 359 |
| JS on the wire, whole cold load, KiB | 409.6 → 451.9 | 437.8 → 479.5 | 427.4 → 451.0 | 408.3 → 451.4 | 437.8 → 479.5 |
| Data in the first HTML | no → **yes** | no → **yes** | no → **yes** | no → **yes** | no → **yes** |

† Not comparable (before #240): the Expenses rows are on screen from about 1.4 s but dimmed, and the marker doesn't count a
dimmed ("busy") list until the scripts arrive. Section 7 has a measurement of that. The number to compare is
"FCP" and "LCP" for the page, and the data's time in the CPU-only table below, where the same effect is smaller.

Per cold load, the same runs, from the delay proxy's call log:

| | Home | Expenses | To-dos | Reminders | Expenses, kid |
| --- | ---: | ---: | ---: | ---: | ---: |
| Waterfall depth (waits in a row) | 4 → **0** | 4 → **0** | 4 → **0** | 4 → **0** | 5 → **0** |
| API requests from the browser | 6 → **0** | 7 → **0** | 5 → **0** | 4 → **0** | 7 → **0** |
| Link prefetches (`?_rsc=`) | 16 → 8 | 13 → 5 | 14 → 6 | 12 → 4 | 13 → 5 |
| Calls to Supabase, all | 49 → **24** | 48 → **18** | 40 → **18** | 33 → **15** | 48 → **18** |
| **Calls to Supabase Auth**, shared secret | 30 → **11** | 29 → **8** | 26 → **9** | 22 → **7** | 29 → **8** |
| … with asymmetric keys | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Calls to Supabase, asymmetric keys | 19 → 13 | now 10 | now 9 | now 8 | now 10 |
| `get_family()` | 1 → 1 | 1 → 1 | 2 → 1 | 0 → 0 | 1 → 1 |

##### 4.2 The CPU-only pass (fast network, phone-speed CPU: where the server's work shows)

"Content visible", ms, before (PF1b, "What the JWT mode and the delay change") → now. The Expenses cells have the
same dimming caveat (†).

| Pass | Home | Expenses | To-dos | Reminders | Expenses, kid |
| --- | ---: | ---: | ---: | ---: | ---: |
| Shared secret, 0 ms | 1,100 → **509** ±19 | 1,596 → 1,481 (†) | 1,187 → **502** ±73 | 1,140 → **501** ±79 | 1,290 → 1,094 (†) |
| Shared secret, 40 ms (like production) | 1,356 → **623** ±7 | 2,005 → 1,681 (†) | 1,419 → **618** ±17 | 1,345 → **612** ±15 | 1,590 → 1,265 (†) |
| Asymmetric keys, 40 ms | 1,130 → **536** ±167 | 1,681 → 1,592 (†) | 1,195 → **515** ±26 | 1,248 → **517** ±5 | 1,356 → 1,122 (†) |
| Gain from asymmetric keys at 40 ms | 226 → 87 | 324 → 89 | 224 → 103 | 97 → 95 | 234 → 143 |
| TTFB now, shared → asymmetric, 40 ms | 177 → **82** ±2 | 174 → **83** ±4 | 167 → **77** ±4 | 169 → **74** ±2 | 190 → **84** ±4 |
| LCP now, shared, 40 ms | 700 | 760 | 672 | 676 | 760 |

What it says:

- **The pages are 0.5 to 1 s sooner than before on this pass** (Home 1,356 → 623 at 40 ms), and with the
  server rendering the data, the gain from asymmetric keys on "content visible" is now 87 to 143 ms, inside the
  150 ms noise of this pass (it was 224 to 324 ms before, when the browser made the requests).
- **What asymmetric keys still clearly buy is the first byte: 90 to 106 ms sooner** (Home 177 → 82 ms), and no
  Auth call at all (below). The page now waits for its server-side reads before the first byte, so each round trip to Auth
  is paid there.
- **Auth calls per signed-in API request** (`node scripts/lab/route-probe.mjs .lab parent 5`, 28 routes, delay 40): **2 on every route with
  the shared secret, 0 on every route with asymmetric keys**; the median route takes 173 ms with the shared secret and 119 ms with asymmetric keys.

##### 4.3 The pages PF7 listed as "next"

Slow 4G, parent, three runs, no Lighthouse, shared secret, no delay. Before is PF7's table (`npm run lab:measure -- /calendar /insights /investments /net-worth --user parent --runs 3 --no-lighthouse`).

| Page | LCP | CLS | TBT | API requests | Supabase calls | Auth calls | Depth |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Insights | 7,424 → 6,820 | 0.073 → 0.073 | 255 → 139 | 4 → 2 | 39 → 31 | 25 → 19 | 3 |
| Investments | 6,856 → 6,444 | 0.107 → **0.107** | 364 → 154 | 4 → 2 | 33 → 25 | 19 → 13 | 4 |
| Net worth | 6,980 → 6,184 | 0.105 → **0.105** | 400 → 172 | 4 → 2 | 36 → 28 | 21 → 15 | 4 |
| Calendar | 1,420 → 1,448 (the page's frame) | 0.002 → 0.002 | 326 → 167 | 9 → 7 | 62 → 54 | 29 → 23 | 3 |
| Settings | 1,404 → 1,396 (the frame) | 0 → 0 | 262 → 101 | 5 → **0** | 41 → 17 | 28 → 11 | 0 |

These pages are still loaded in the browser, as PF7 left them; the gains are from PF8's shared fixes and PF9 (fewer requests in the shell,
less script). Their data still arrives at about 6.2 to 6.8 s on slow 4G.

##### 4.4 First-load JavaScript, all 24 pages (gzipped KiB)

`npm run build && npm run size:routes -- --check` (passes). Before is PF1's table; budget is `docs/performance-budget.json`.

| Page | Before | Now | Change | Budget | |
| --- | ---: | ---: | ---: | ---: | --- |
| `/` | 253.7 | 210.6 | -17% | 253.7 | pass |
| `/_not-found` | 243.8 | 210.6 | -14% | 243.8 | pass |
| `/calendar` | 387.5 | 347.4 | -10% | 387.5 | pass |
| `/change-password` | 299.6 | 232.5 | -22% | 299.6 | pass |
| `/dashboard` | 385.5 | 288.9 | -25% | 308.4 | pass |
| `/expenses` | 411.8 | 309.2 | -25% | 329.4 | pass |
| `/expenses/import` | 390.2 | 356.6 | -9% | 390.2 | pass |
| `/insights` | 399.7 | 305.5 | -24% | 399.7 | pass |
| `/investments` | 395.3 | 341.5 | -14% | 395.3 | pass |
| `/join/[code]` | 303.9 | 256.8 | -15% | 303.9 | pass |
| `/login` | 273.1 | 241.6 | -12% | 273.1 | pass |
| `/more` | 375.8 | 274.2 | -27% | 375.8 | pass |
| `/net-worth` | 382.6 | 301.9 | -21% | 382.6 | pass |
| `/oauth/consent` | 259.7 | 224.6 | -14% | 259.7 | pass |
| `/offline` | 246.9 | 213.7 | -13% | 246.9 | pass |
| `/reminders` | 384.2 | 280.0 | -27% | 307.4 | pass |
| `/settings` | 383.6 | 308.5 | -20% | 383.6 | pass |
| `/settings/ai` | 376.3 | 280.9 | -25% | 376.3 | pass |
| `/settings/family` | 378.9 | 306.0 | -19% | 378.9 | pass |
| `/settings/family/manage` | 382.4 | 308.1 | -19% | 382.4 | pass |
| `/settings/mcp` | 381.5 | 309.2 | -19% | 381.5 | pass |
| `/settings/notifications` | 378.7 | 283.5 | -25% | 378.7 | pass |
| `/settings/permissions` | 378.2 | 276.7 | -27% | 378.2 | pass |
| `/todos` | 402.7 | 299.8 | -26% | 322.2 | pass |

The four target pages are the ones with a budget 20% under their baseline (Home 308.4, Expenses 329.4, To-dos 322.2, Reminders 307.4):
288.9, 309.2, 299.8 and 280.0 KiB, all inside it. The files every page loads fell from 243.8 to 210.6 KiB.

##### 4.5 Taps (the parts of INP) in the lab

Event Timing through the lab's driver, the CPU 4x slower, 40 ms to Supabase, a new browser for each repetition (5), median / p75 / worst, ms.
Before is PF11's "before" where it measured one. Under 16 reads as 0.

| Interaction | Width | Before PF11 | PF11 | Now |
| --- | --- | ---: | ---: | ---: |
| Switch to the previous month (first tap) | 390 | 1,040 | 56 | **56** / 56 / 64 |
| Open Filters | 390 | 864 | 176 | **184** / 184 / 192 |
| One key in the search | 390 | 280 | 64 | **64** / 72 / 80 |
| Open quick add, first tap | 390 | 392 | 248 | **240** / 248 / 256 |
| Open quick add, chunk already loaded | 390 | 80 | 56 | **56** / 64 / 64 |
| Mark a reminder done | 390 | 176 | 128 | **88** / 96 / 200 |
| Net worth: open the Add value sheet, first tap | 1280 | 304 | 200 | **200** / 200 / 224 |
| Net worth: tap Save value | 1280 | 152 | 88 | **88** / 88 / 136 |
| Net worth: the list shows the value, after the tap | 1280 | 93 | 52 | **51** / 52 / 104 |
| Net worth: the server answers, after the tap | 1280 | 371 | 263 | 259 / 260 / 272 |
| Drop a to-do card | 1280 | 184 | 160 | **136** / 136 / 152 |

##### 4.6 Budgets: lab verdict and production cell

The budgets are PF1's "Proposed budgets" (working budgets until you agree or change them, row 5).

| Budget | Value | Lab, now | Lab verdict | Production |
| --- | --- | --- | --- | --- |
| LCP, p75, Home, Expenses, To-dos, Reminders | ≤ 2.5 s | Observed on slow 4G: 1.40 to 1.45 s on all four. Lighthouse's simulation: 0.9 s on three, **Home 5.0 s at 40 ms** (0.9 s at 0 ms) | Met (observed); Lighthouse on Home over, see section 7 | **not measured: needs the VPS** |
| INP, p75, the same pages | ≤ 200 ms | Every tap above is 184 ms or less at p75, except the first open of quick add (248) and, at the limit, the Add value sheet (200, worst 224) | Met except the first open of a lazy sheet (section 7) | **not measured: needs the VPS** |
| CLS, p75, the same pages | ≤ 0.1 | 0.000 on all four, both users | Met. Investments (0.107) and Net worth (0.105), not target pages, are over | **not measured: needs the VPS** |
| TTFB, p75 | ≤ 0.8 s | 51 to 90 ms with no delay, 164 to 190 ms with 40 ms to Supabase | Met in the lab, which has no TLS or Tailscale hop | **not measured: needs the VPS** |
| Server p95 per route | ≤ 300 ms (AI and import routes exempt) | A median of 5 (not a p95), 28 routes, 40 ms to Supabase: 25 of 28 at or under 300 ms; median route 173 ms. Over: Everything tab, all 401 ms (a 629 KB answer), "calendar PATCH all (series)" 447 ms, "todo move" 334 ms | **Not met in the lab on three routes**, see section 7 | **not measured: needs the VPS** |
| First-load JS, every page | at most its baseline | 24 of 24 pages under | **Met** (4.4) | n/a (a build number) |
| First-load JS, the four target pages | 20% under the baseline | Home 288.9 ≤ 308.4, Expenses 309.2 ≤ 329.4, To-dos 299.8 ≤ 322.2, Reminders 280.0 ≤ 307.4 | **Met** | n/a |
| Web container memory, steady state | under 60% of its 768 MB (461 MB) | PF12's lab numbers, **not re-run here**: about 180 MiB after visiting every page, 291 to 296 MiB after 4,800 requests (38%) | Met in the lab (PF12) | **not measured: needs the VPS** |

**The production cells, one by one.** Everything marked "not measured: needs the VPS" above, and these:

| Cell | Result | Filled by |
| --- | --- | --- |
| LCP, INP, CLS, FCP, TTFB at p75, per page, and by navigation type | **not measured: needs the VPS** | Step 1's `perf-report.sh`, "Web Vitals: p75 per page" and "…by navigation type" |
| p50, p95, count and 5xx per route; the slowest spans; `dbCalls` | **not measured: needs the VPS** | `perf-report.sh`, "API requests: latency per route" |
| `auth.*` spans and `get_family` reads per signed-in request | **not measured: needs the VPS** | `perf-report.sh`, "Round trips per signed-in request" |
| The slowest Supabase calls by total time | **not measured: needs the VPS** | `perf-report.sh`, "Supabase calls: where the database time goes" |
| Whether the proxy streams a response (the shell before the data) | **not measured: needs the VPS** | Step 1, delivery check 1 |
| Whether HTML and scripts are compressed on the wire | **not measured: needs the VPS** | Step 1, delivery check 2 |
| Heap limit, memory now and peak of the web and worker containers | **not measured: needs the VPS** | Step 1, the memory commands |
| Whether the worker's new heap limit (153 MB) took effect | **not measured: needs the VPS** | Step 1, the memory commands (heap limit should read 156) |
| A real phone's INP, LCP and the field's own Auth call count | **not measured: needs the VPS** | `perf-report.sh`, and Obsy's memory bar over a few days |

##### 4.7 The smoke test

Each item was run in the lab ("Lab") on 12 November 2026; the production column is yours (steps in section 5).
"Probe" means a scratch script that is not committed; the steps next to it do the same by hand.

| # | Check | Lab result | How I ran it | Production |
| --- | --- | --- | --- | --- |
| 1 | A signed-out visit redirects with no app JavaScript | **Pass.** `GET /dashboard` and `/expenses?month=2026-10`: 307 to `/login?next=…`. The ten sections and `/`, signed out, each load the sign-in page's 21 script files and **0 of the app's page chunks**; the only console line is the sign-in page's own 401 from `/api/account`, which PF5 documented | `curl -sI http://localhost:3110/dashboard`; `node scripts/lab/session-gate.mjs --width 390` | not run: needs the VPS |
| 2 | Each target page's first HTML has its data | **Pass**, parent and kid: Expenses 15 of 15 of the page's data strings in the markup (kid 9 of 9), To-dos 14 of 14, Reminders 10 of 10 (kid 2 of 2), Home 11 of 29 (the month total, 6 of 6 expenses, 3 reminders and 3 to-dos: Home shows only some). 0 data requests in the first render, and an empty console | `node scripts/lab/first-render.mjs <page> --users parent,kid --widths 390` for the four pages | not run: needs the VPS |
| 3 | A tab tap shows the skeleton at once | **Pass.** The destination's data held back, tapping Expenses from Home shows the skeleton **61 ms** later | `node scripts/lab/skeletons.mjs /dashboard 390 --tap /expenses` | not run: needs the VPS |
| 4 | With the API stopped, an error with a retry shows within 15 s | **Partly.** *Cold load,* PostgREST stopped: "We couldn't load this page … Try again" after **0.40 s** (Insights) and **0.46 s** (Expenses). *Tap to a page loaded in the browser* (Net worth): "taking longer than usual" at 9.1 s and the error at **16.1 s** (two runs: 16.05, 16.18 s from the tap; PF2 measured 15.3 s from the load). *Tap to a page loaded on the server* (Expenses, To-dos): the error came at **11.2, 11.4 and 40.3 s**, and in one run of five not within 60 s. *Gateway hung* (paused, not stopped): a cold load got no answer in 70 s, and a tap left the skeleton for 30 s with no notice and no error. **Over 15 s in the server-loaded cases, section 7** | probe `nav-5xx` (taps a tab with `docker stop supabase_rest_expense-tracker-lab`, polls for "Try again"); cold load with `node scripts/lab/states.mjs down5xx-expenses /expenses 390 --seconds 30` after stopping the container; hang with `docker pause supabase_kong_expense-tracker-lab` | Pages loaded in the browser only: block `/api/*` in the browser's network panel. Not testable on the server-loaded pages without stopping Supabase, which you should not do |
| 5 | An optimistic valuation rolls back when the write is refused | **Pass.** Net worth, Add value 7777 on Savings account: the row showed the value as soon as the request left; the browser's network layer held the `POST` for 0.7 s and answered 422; the row **dropped the value again the moment the 422 arrived**, and the sheet stayed open with "That value was refused (PF13 probe)" and Save value again. (I refused it in the browser: with PostgREST stopped, the save was still pending after 6 s, where I stopped watching, which tests the timeout, not the rollback.) Unit tests: `use-net-worth-writes.swr.test.tsx` (real SWR; 422 and 500) | probe `rollback`; by hand: section 5 | Block `*valuations*` in the network panel, add a value |
| 6 | A section error keeps the shell | **Pass.** With PostgREST stopped, tapping Expenses from Home ended on the section's error screen with "Try again" and the sidebar and bottom bar still there (checked in three runs). A cold load with the API down replaces the whole page, shell included: the shell needs the account | probe `nav-5xx`; each section has its own `error.tsx` (PF3) | not run: needs the VPS (the error can't be forced without breaking Supabase) |
| 7 | No CSP violations in the console | **Pass.** The policy is still report-only (`content-security-policy-report-only`; enforcing is the security plan's S14). Empty console on all four target pages for both users, and on the ten sections for both users. The only console lines in any probe were the sign-in page's 401, the intended 422, and a React error #441 logged by the section boundary during the forced failure in check 4 | `first-render.mjs` and `session-gate.mjs` above; `curl -sI http://localhost:3110/login \| grep -i content-security` | Open Home, Expenses, To-dos and Reminders with the console open; and `grep csp` in the journal (`perf-report.sh` doesn't count CSP reports) |
| 8 | No Auth round trips on signed-in requests (if the signing keys moved) | **They haven't moved, so this is the "before".** Shared secret: **2 Auth calls on every one of 28 API routes**, and 11, 8, 9 and 7 in a cold load of Home, Expenses, To-dos and Reminders. Asymmetric keys: **0 on every route and every page** | `node scripts/lab/route-probe.mjs .lab parent 5` at each `npm run lab -- jwt shared\|asymmetric`; the cold-load counts are 4.1's | After row 4: `perf-report.sh`, "Round trips per signed-in request" |

#### 5. How to check it yourself

**Step 1: the production measurement (yours, one sitting on the VPS).** Do it at least 3 days after the
deploy that carries PF12, so the journal holds real use of the new code. Everything here is read-only apart
from the throwaway server in check 1. Paste the output into the PR or send it to me; it fills every
"not measured: needs the VPS" cell in 4.6 (the third column of the table there says which).

```bash
# A. Web Vitals, server time per route, Auth calls per request (a checkout of main, or copy the one file)
sudo scripts/perf-report.sh 5 expense-tracker-web          # days, then the web container's name

# B. Memory (PF12): the limits the deploy gave, the heap limit Node chose (web 432, worker should read 156), memory now and peak
for c in expense-tracker-web expense-tracker-worker; do
  docker inspect -f '{{.Name}} memory={{.HostConfig.Memory}} oom_killed={{.State.OOMKilled}} restarts={{.RestartCount}}' "$c"
  docker inspect -f '{{json .Config.Env}}' "$c" | tr ',' '\n' | grep NODE_OPTIONS || echo "  no NODE_OPTIONS"
  printf '  heap limit (MB): '
  docker exec "$c" node -e "console.log(Math.round(require('v8').getHeapStatistics().heap_size_limit / 2**20))"
done
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.MemPerc}}' expense-tracker-web expense-tracker-worker   # a few times over a day or two
for c in expense-tracker-web expense-tracker-worker; do
  printf '%s peak MiB: ' "$c"; docker exec "$c" cat /sys/fs/cgroup/memory.peak | awk '{ printf "%.0f\n", $1 / 1048576 }'
done

# C. Delivery check 1: does the proxy pass a streamed response through? (terminal 1: the throwaway server, Ctrl-C when done)
node -e 'require("http").createServer((q,r)=>{r.writeHead(200,{"content-type":"text/plain; charset=utf-8"});let i=0;const t=setInterval(()=>{r.write("chunk "+(++i)+"\n");if(i===5){clearInterval(t);r.end()}},1000)}).listen(3999,"127.0.0.1")'
# terminal 2:
stamp() { while IFS= read -r l; do printf '%s %s\n' "$(date +%T.%3N)" "$l"; done; }
curl -sN http://127.0.0.1:3999/ | stamp                    # the control: five lines, a second apart
sudo tailscale serve --bg --https=8443 3999
curl -sN https://<the-app's-.ts.net-name>:8443/ | stamp    # good: the same five lines a second apart; bad: all five at once
sudo tailscale serve --https=8443 off                      # NOT `serve reset`
tailscale serve status                                     # the app's own entry is still there

# D. Delivery check 2: is the response compressed?
HOST=https://<the-app's-.ts.net-name>
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip, br' "$HOST/login" | grep -iE '^(HTTP|content-encoding|content-length|transfer-encoding|vary):'
JS=$(curl -s --compressed "$HOST/login" | grep -o '/_next/static/chunks/[^"]*\.js' | head -1)
curl -s -o /dev/null -D - -H 'Accept-Encoding: gzip, br' "$HOST$JS" | grep -iE '^(HTTP|content-encoding|content-length|cache-control):'
curl -s -o /dev/null -w 'compressed:   %{size_download}\n' -H 'Accept-Encoding: gzip, br' "$HOST$JS"
curl -s -o /dev/null -w 'uncompressed: %{size_download}\n' -H 'Accept-Encoding: identity' "$HOST$JS"
```

Reading the answers: "Delivery checks" under "Baseline and budgets" says what good and bad look like for C and D;
PF12 section 5 for B. In A, compare each page's LCP, INP and CLS p75 with 4.6, and any route whose p95 is over 300 ms
with the three lab routes in section 7. Then look at the web container's memory bar in Obsy over a few days (PF12 section 5).

**Step 2: the production smoke checks** (the "Production" column of 4.7), in a browser on the live app with the console open,
signed in as yourself: open Home, Expenses, To-dos and Reminders (check 7: nothing red, and no CSP lines); signed out
in a private window, open `/dashboard` with the network panel open (check 1: only the sign-in page's files load); on Net worth,
block `*valuations*` in the network panel (right-click a request → Block request URL), add a value and watch the row put itself
back (check 5); block `/api/*` and open Insights to see the slow notice at 8 s and the error at 15 s (check 4, browser-loaded pages only).
Don't stop Supabase to test the others.

**Step 3: the lab checks, if you want to see them yourself.**

1. `npm run lab -- up`, then `npm run lab:measure -- /dashboard --user parent --runs 3`: Home's data at about 1.35 s on the emulated phone.
2. `node scripts/lab/session-gate.mjs --width 390`: every signed-out load ends on the sign-in page with no app chunks; every signed-in one has no `/api/account` request.
3. `node scripts/lab/first-render.mjs /expenses --users parent,kid --widths 390`: the data strings are in the page's own markup and no data request is made.
4. `node scripts/lab/skeletons.mjs /dashboard 390 --tap /expenses`: the skeleton 60 ms after the tap.
5. The refused valuation by hand: open Net worth in the lab (`.lab/users.json` has the sign-ins), in devtools block `*valuations*`, then Add value: the row shows the value, drops it, and the sheet says the save failed.
6. The dimmed list (fixed, #240): devtools, throttling "Slow 4G" and CPU 4x slowdown, open `/expenses`: the list is at full strength from the first paint. Switch month: the old rows dim until the new ones are in.
7. The down API: `docker stop supabase_rest_expense-tracker-lab`, tap Expenses from Home and time the skeleton. `docker start supabase_rest_expense-tracker-lab` after.
8. `npm run lab -- down`.

#### 6. Risks and how to undo it

- **No code changed**, so nothing can regress. Revert the PR to undo the documents.
- **The risk is in how the numbers are read.** They are lab numbers on a laptop with a fake family; the VPS, TLS, HTTP/2, Tailscale
  and real data can all move them. The roadmap says "done, except the production measurement" for that reason, and row 1 is the step
  that closes it. The lab's 40 ms to Supabase is from your laptop, not the VPS (row 9).
- **The numbers go stale.** Anything merged after `5329943` can move them. The commands are in 4, so the table can be redone.
- **The lab left nothing behind:** `npm run lab -- down` removed its containers, volumes, files and processes (checked, section 7), and
  `.lab/results/pf13/` stays on this laptop, git-ignored.

#### 7. Left open

**Over a budget or short of a goal, and where each moves.** Nothing here is fixed in this task, because it changes no app code.

| What | Why | Moves to |
| --- | --- | --- |
| **Lighthouse's simulated LCP on Home: 5.0 s at 40 ms to Supabase** (0.9 s with no delay; budget 2.5 s). The other three pages are 0.9 to 1.1 s | Lighthouse simulates a load from an unthrottled run, and charges the month's total (in the page's streamed data, after the shell) with the scripts the page had started. The observed LCP on the emulated phone is 1.4 s. PF9's smaller bundles did not move it (4.5 to 4.8 s then, 5.0 s now) | No task. The field decides: row 1's p75 LCP for Home. If that is over 2.5 s, the lever is Chakra's runtime (about a third of every page, PF9), which PF9 said needs its own plan: **a later plan, not phase 18's clean-up** |
| **The first open of a lazy sheet: quick add 240 ms, the Add value sheet 200 ms** (worst 224), on a 4x slower CPU; the bar is 200 ms | The first open builds Chakra's dialog and the form for the first time (PF11); the second open is 56 ms | **Phase 18** or a small follow-up: PF11's two ideas, draw the form after the sheet has painted, or keep a closed sheet mounted at idle |
| **Insights, Investments, Net worth and Calendar are still loaded in the browser.** Their data is on screen at about 6.2 to 6.8 s on slow 4G; **Investments (0.107) and Net worth (0.105) jump over the 0.1 CLS limit**; Calendar makes 7 API requests and 54 Supabase calls per load | PF7 left them as the plan said ("next" pages) and PF10 left the SQL alone. They have no server-first loader | **A later plan** using "The pattern for PF7", Calendar first (most requests), then Insights, Investments and Net worth. Not phase 18: that is clean-up |
| **Every signed-in request makes 2 Auth calls** (a cold load 7 to 11) | The shared-secret JWT: `getClaims()` has to ask Auth. Asymmetric keys make it 0 and the first byte 90 to 106 ms sooner (4.2) | **Row 4**, a project setting. Not code |
| **Three routes over 300 ms in the lab:** the Everything tab 401 ms (354 with asymmetric keys), "calendar PATCH all (series)" 447 ms (410), "todo move" 334 ms. Medians of 5 with 40 ms to Supabase, not p95s | The Everything tab's answer is 629 KB from four reads (PF10); the two writes touch several rows in a row, each costing 40 ms in the lab. PF10 found no index that helps | **Wait for row 1's p95 per route** (and row 7). If any is over in production: phase 18 (paging the Everything tab; batching the series write) |
| **Expenses' first rows were dimmed on a cold load** (fixed, #240) | See below | **Fixed by #240** (a follow-up to PF11): the first render is no longer dimmed; "content visible" is 1,405 ms again |
| **A server-loaded page whose API is down or hung can show its skeleton for 11 to 40 s or more** (new; fixed, #PRNUM) | See below | **Fixed by #PRNUM**: a 4 s limit on each of the server's Supabase calls; the error now shows at about 4 s (API failing) or 8 s (hung) |
| The whole cold load downloads 10% more JavaScript than at the baseline (Home 409.6 → 451.9 KiB), though the first load fell 25% | PF9's finding: the code left the first load, and arrives afterwards (menus, sheets, prefetched pages, PF11's idle preloads). Not a budget | Nothing |

**New finding 1: the Expenses list is dimmed while the scripts load.** On the emulated phone on slow 4G,
I loaded `/expenses` and read the list at set times (a scratch probe; section 5, step 3.6 does it by hand):

| After | List items | Opacity | `aria-busy` |
| --- | ---: | ---: | --- |
| 2.0, 3.0 and 4.5 s | 41 (the first 30 rows) | 0.6 | yes |
| 6.0, 7.5 and 9.0 s | 74 (the whole month) | 1 | no |

A screenshot at 3 s shows the first rows, readable, at 60% (the lab's own check counts the list as a loading placeholder until it is
at full strength, which is why "content visible" for Expenses reads 5.9 s above). The cause is PF11's `useDeferredValue(expenses, expenses.slice(0, FIRST_ROWS))`
in `src/components/expenses/expense-rows.tsx`: the first render, which is the server's HTML and the hydration, is always the "initial" 30 rows, so
`rows !== expenses` and the list is "stale" (dimmed, `aria-busy`) until the second step, which has to wait for the scripts. PF11 measured taps, not a cold
load, so it couldn't see this, and the dimming is meant for a month switch. The fix is small: don't dim on the first render. It isn't done here because this task changes no app code.

**Fixed in #240.** "Stale" now means "the rows on screen are an earlier list that the new one hasn't replaced yet", so the first 30 rows
(`firstRows`, kept in state, the initial value of `useDeferredValue`) are never stale: `stale = rows !== expenses && rows !== firstRows`.
A month switch, a filter or a search still dims the old rows until the new ones are in, which is what the dimming is for. I turned down
a "has hydrated" flag (an effect and an extra render for the same result). One gap: a change that arrives before the second step has
drawn the full list shows the first 30 rows undimmed for that moment. Test: `expense-rows.test.tsx` ("ExpenseRows dimming"): the first
draw never sets `aria-busy`, a later list does and then clears it; the first test fails on the old code. No lint rule: it is the only
two-argument `useDeferredValue` in the code, and what went wrong (comparing the deferred value with its input) is a meaning, not a shape a rule can pick out without
flagging correct uses. Measured on the fixed build, `npm run lab:measure -- /expenses --user parent --runs 3` (slow 4G, as above):

| Expenses | Before the fix (PF13) | After |
| --- | ---: | ---: |
| Content visible | 5,903 ±11 | **1,405** ±72 (runs 1,397, 1,540, 1,405) |
| All placeholders gone | 5,903 | 1,405: nothing is marked busy at any point of the load |
| LCP (observed) | 1,448 | 1,632 ±220 (the lab's own runs vary; the same element) |

Not re-measured: the month switch and Filters taps (`interactions.mjs`); the change doesn't touch how the rows are drawn in two steps, only the
dimming. The new number is the first rows' own time; the full list still arrives with the scripts.

**New finding 2: the server has no time limit on its own calls to Supabase, and an outage takes long to show.**
`fetchWithTimeout` (15 s, PF2) covers only the browser's own requests (`src/lib/api/client.ts`); a server-rendered page waits for
Supabase as long as Node does. What I saw in the lab (check 4 in 4.7): with the gateway *hung*, a cold page load got no answer in 70 s,
and a tab tap showed the skeleton for the 30 s I watched, with no "taking longer" notice and no error. With PostgREST *stopped*, the cold load failed fast
(0.4 s, with Try again) but a tab tap to a server-loaded page showed its skeleton for 11.2, 11.4 and 40.3 s before the error, and once for more than 60 s.
The server logged the failed render within a moment each time (`server_render_failed`), so the delay is between the server and the page, and I did not find where.
A stopped container in Docker may behave unlike an unreachable Supabase (Kong may hold the connection), so I can't say how often production would hit this. PF3 had seen the
skeleton "stays" for a hung gateway; PF5 to PF7 made more pages depend on it. A 15 s `AbortSignal` on the server's Supabase client, and finding why
the page waits after the server has failed, is the follow-up.

**Fixed in #PRNUM.** What a person notices: when Supabase hangs, a page shows "We couldn't load this page" with Try again
after about 8 s instead of a skeleton that never ends; when it fails, after about 4 s at most instead of 10 to 60 s.

*Why the tab tap waited (the cause I was asked to find).* Nothing waits between the server and the page. The wait is in the lab's
gateway, and the server had no limit to cut it short. Right after `docker stop` of PostgREST, Kong still connects to the
container's old address, so the first calls hang inside Kong: 10.3 s in two of my three taps and 60 s in the third (`curl`
against Kong showed the same: 14.3 s, then `503 name resolution failed` in 3 ms once it noticed). The delay proxy's own lines
show each of the page's four Supabase calls taking those 10.3 or 60 s, the server wrote `server_render_failed` the moment Kong
answered, and the page showed the error 0.1 s after that. So PF13's "the server logged the failure within a moment" didn't hold in
my runs; the cold loads PF13 timed at 0.4 s most likely came after Kong had noticed (I ran one of each: 0.35 s and 60.4 s).
With Kong already answering 503, a tap showed the error in 0.12 s before the fix too. The other candidates, checked: the client
router (the page's RSC answer started 25 ms after the tap and ended when the server failed), SWR waiting on a fallback promise (a
failed loader resolves to `undefined`, PF6), the boundaries (each section's `error.tsx` caught it), and retries in the loaders (none).
One thing I did find on the way: **supabase-js retries a failed read** (a `GET` answered 503 or a network error) up to three times,
1, 2 and 4 s apart. With Kong answering 503 in 3 ms, `GET /api/reminders/summary` and `/api/todos` took 7,080 and 7,035 ms to
answer 500. A page's account read wasn't slowed by it (its `rpc` is a `POST`, which isn't retried, and fails first), but every API
read was. With the browser's own retry on top, that may explain PF13's 16 s for a page loaded in the browser (check 4); I didn't
time that case before the fix.

*What changed.*
- Every Supabase call from the server has a time limit, in the one place all clients share, `createTracedFetch`
  (`src/lib/log/traced-fetch.ts`): a call that hasn't answered within 4 s is aborted and fails with a `SupabaseTimeoutError`,
  logged as `supabase_timeout` (warn) with the call's span name. It applies to page renders, the proxy and API routes alike.
- An API route whose request had a timeout answers **504** `{ error: "The server took too long to answer. Try again in a moment.",
  code: "timeout", requestId }` (`withUser` in `src/lib/http/route.ts`); the request line names the call (`supabaseTimeout`). The
  browser doesn't retry a `timeout` (PF2), so it shows the error with Try again at once. A page shows its section's error screen.
- A session check that can't reach Supabase Auth (no connection, a 5xx from the gateway, or out of time) is now an error, not
  "signed out" (`getCurrentUser` in `src/lib/supabase/auth.ts`). Before, the layout sent you to the sign-in page during an Auth
  outage, and an API route answered 401, which sends the browser to sign in too.
- Every client has `db: { retry: false }`: no supabase-js retries on the server. The browser retries a 5xx once within its 15 s
  budget, so there is one retry policy.
- The worker's calls get **20 s** (`WORKER_SUPABASE_TIMEOUT_MS` in `src/lib/supabase/worker-store.ts`), through
  `createAdminClient({ timeoutMs })`.
- A lint rule, `local/supabase-client-options`, refuses a Supabase client without `global: { fetch }` (the traced fetch) and
  `db: { retry: false }` (docs/lint-rules.md). Seven clients needed the second; all already had the first.
- `scripts/lab/fault-probe.mjs`, the probe below, is in the repo now (PF13's was a scratch file), and docs/lab.md explains the
  Kong behaviour.

*Why 4 s, and 20 s for the worker.* A hung Supabase costs two limits in a row before anything can answer: the proxy's session
refresh (`src/proxy.ts`, on every page and API request), then the first call of the page or route. Two times 4 s is 8 s, the moment a
page loaded in the browser says "taking longer than usual" (PF2's 8 s, from Nielsen's 10 s limit [S8]), and an API read's 504 comes
before the browser's own 15 s timeout, so the person sees the server's message and its ref. The slowest whole route in the lab is
447 ms with 40 ms to Supabase (PF13 section 7), so 4 s is about ten times that; a single call is far less. 5 s would put two at 10 s,
past the 8 s point; 3 s leaves less room for a slow but working Supabase. The worker has no person waiting and its daily clean-ups
delete in bulk, so it gets more; but a hung call stops its loop, since each tick waits for the last. 20 s ends a hung call before the
next tick is due (30 s) and well inside a claimed row's 2-minute lease, so the row is claimed again as after any other failure.
Turned down: one limit for a whole request (a deadline shared by its calls): fairer, but it needs a deadline carried through the
proxy, the page render and the routes, which have no shared context (a page render has no request context, PF6); `db.timeout` in
supabase-js (PostgREST only, not Auth or Storage); `AbortSignal.timeout` (it can't log or mark the request, and fake timers can't
drive it in tests). Keeping supabase-js's retries but not on a timeout was possible too; I turned them off because they add 7 s to
every failed read and the browser retries anyway.

*Numbers.* Lab, the parent, 390 px emulated phone, no throttling, no added delay, from the moment of the fault, on `6d5370f` (before)
and this branch (after). Each cell is one run unless it lists several. Command: `node scripts/lab/fault-probe.mjs <cold|tap> <fault> /expenses`
(the tap is from Home), and for the API rows a signed-in `fetch` of the route with the fault in place.

| Case | Before | After |
| --- | ---: | ---: |
| Gateway paused (hung), cold load of Expenses | no answer in 75 s | error with Try again at **8.3 s** |
| Gateway paused, tap Home → Expenses | skeleton for 75 s, no notice, no error | error at **8.1 s** |
| PostgREST just stopped (Kong hangs), tap Home → Expenses | 10.4, more than 60 (the server answered at 60.1), 10.4 s | **4.1, 4.1, 4.1 s** |
| PostgREST just stopped, cold load of Expenses | 0.35, 60.4 s | 0.35, 0.24 s (Kong had already noticed both times, so this row doesn't test the hang; the tap row does) |
| PostgREST stopped, Kong answering 503 at once, tap Home → Expenses | 0.12, 0.12 s | 0.12 s |
| PostgREST stopped, Kong answering 503 at once: `GET /api/reminders/summary`, `/api/todos` | 500 after 7,080, 7,035 ms | 500 after **49, 19 ms** |
| Gateway paused: `GET /api/reminders/summary`, `/api/todos` | not measured (no server limit; the browser gives up at 15 s) | **504** `timeout` after 8,055, 8,021 ms |
| PostgREST just stopped, tap to Net worth (loaded in the browser), 1280 px | 16.05, 16.18 s (PF13) | **4.18, 4.18 s** |
| Gateway paused, tap to Net worth, 1280 px | not measured | 12.1 s: the page's own request waits 4 s in the proxy, then its API read 8 s (proxy and route) |

A normal cold load is unchanged (`npm run lab:measure -- /dashboard /expenses --user parent --runs 1 --no-lighthouse --throttle none`: data in
the first HTML, no API requests, as before).

*Tests.* `src/lib/log/traced-fetch.test.ts` ("the time limit", fake timers): nothing at 3,999 ms, at 4,000 ms a `SupabaseTimeoutError`, one
`supabase_timeout` line with the request id and the mark on the request; a fetch that ignores its signal still ends; the limit applies outside a
request; the worker's 20 s; a call that answered in time writes nothing; the caller's own abort isn't a timeout; the first timed-out call is the one
named. `src/lib/supabase/traced-clients.test.ts` (the real supabase-js): a hung read gives up once after 4 s and isn't tried again, a 503 isn't
retried, and a hung session check is an error, not a signed-out caller. `src/lib/http/route.test.ts`: the 504 body and line, and a failed session
check is a 500 or 504, never a 401. `src/lib/supabase/auth.test.ts`: `getCurrentUser` throws on a timeout and a gateway error. Lint rule tests in
`eslint-rules/supabase-client-options.test.mjs`.

*How to check it yourself* (a few minutes, in the lab, never production): `npm run lab -- up`, then
`node scripts/lab/fault-probe.mjs tap pause /expenses` (look for `"errorAt"` near 8,000) and `node scripts/lab/fault-probe.mjs tap stop /expenses`
(near 4,000). `npm run lab -- down` at the end.

*Risks and how to undo it.* A Supabase call that legitimately takes more than 4 s now fails: none does in the lab (the slowest route is
447 ms), but production's p95 per route isn't measured yet (row 1); a `supabase_timeout` line in production is the sign. A big statement import or
an account deletion are the likeliest to come near it. The number is one constant, `SUPABASE_TIMEOUT_MS`. The 504 mark is per request: if a call
times out and the route handles it and then fails for another reason, it still answers 504. During an Auth outage people now see an error page
instead of the sign-in page, which is the point, but it is a change. Undo: revert #PRNUM.

*Left open.* Not measured in production (row 1). A tap to a page loaded in the browser can take three limits in a row while Supabase is hung
(12.1 s above: its page request, then its API read's two); still under the browser's 15 s, but past 8 s. A body that stalls after its headers is
aborted at 4 s too, but without a `supabase_timeout` line and with a 500, not a 504. The worker's 20 s is reasoned, not measured: the lab doesn't run
the worker.

**Not measured, and why.**

- **Production:** everything in the table under "The production cells", and the plan's "at least 3 days after the last deploy": no VPS access. Row 1.
- **PF12's memory numbers weren't re-run** (they need a built image and `scripts/lab/runtime.sh`); 4.6 quotes PF12's.
- **The kid on Home, To-dos and Reminders, the second adult and the user with no family** weren't in the timed runs, as in PF1b; the smoke checks 2, 7 covered the kid on the four pages.
- **Interaction timing is the lab's driver, not INP from real visits.** A tap on a real phone, a month over about 300 rows, and Safari and Firefox were not measured.
- **Lighthouse was not run for the kid at 40 ms,** and not on the next pages.
- **The scripts are lab scripts on this Mac,** on Node 23.4, with `next start` and no proxy; production runs the standalone server on Node 24 behind Tailscale.
- **React's hydration error (#418) on To-dos** (PF8, PF11) did not appear in the To-dos loads whose console I read here (four). Not a measurement.

**Waiting for George.** The list is at the top of this document, in order. Two items need a sentence here because
nothing else says them plainly:

- **The exposed commit `ae29d84` (row 2).** PF9 pushed this commit to the public repository. It holds five of your untracked drafts
  (`docs/bug-fixes-plan.md`, `docs/duolingo-styling-plan.md`, `docs/expense-tabs-and-subtypes-plan.md`, `docs/net-worth-plan.md`,
  `docs/ui-progress-2026-11-04.md`) and PF9's own changes. PF9 then removed it from the branch: it isn't on `main` and isn't in
  PR #235's commit list (`git merge-base --is-ancestor ae29d84 origin/main` says no). GitHub still serves it by its hash, which
  is how a commit that was once pushed to a public repository behaves. No secrets were found in them when this was
  noticed, and I did not read them again. A force-push can't take the commit back. Only GitHub Support can remove
  the commit and its cached views. Whether to ask is your call: the files are plans, not credentials.
- **"Add a kid" (row 3).** The lab found that creating a kid account fails on a database built from the migrations
  (`permission denied for function my_kid_ai_permitted`). It most likely fails in production too; that was not checked there.

**This task's own checks.** `npm run lint`, `npx next typegen && npm run typecheck`, `npm test` (351 files, 7,109 tests passed,
1 skipped) and `npm run build` pass; they ran on a documents-only change, so they show the checkout is still sound, not that anything was tested. `npm run test:db` not run: no SQL touched. The lab was taken down with
`npm run lab -- down` at the end, and nothing of it was left running (George's `node harness.cjs` on port 54331 is not the lab's).
