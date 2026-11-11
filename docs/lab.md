# The local lab

A throwaway copy of the app's backend on this machine, with a fake family in it, so signed-in pages
can be timed in a real browser without touching live data. It was built for the performance work
(phase 16, task PF1b); the numbers it produced are in [performance.md](performance.md), "Signed-in
lab baseline".

**The rule: the lab never points at the live project.** Everything it starts talks to `127.0.0.1`.
`scripts/lab/guard.mjs` refuses to start the app, the seed or a measurement if any `*_URL` in the
lab's env file isn't on this machine. The app is built and run from a copy of the checkout that has
no `.env` file, with an empty environment plus the lab's env file, so the live project's
`.env.local` can't reach it. Never copy values from `.env.local` into the lab, and never point
`SUPABASE_URL` in `.lab/app.env` anywhere else.

## Start, use, remove

Needs Docker, Node, `jq`, `curl`, `rsync` and `lsof`. The Supabase CLI comes through `npx` at a
pinned version (2.122.0) and Lighthouse the same way (13.6.0); nothing is installed globally.
Measuring needs a Chromium: the one Playwright downloads (build 1194) is found by itself, otherwise
set `CHROME_PATH`.

```bash
npm run lab -- up                 # about 75 s once the images are pulled: stack, schema, build, app, seed
npm run lab -- status             # what's running, the JWT mode, the delay, the build
npm run lab:measure -- /dashboard # time a page signed in (see "Measuring" below)
npm run lab -- down               # stop and delete everything (containers, volumes, files); results stay
```

Then open <http://localhost:3110> and sign in with a name and password from `.lab/users.json`.

Other commands:

| Command | What it does |
| --- | --- |
| `npm run lab -- up --jwt asymmetric` | Start with Auth signing tokens with an asymmetric key instead of the shared secret |
| `npm run lab -- app [--no-build] [--delay-ms N]` | Rebuild (unless `--no-build`) and restart the app, for example after changing code |
| `npm run lab -- jwt shared` / `jwt asymmetric` | Switch how Auth signs tokens; restarts Auth and the app |
| `npm run lab -- delay 40` | Add 40 ms to every call from the app to Supabase (see below); `delay 0` removes it |
| `npm run lab -- stop-app` | Stop the app and the delay proxy, leave the database up |
| `node scripts/lab/skeletons.mjs /<page> <width> [--tap /<page>]` | Compare a page's loading state with its loaded state (heights, layout shifts, screenshots) or time how soon a tab tap shows its skeleton; PF3 |
| `node scripts/lab/search-compare.mjs > search.json` | The tab ledger's answer to 43 searches on two tabs (it adds a tab of every expense for the parent and a few awkward descriptions for the solo user); run it on two builds and `diff` the files. PF4 |
| `node scripts/lab/route-probe.mjs .lab parent 5 > routes.json` | Calls 28 routes five times each (some write: titles, a card's place) and prints the median server ms, `dbCalls`, `dbMs`, Auth calls and `get_family()` per route. Run `search-compare.mjs` first. PF4 |
| `node scripts/lab/session-gate.mjs [--width 390] [--writes]` | Loads every section cold signed out, as the parent, as the kid, with a damaged cookie and after "sign out everywhere", then signs out and in as the kid in one tab; prints where each load ended, the redirects, the scripts and `/api/account` requests, and every console error or warning. `--writes` adds a kid's first sign-in, a member removed from the family and a deleted account: it changes the lab's data, so run it last. PF5 |
| `node scripts/lab/first-render.mjs [/dashboard \| /expenses \| /todos \| /reminders] [--users parent,kid,solo] [--widths 390,1280] [--shots <dir>] [--prefix after] [--kid-without-expenses]` | For a page whose first data comes from the server (a query works too, like `/expenses?member=all`): per user and width, the first and last byte of the page, which of the user's data strings are in its HTML outside any script, the Supabase calls of that one render, then a cold load in Chromium listing every data API request on the first render and every console error or warning, with a screenshot (`<prefix>-<page>-<user>-<width>.jpg`). `--kid-without-expenses` turns the kid's expenses permission off for the run (it changes the lab's data, and turns it back on at the end) and checks none of the kid's expenses are anywhere in the page. PF6; other pages in PF7 |
| `node scripts/lab/navigation.mjs [--width 1280\|390] [--throttle none\|cpu\|mobile] [--pause 16] [--moves Expenses,Reminders,To-dos,Home,…] [--start /dashboard] [--hover 0]` | The click-through: loads the start page cold, then taps the link to each page in `--moves` (waiting `--pause` seconds first, longer than SWR's 15 s dedupe window so "stale" requests show), and prints per load and per tap the requests by kind (data, RSC navigation and prefetch, scripts with size), the Auth and Supabase calls the proxy saw, the ms until the URL changed, the skeleton showed and the page loaded, and the waterfall depth of the tap (RSC request, a script it needs, a data request: up to 3). `--hover N` puts the pointer over the link N ms before the tap. PF8 |
| `node scripts/lab/interactions.mjs [--scenario quick-add,month,search,reminder-done,todo-drag,net-worth] [--width 390\|1280] [--throttle cpu\|none] [--reps 5] [--warm] [--debug]` | How long taps and key presses take to reach the next frame (INP's parts): scripted taps, typing and a drag on a touch phone (390) or a mouse (1280) in a new browser per repetition, read from the browser's Event Timing API; prints each interaction's median, p75 and worst in ms (under 16 ms counts as 0). It changes the lab's data a little (reminders marked done, net-worth values added, to-dos moved). PF11 |
| `scripts/lab/runtime.sh web\|load\|worker <image>` and `heap <limit> <image>` | What the production image costs in memory: the image runs with `deploy.sh`'s container flags (768m web, 256m worker) inside the lab's network, signed in as the parent. `web`: memory after start, after the first request and after every page, the first requests' times and the heap limit; `load`: 4,800 requests, 8 at a time, and the container's peak; `worker`: 4 minutes; `heap`: the heap limit Node picks for a memory limit. Needs a built image (`docker build -t expense-tracker:pf12 .`) and the lab up. PF12 |
| `npm run lab:baseline` | The full signed-in baseline: four pages, both JWT modes, 0 and 40 ms, both passes below (about 80 minutes; `LAB_BASELINE_PASS=cpu` for the second pass only) |

`up` is safe to run twice: if the lab is already up and seeded it only prints the status, and if a
half-made one is running it removes it first. `down` stops the app and the proxy by their PIDs
(it checks the PID still runs the command it started before it signals it), removes the
containers, volumes and network by the project's Docker label and deletes `.lab/` except
`.lab/results/`. It ends by checking `docker ps -a` and `docker volume ls` for anything left.
Docker images stay, so the next `up` doesn't download them again.

Memory: right after `up`, the five containers use about 400 MiB (Postgres 90, Storage 148, Kong 96,
PostgREST 43, Auth 17; `docker stats --no-stream`) and the app about 190 MB. It runs with Docker
Desktop's 4 GB.

## What runs

```text
browser ──► app (next start, :3110) ──► delay proxy (:54400) ──► Kong (:54321) ──► Auth, PostgREST, Storage ──► Postgres (:54322)
```

- **The Supabase stack** is `supabase start` with `scripts/lab/supabase-config.toml`, which
  `lab.sh` copies to `.lab/cli/supabase/config.toml` and runs the CLI there. It is deliberately not
  at `supabase/config.toml`: every `supabase` command run in the repo reads that file, and a
  `supabase config push` would send the lab's settings to the hosted project. The CLI's own state
  stays in `.lab/cli` too (it would otherwise rewrite the tracked `supabase/.temp/cli-latest`).
- **Only Postgres, Auth, PostgREST, Kong (the gateway) and Storage run.** Storage is there only for
  the schema: the profile pictures migration inserts its bucket into `storage.buckets`, and in the
  CLI's stack only the Storage service creates that table. With Storage off the replay stops at
  `20261018000100_add_profile_avatars.sql` (tried). No target page calls Storage: the delay proxy
  logged 0 Storage calls in the whole baseline. Studio, Realtime, edge functions, logging, mail and
  the pooler are off.
- **The schema** goes in the same way as `npm run test:db`: `supabase/tests/support/legacy-bootstrap.sql`
  first, then every file in `supabase/migrations/` in order, unchanged. The CLI's own migration and
  seed steps are off.
- **The app** is a production build (`next build --webpack`, as the Docker image does), built in a
  copy of the checkout under `$TMPDIR/expense-tracker-lab/app` without `.env*`, `.git`, `.next`,
  `.claude`, `docs` and `node_modules` (linked). It runs with `next start` and an empty environment
  (`env -i`) plus `.lab/app.env` minus the lab's own `LAB_` variables. After start-up the script
  checks the app's own start-up line says AI and investment prices are off: `.env.local` sets both,
  so if they're off, it wasn't read. `.lab/app-environment` lists every variable the app got, by
  name.
- **The delay proxy** (`scripts/lab/supabase-proxy.mjs`) sits between the app and Supabase. It adds
  a fixed delay to each call (0 by default) and writes one line per call to `.lab/supabase-calls.jsonl`
  (time, method, which API, the path without its query string, status, milliseconds; never a header
  or a body). That file is how the lab counts Auth calls, including the proxy's own, which no app log
  line shows.

### JWT signing modes

The live project signs its tokens with a shared secret, so its JWKS is empty and every `getClaims()`
asks Supabase Auth over the network. The local stack signs with an asymmetric (ES256) key by
default. The lab runs both:

- `shared` (the default, like production today): the Auth container is re-created with the same
  settings except its signing key, so it signs with the shared secret (HS256) and
  `/auth/v1/.well-known/jwks.json` answers `{"keys":[]}`. `lab.sh` refuses to go on if it lists a key.
- `asymmetric` (what the project would switch to): the CLI's own ES256 key; the JWKS lists one key,
  and the app checks tokens itself after fetching it once (the Supabase client keeps it for 10
  minutes). `lab.sh` refuses to go on if it lists none.

`status` prints the mode and how many keys the JWKS lists.

### The delay

On this machine a call to Supabase takes well under a millisecond on the network, which hides the
cost of every round trip. In production the app server reaches Supabase over the internet.
`npm run lab -- delay <ms>` makes every call wait `<ms>` in total (half on the way there, half on
the way back). It doesn't model new connections, TLS or bandwidth, so it is a lower bound of the
network's cost, not a copy of production.

The baseline uses **40 ms**: the median of 20 requests on one connection from George's laptop to
the live project's public JWKS endpoint (read-only, no key), 10 November 2026, 15:30 UTC. That is
**from this laptop, not from the VPS**; the VPS may be nearer or farther. To get the VPS's number:

```bash
# On the VPS: 21 requests on one connection; ignore the first (it opens the connection).
U=https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json
args=(); for i in $(seq 21); do args+=(-o /dev/null "$U"); done
curl -s -w '%{time_starttransfer}\n' "${args[@]}" | tail -n +2 | sort -n | sed -n 10,11p
```

`delay` takes 0 to 5000 ms, so it can slow a request but not make one wait past the app's 15 s
timeout. To make a request hang, freeze the gateway after you've signed in, and thaw it when you
are done (every call from the app then waits until its own timeout); for a server error, stop
PostgREST:

```bash
docker pause supabase_kong_expense-tracker-lab     # requests hang;  docker unpause … to undo
docker stop supabase_rest_expense-tracker-lab      # data requests fail with a 500;  docker start … to undo
```

Sign in first: a paused gateway stops the sign-in route too, and the cookies keep working for an hour. Too many wrong sign-ins lock the sign-in
route for a few minutes (it counts in the app's memory: `npm run lab -- app --no-build` clears it).
`scripts/lab/states.sh <name>` runs both, a signed-out visit, a session that ends mid-visit and an
offline error against Expenses at 1280 and 390 px and times what the page shows
(`scripts/lab/states.mjs` is the probe). PF2 used it ([performance.md](performance.md), PF2).

## The seed

`scripts/lab/seed.mjs`, run by `up`. Deterministic: a fixed random seed, and every date counted
from "today" in Europe/Bucharest (so `down` and `up` on another day give the same family, shifted).
Passwords are random, written only to `.lab/users.json` (git-ignored, mode 600), never printed.

| Who | Signs in with | What they are |
| --- | --- | --- |
| `parent`: Alex Example | `alex.parent@lab.test` | Created "The Example Family"; pays the bills |
| `adult`: Sam Example | `sam.adult@lab.test` | Second parent, joined with an invite code |
| `kid`: Robin Example | username `robin.lab` | Kid account: may add expenses, nothing else (no family finance, investments, net worth, AI assistants or AI) |
| `solo`: Casey Solo | `casey.solo@lab.test` | A user with no family |

What's in it (the seed's own count, 10 November 2026): 6,640 expenses over three years (Alex 3,724,
Sam 2,653, Robin 263 over the last year). In recent months that's about 290 a month for the family:
Alex about 150 plus three monthly bills, Sam about 110, Robin about 25; fewer the further back. Two
saved expense tabs, 16 reminders (due today, overdue, upcoming, repeating, one done, one that logs
an expense), a to-do board with 14 open and 8 done cards, seven calendar events (one repeating
weekly), five investment orders and three net-worth items.

How it's written: accounts through the Auth admin API; everything else through the app's own API
routes while signed in as that person (the family, the invite, colours, tabs, reminders, to-dos,
events, orders, net worth), except the expenses, which are too many for the API's 120 writes a
minute and go into the `expenses` table through PostgREST as their owner (row level security and
the merchant trigger apply). Two things are not done the app's way, both because of the problem
below: each `profiles` row is written by the database owner, as the live project's signup trigger
would, and the kid is created step by step (account, profile, then `add_managed_kid` called as
the parent, then the kid signs in and chooses a new password through the app).

### What the lab found while seeding

**Creating a kid account fails on a database built from the migrations.** `AuthAdmin.createUser`
(`src/lib/supabase/auth-admin.ts`, used by "Add a kid", `POST /api/family/kids`) upserts the new
`profiles` row with the secret key (`service_role`). The trigger `guard_profile_ai_enabled`
(migration `20261030000100`) calls `ai_private.my_kid_ai_permitted()`, which only `authenticated` may
execute. Postgres checks that permission when it sets up the trigger's `if` expression, before the
`current_user in ('authenticated', 'anon')` test can skip the call, so the write fails with
`permission denied for function my_kid_ai_permitted`, even though the trigger means to ignore
`service_role`. Reproduced on the lab database, each in a new session:

```sql
-- as supabase_admin, after `insert into auth.users (id, email) values ('…', 'x@lab.test')`
set role service_role;
insert into public.profiles (id, email) values ('…', 'x@lab.test');
-- ERROR:  permission denied for function my_kid_ai_permitted

-- and the same when the row already exists (what production's signup trigger leaves), as an upsert:
insert into public.profiles (id, email, display_name) values ('…', 'x@lab.test', 'x')
  on conflict (id) do update set display_name = excluded.display_name;
-- ERROR:  permission denied for function my_kid_ai_permitted
```

`has_function_privilege('service_role', 'ai_private.my_kid_ai_permitted()', 'execute')` is false.
It most likely breaks "Add a kid" in production too; that wasn't checked there (no access, and it
would need a write). The lab works around it in the seed only; the app and the migrations are
unchanged.

## Measuring

```bash
npm run lab:measure -- /dashboard /expenses --user parent --runs 3
npm run lab:measure -- /expenses --user kid --runs 3 --no-lighthouse   # observed numbers only, faster
npm run lab:measure -- /todos --json > todos.json                        # everything as JSON
```

For each page it signs in through the app's own `POST /api/auth`, as the sign-in form does, and
gives a new, empty browser profile exactly the cookies that route set. Then one unmeasured warm-up
load, then per run two cold loads, each with a fresh sign-in:

1. **Observed**: Chromium over the DevTools protocol, with Lighthouse's mobile screen and its
   "devtools" throttling applied for real (562.5 ms added to each request, 1.44 Mbit/s down,
   675 kbit/s up, CPU 4× slower). It records when the page's content appeared, every request, the
   waterfall, LCP and its element, CLS, long tasks, JS bytes, and the server's log lines and
   Supabase calls for that load.
2. **Lighthouse 13.6.0**, default mobile preset: simulated throttling (150 ms round trip,
   1.6 Mbit/s, 4× CPU, computed from an unthrottled load). The headline FCP, LCP, CLS, TBT and TTI.

`--throttle cpu` keeps the phone's screen and CPU but drops the network throttling (use it with
`--no-lighthouse`). Use that pass to see the server: the applied slow-4G throttling holds every
response until 562.5 ms after its request, which hides any server time shorter than that.
`--throttle none` drops both.

`scripts/lab/measure.mjs` explains every number at the top of the file; `performance.md` explains
how to read them. Each call saves its runs, the Lighthouse reports and the app's request lines in
`.lab/results/<time>/`. `node scripts/lab/report.mjs <folder> …` puts several in one table, and
`scripts/perf-report.sh --input <folder>/requests-*.jsonl` reads the request lines like the
production logs.

## Finding slow queries (PF10)

`pg_stat_statements` is already installed in the lab's database. By default it records only top-level statements, so a function's inner
queries are hidden inside the one call; turn on all of them, reset, use the app, then read it
(`docker exec -it supabase_db_expense-tracker-lab psql -U supabase_admin -d postgres`):

```sql
alter system set pg_stat_statements.track = 'all';
select pg_reload_conf();
select pg_stat_statements_reset();
-- … run `node scripts/lab/route-probe.mjs` or `npm run lab:measure`, then:
select calls, round(total_exec_time::numeric, 1) as total_ms, round(mean_exec_time::numeric, 2) as mean_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 200) as query
from pg_stat_statements order by total_exec_time desc limit 20;
```

To `explain` a query the way the app runs it (row level security on), do it in a transaction as the signed-in user and roll back:
`begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<userId from .lab/users.json>","role":"authenticated"}', true);`
`explain (analyze, buffers) …; rollback;`. Scaling a small table up for a test goes in the same transaction, before the `set local role`.
The results are in [performance.md](performance.md), PF10.

## Checking it never reached the live project

- `npx vitest run scripts/lab` runs the guard's tests, including `lab.sh guard`, `app` and
  `measure` refusing an env file with a hosted `SUPABASE_URL` before anything starts.
- `cat .lab/app-environment`: every variable the app was started with, by name, and its
  `SUPABASE_URL` (the delay proxy on 127.0.0.1).
- While it runs: `lsof -nP -a -p "$(cat .lab/app.pid),$(cat .lab/proxy.pid)" -i` lists the app's
  and the proxy's sockets; every remote address is 127.0.0.1.

## What the lab can't tell you

- Real phones, real networks and real users: the lab is one laptop and an emulated phone. Real use
  is in the production logs (`scripts/perf-report.sh` on the VPS).
- The VPS's CPU and memory, Node 24 (the lab uses the Node on this machine) and the standalone
  `server.js` production runs (the lab runs `next start`).
- The proxy in front of production (TLS, HTTP/2, Tailscale) and whether it streams.
- Supabase's real latency and load: the delay is a fixed lower bound, and the local database is
  idle and small next to a shared hosted one.
