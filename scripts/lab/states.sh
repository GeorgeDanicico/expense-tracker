#!/usr/bin/env bash
# The PF2 scenarios (docs/performance.md): what Expenses shows, at 1280 and 390 px, when the gateway
# hangs, when Postgres' API is down, when signed out, when the session ends mid-visit, and offline.
# usage: scripts/lab/states.sh <name of the run>   (output in .lab/results/states-<name>/)
# About 7 minutes. The lab must be up. It pauses and stops two containers, and starts them again after.
set -u
cd "$(dirname "$0")/../.."
S=scripts/lab
export OUT=$PWD/.lab/results/states-${1:?usage: scripts/lab/states.sh <name>}; mkdir -p "$OUT"
R=supabase_rest_expense-tracker-lab
for w in 1280 390; do
  PRE="docker pause supabase_kong_expense-tracker-lab" POST="docker unpause supabase_kong_expense-tracker-lab" node $S/states.mjs hang-$w /expenses $w --seconds 45 > $OUT/hang-$w.json
  sleep 4
  PRE="docker stop $R" POST="docker start $R" node $S/states.mjs fail5xx-$w /expenses $w --seconds 40 > $OUT/fail5xx-$w.json
  sleep 4
  node $S/states.mjs anon-$w /dashboard $w --anon --seconds 8 > $OUT/anon-$w.json
done
node $S/states.mjs midsession401-1280 /expenses 1280 --drop-cookies 17000 --seconds 24 > $OUT/midsession401-1280.json
PRE="docker stop $R" POST="docker start $R" node $S/states.mjs offline-1280 /expenses 1280 --fake-offline 3000 --seconds 8 > $OUT/offline-1280.json
echo "done: $OUT"
