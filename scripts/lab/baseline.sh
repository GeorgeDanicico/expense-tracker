#!/usr/bin/env bash
# The signed-in lab baseline (docs/performance.md, "Signed-in lab baseline"): every target page as the
# parent, Expenses as the kid too (the only target page where the kid's requests differ), in both
# JWT modes, with no added delay and with LAB_DELAY_MS (default 40) per Supabase call. 40 ms is the
# median round trip from George's laptop to the live project on a reused connection, measured on
# 10 November 2026: from this laptop, not the VPS. Needs a lab that is up (`scripts/lab.sh up`).
#
#   scripts/lab/baseline.sh [runs]          3 runs per page by default; about 80 minutes
#   LAB_DELAY_MS=60 scripts/lab/baseline.sh
#   LAB_BASELINE_PASS=cpu scripts/lab/baseline.sh      only the second pass (about 20 minutes)
#
# Two passes per JWT mode and delay (LAB_BASELINE_PASS=mobile, cpu or both, the default):
#   mobile  the phone's network and CPU throttling, plus Lighthouse: what a person on slow 4G sees
#   cpu     the phone's CPU only, no network throttling and no Lighthouse: shows the server's time,
#           which the mobile pass's 562.5 ms per request hides (scripts/lab/measure.mjs, --throttle)
# Then the first combination again, to see how far two medians of the same thing differ.
#
# Prints one table (scripts/lab/report.mjs) and leaves each run's files in .lab/results/<sweep>/.
# It ends with the lab back in shared-secret mode with no delay.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

runs=${1:-3}
delay=${LAB_DELAY_MS:-40}
pass=${LAB_BASELINE_PASS:-both}
[[ $pass == mobile || $pass == cpu || $pass == both ]] || { echo "LAB_BASELINE_PASS is mobile, cpu or both" >&2; exit 2; }
sweep=".lab/results/baseline-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$sweep"
folders=()

measure() {
  local name=$1
  shift
  bash scripts/lab.sh measure "$@" --runs "$runs" --out "$sweep/$name" > "$sweep/$name.log" 2>&1 || { cat "$sweep/$name.log" >&2; exit 1; }
  folders+=("$sweep/$name")
}

# combination <jwt mode> <delay> <name prefix>: both users, in the passes asked for.
combination() {
  local mode=$1 ms=$2 prefix=$3
  echo "lab baseline: $mode JWT, +$ms ms"
  if [[ $pass != cpu ]]; then
    measure "$prefix-parent" /dashboard /expenses /todos /reminders --user parent
    measure "$prefix-kid" /expenses --user kid
  fi
  if [[ $pass != mobile ]]; then
    measure "$prefix-cpu-parent" /dashboard /expenses /todos /reminders --user parent --throttle cpu --no-lighthouse
    measure "$prefix-cpu-kid" /expenses --user kid --throttle cpu --no-lighthouse
  fi
}

for mode in shared asymmetric; do
  bash scripts/lab.sh jwt "$mode"
  for ms in 0 "$delay"; do
    bash scripts/lab.sh delay "$ms"
    combination "$mode" "$ms" "$mode-${ms}ms"
  done
done
# Repeatability: the first combination again (parent only), to see how far two medians of the same thing differ.
bash scripts/lab.sh jwt shared
bash scripts/lab.sh delay 0
echo "lab baseline: shared JWT, +0 ms again"
if [[ $pass != cpu ]]; then measure "repeat-shared-0ms-parent" /dashboard /expenses /todos /reminders --user parent; fi
if [[ $pass != mobile ]]; then measure "repeat-shared-0ms-cpu-parent" /dashboard /expenses /todos /reminders --user parent --throttle cpu --no-lighthouse; fi

node scripts/lab/report.mjs "${folders[@]}" | tee "$sweep/table.md"
echo "lab baseline: saved in $sweep"
