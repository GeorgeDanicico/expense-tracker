#!/usr/bin/env bash
# Prints the app's real-use performance numbers as markdown tables, from the web container's logs.
# Run it on the VPS, where journald keeps the logs. It only reads: `journalctl`, `jq` and standard tools.
#
#   scripts/perf-report.sh [days] [container]
#   scripts/perf-report.sh 5 expense-tracker-web      the defaults
#   scripts/perf-report.sh --input lines.jsonl        read lines from a file instead (the test does)
#
# It needs permission to read the journal: run it with `sudo`, or as a member of `systemd-journal`.
# Paste the output into docs/performance.md (the "Baseline and budgets" section). PF13 runs the same
# command again, so the same questions get the same answers.
#
# What it reads (docs/logging.md has the line shapes):
#   - `web_vital` lines, written for each Web Vitals measurement the browser sends (LCP, INP, CLS,
#     FCP, TTFB), with `page` (a path, ids replaced), `value`, `rating` and `navigationType`.
#   - `request` lines, written once per API request, with `route` (a template), `method`, `status`,
#     `ms`, `userId` (when signed in), `spans` ([{name, ms, count?}]), `dbMs` and `dbCalls`.
#
# Percentiles are "nearest rank": for n samples sorted ascending, pP is the sample at position
# ceil(P * n). There is no averaging between samples, so a p95 is always a value that really happened.
#
# What the logs cannot tell (and this script says so at the end): the proxy's own call to Supabase
# Auth is not in a `request` line (the proxy runs before the request has a context), the heap limit
# Node chose, the container's memory, and whether the reverse proxy streams or compresses.

# The jq programs are single-quoted on purpose: `$` and backticks in them are jq's and Markdown's, not the shell's.
# shellcheck disable=SC2016
set -Eeuo pipefail

usage() {
  sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//' | head -n 12
}

days=5
container=expense-tracker-web
input=""
positional=()
while (($# > 0)); do
  case "$1" in
    -h | --help) usage; exit 0 ;;
    --input) input="${2:?--input needs a file}"; shift 2 ;;
    *) positional+=("$1"); shift ;;
  esac
done
((${#positional[@]} > 0)) && days="${positional[0]}"
((${#positional[@]} > 1)) && container="${positional[1]}"
((${#positional[@]} > 2)) && { echo "Too many arguments." >&2; usage >&2; exit 2; }

if ! [[ $days =~ ^[1-9][0-9]{0,2}$ ]]; then
  echo "days must be a whole number from 1 to 999, got: $days" >&2
  exit 2
fi
if ! [[ $container =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
  echo "container must be a container name such as expense-tracker-web, got: $container" >&2
  exit 2
fi
command -v jq >/dev/null || { echo "jq is needed: sudo apt install jq" >&2; exit 1; }

lines="$(mktemp)"
trap 'rm -f "$lines"' EXIT

# One JSON object per line. `fromjson?` drops anything else (Node's own warnings at start-up).
keep_events='fromjson? | select(type == "object" and (.event == "request" or .event == "web_vital"))'
if [[ -n $input ]]; then
  jq -R -c "$keep_events" < "$input" > "$lines"
else
  command -v journalctl >/dev/null || { echo "journalctl is needed (this is meant to run on the VPS)." >&2; exit 1; }
  journalctl --no-pager CONTAINER_NAME="$container" --since "$days days ago" -o cat | jq -R -c "$keep_events" > "$lines"
fi

# Shared jq definitions.
common=$(cat <<'JQ'
def pct($p): sort | if length == 0 then null else .[(((length * $p) | ceil) - 1)] end;
def ms: if . == null then "–" else (round | tostring) end;
def dec($scale): if . == null then "–" else (((. * $scale) | round) / $scale | tostring) end;
def p75($name): [.[] | select(.name == $name) | .value] | pct(0.75);
def lcpCount: [.[] | select(.name == "LCP")] | length;
def perCall: .ms / (.count // 1);
def row($cells): "| " + ($cells | map(tostring) | join(" | ")) + " |";
def avg: if length == 0 then null else (add / length) end;
JQ
)

section() { printf '\n## %s\n\n' "$1"; }
run() { jq -r -s "$common $1" "$lines"; }

echo "# Performance report"
echo
if [[ -n $input ]]; then
  echo "Source: \`$input\` (read from a file, not the journal)."
else
  echo "Source: \`journalctl CONTAINER_NAME=$container --since \"$days days ago\"\`, read on $(date -u +%Y-%m-%dT%H:%MZ)."
fi
echo
run '
  [.[] | select(.event == "request")] as $r
  | [.[] | select(.event == "web_vital")] as $v
  | [.[].time] as $times
  | "- `request` lines: \($r | length). `web_vital` lines: \($v | length).",
    "- Oldest line: \($times | min // "none"). Newest line: \($times | max // "none")."
'

section "Web Vitals: p75 per page (real visits)"
run '
  def cells: [(p75("LCP") | ms), (p75("INP") | ms), (p75("CLS") | dec(1000)), (p75("FCP") | ms), (p75("TTFB") | ms),
              lcpCount, length];
  [.[] | select(.event == "web_vital" and (.value | type) == "number" and (.page | type) == "string")] as $v
  | if ($v | length) == 0 then "_No `web_vital` lines in this window._" else
    "| Page | LCP p75 (ms) | INP p75 (ms) | CLS p75 | FCP p75 (ms) | TTFB p75 (ms) | LCP samples | All samples |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ($v | group_by(.page) | map({page: .[0].page, v: ., n: lcpCount}) | sort_by(-.n, .page)[]
      | row(["`" + .page + "`"] + (.v | cells))),
    row(["**All pages**"] + ($v | cells)),
    "| Budget (p75) | 2500 | 200 | 0.1 | – | 800 | | |"
  end
'

section "Web Vitals: p75 by navigation type, all pages"
run '
  [.[] | select(.event == "web_vital" and (.value | type) == "number")] as $v
  | if ($v | length) == 0 then "_No `web_vital` lines in this window._" else
    "| Navigation type | LCP p75 (ms) | INP p75 (ms) | CLS p75 | TTFB p75 (ms) | LCP samples | All samples |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ($v | group_by(.navigationType // "unknown")[]
      | row([(.[0].navigationType // "unknown"), (p75("LCP") | ms), (p75("INP") | ms), (p75("CLS") | dec(1000)), (p75("TTFB") | ms),
             lcpCount, length]))
  end
'

section "API requests: latency per route"
echo "Server time from the request line (\`ms\`), not what the browser waited. Budget: p95 at most 300 ms; routes that call AI or parse a statement (an \`ai.*\` or \`import.*\` span) are exempt."
echo
run '
  [.[] | select(.event == "request" and (.route | type) == "string" and (.ms | type) == "number")] as $r
  | if ($r | length) == 0 then "_No `request` lines in this window._" else
    "| Route | Requests | p50 (ms) | p95 (ms) | Max (ms) | 5xx | dbCalls p50 | dbCalls p95 | Slowest spans (p95 ms) | Budget |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ($r | group_by((.method // "?") + " " + .route)
      | map({name: ((.[0].method // "?") + " " + .[0].route), g: ., p95: ([.[].ms] | pct(0.95))}) | sort_by(-.p95, .name)[]
      | .g as $g
      | ([$g[] | (.spans // [])[]] | group_by(.name)
          | map({name: .[0].name, p95: ([.[] | perCall] | pct(0.95))}) | sort_by(-.p95, .name) | .[0:3]
          | map("\(.name) \(.p95 | ms)") | join(", ")) as $slow
      | (any($g[]; any((.spans // [])[]; .name | test("^(ai|import)\\.")))) as $exempt
      | row(["`" + .name + "`", ($g | length), ([$g[].ms] | pct(0.5) | ms), (.p95 | ms), ([$g[].ms] | max | ms),
             ([$g[] | select((.status // 0) >= 500)] | length), ([$g[] | .dbCalls // 0] | pct(0.5)), ([$g[] | .dbCalls // 0] | pct(0.95)),
             (if $slow == "" then "–" else $slow end),
             (if $exempt then "exempt" elif .p95 > 300 then "over" else "ok" end)]))
  end
'

section "Round trips per signed-in request"
echo "Counted from \`auth.*\` and \`rpc.get_family\` spans of requests that carry a \`userId\`. The proxy's own \`getClaims()\` call is not in these lines, so on a route the proxy covers the real number of Auth round trips is one more than shown."
echo
run '
  def calls(pred): [(.spans // [])[] | select(.name | pred) | (.count // 1)] | add // 0;
  [.[] | select(.event == "request" and .userId != null and (.route | type) == "string")] as $s
  | if ($s | length) == 0 then "_No signed-in `request` lines in this window._" else
    ($s | map(calls(startswith("auth.")))) as $auth
    | "All signed-in requests: \($s | length). Auth spans per request: average \($auth | avg | dec(100)). Spread: \($auth | group_by(.) | map("\(.[0]) span(s) in \(length) requests") | join("; ")).",
      "",
      "| Route | Signed-in requests | Auth spans avg | Auth spans max | get_family avg | get_family max | dbCalls avg |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
      ($s | group_by((.method // "?") + " " + .route) | sort_by(-length)[]
        | row(["`" + (.[0].method // "?") + " " + .[0].route + "`", length,
               (map(calls(startswith("auth."))) | avg | dec(100)), (map(calls(startswith("auth."))) | max),
               (map(calls(. == "rpc.get_family")) | avg | dec(100)), (map(calls(. == "rpc.get_family")) | max),
               (map(.dbCalls // 0) | avg | dec(100))]))
  end
'

section "Supabase calls: where the database time goes"
echo "Every \`db.*\`, \`rpc.*\`, \`auth.*\` and \`storage.*\` span, by total time. A span that was merged (\`count\`) is divided back into per-call time. PF10 starts from this table."
echo
run '
  [.[] | select(.event == "request") | (.spans // [])[] | select(.name | test("^(db|rpc|auth|storage)\\."))] as $s
  | if ($s | length) == 0 then "_No Supabase spans in this window._" else
    "| Span | Calls | p50 (ms) | p95 (ms) | Total (s) | Failed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ($s | group_by(.name) | map({name: .[0].name, g: ., total: (map(.ms) | add)}) | sort_by(-.total, .name) | .[0:20][]
      | .g as $g
      | row(["`" + .name + "`", ($g | map(.count // 1) | add), ([$g[] | perCall] | pct(0.5) | ms), ([$g[] | perCall] | pct(0.95) | ms),
             ((.total / 1000) | dec(100)), ([$g[] | select(.error == true)] | length)]))
  end
'

section "Not in the logs: run these by hand on the VPS"
cat <<'TEXT'
The heap limit and the container's memory are not logged. Read-only commands for them:

```bash
# The memory limit the deploy gave each container (bytes; 0 means none)
docker inspect -f '{{.Name}} {{.HostConfig.Memory}}' expense-tracker-web expense-tracker-worker
# Current memory against that limit (run it a few times over a day for a steady state and a peak)
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.MemPerc}}' expense-tracker-web expense-tracker-worker
# The heap limit Node chose inside the web container (MB)
docker exec expense-tracker-web node -e "console.log(require('v8').getHeapStatistics().heap_size_limit / 1048576)"
```

Whether the reverse proxy streams a response and compresses it: the two `curl` checks in
docs/performance.md, "Delivery checks".
TEXT
