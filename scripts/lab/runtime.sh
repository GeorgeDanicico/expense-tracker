#!/usr/bin/env bash
# What the production image costs in memory, against the lab (docs/performance.md, PF12). The image runs
# with the flags scripts/deploy.sh gives the web and the worker container, on the lab's Supabase, with
# nothing from .env.local: its env file has the lab's keys and a loopback address only (checked with
# scripts/lab/guard.mjs). It shares the network namespace of the lab's gateway container, so
# 127.0.0.1:8000 inside it is the lab's Supabase.
#
#   scripts/lab.sh up                                   the lab (it can be stopped with `scripts/lab.sh stop-app`)
#   docker build --build-arg GIT_SHA=local -t expense-tracker:pf12 .
#   scripts/lab/runtime.sh web expense-tracker:pf12 [-e NODE_OPTIONS=--max-old-space-size=300]
#   scripts/lab/runtime.sh load expense-tracker:pf12    4,800 requests, 8 at a time; the peak memory
#   scripts/lab/runtime.sh worker expense-tracker:pf12 [-e NODE_OPTIONS=…]   a worker for 4 minutes (8 ticks)
#   scripts/lab/runtime.sh heap <memory limit> <image> [-e NODE_OPTIONS=…]  the heap limit Node picks in a container of that size
#
# `web` prints the memory after start, after the first request and after every page, the first
# requests' times and the heap limit. To compare `experimental.preloadEntriesOnStart`, run it on two
# images (the setting is `"preloadEntriesOnStart":true` in the image's server.js). Everything it
# starts is removed at the end. Memory is `docker stats` (what Obsy shows), VmRSS (the process) and,
# for `load`, the container's cgroup `memory.peak`.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

readonly LAB=.lab
readonly KONG=supabase_kong_expense-tracker-lab
readonly NODE_IMAGE=node:24-bookworm-slim@sha256:01d566e8d94d8c619591d78652babfccd3c6992a3dffa9ed5ab39e11cf6c70e9
readonly NAME=pf12-runtime-test
ENV_FILE="$(mktemp)"
readonly ENV_FILE
trap 'rm -f "$ENV_FILE"; docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

die() { echo "runtime.sh: $*" >&2; exit 1; }

[[ -f $LAB/app.env && -f $LAB/users.json ]] || die "the lab is not up: run scripts/lab.sh up"
[[ -n "$(docker ps -q --filter "name=^${KONG}$")" ]] || die "the lab's gateway container is not running"
{
  grep -E '^(SUPABASE_PUBLISHABLE_KEY|SUPABASE_SECRET_KEY)=' "$LAB/app.env"
  printf '%s\n' SUPABASE_URL=http://127.0.0.1:8000 SITE_URL=http://127.0.0.1:3000 FAMILY_ENABLED=true LOG_LEVEL=info
} > "$ENV_FILE"
node scripts/lab/guard.mjs "$ENV_FILE"

# The container, with the flags of scripts/deploy.sh's set_hardening_flags. EXTRA is what the caller
# passed after the image (for example `-e NODE_OPTIONS=…`); the rest is the command to run.
EXTRA=()
start() { # <memory> <image> [command…]
  local memory=$1 image=$2
  shift 2
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" --network "container:$KONG" --env-file "$ENV_FILE" \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
    --tmpfs /app/.next/cache:rw,noexec,nosuid,nodev,uid=1000,gid=1000,size=128m \
    --security-opt no-new-privileges --cap-drop ALL --memory "$memory" --memory-swap "$memory" \
    --log-opt max-size=5m --log-opt max-file=2 ${EXTRA[@]+"${EXTRA[@]}"} "$image" "$@" > /dev/null
}
driver() { # <phase>
  docker run --rm --network "container:$NAME" -v "$PWD/scripts/lab/runtime-driver.mjs:/driver.mjs:ro" \
    -v "$PWD/$LAB/users.json:/data/users.json:ro" --cap-drop ALL --entrypoint node "$NODE_IMAGE" /driver.mjs "$1"
}
used() { docker stats --no-stream --format '{{.MemUsage}}' "$NAME" | cut -d/ -f1; }
rss() { docker exec "$NAME" sh -c 'grep -E "^(VmRSS|VmHWM)" /proc/1/status | tr -s " \n" " "'; }
readonly HEAP_JS="console.log(Math.round(require('v8').getHeapStatistics().heap_size_limit / 2 ** 20))"
heap() { docker exec "$NAME" node -e "$HEAP_JS"; }
state() { docker inspect -f 'restarts={{.RestartCount}} oom={{.State.OOMKilled}}' "$NAME"; }

parse_image() { # <image> [extra docker args…]
  image=${1:?image}
  shift
  EXTRA=("$@")
}

mode=${1:?web, load, worker or heap}
shift
case $mode in
  web)
    parse_image "$@"
    start 768m "$image"
    echo "health: $(driver health)"
    sleep 10
    echo "after start (10 s): $(used) | $(rss)"
    echo "first: $(driver first)"
    sleep 2
    echo "after the first request: $(used) | $(rss)"
    echo "visit: $(driver visit)"
    sleep 5
    echo "after every page (5 s later): $(used) | $(rss) | heap limit: $(heap) MB"
    state
    ;;
  load)
    parse_image "$@"
    start 768m "$image"
    driver health > /dev/null
    sleep 5
    echo "before: $(used)"
    echo "load: $(driver load)"
    sleep 3
    echo "after: $(used) | $(rss)"
    echo "cgroup memory.peak: $(docker exec "$NAME" cat /sys/fs/cgroup/memory.peak | awk '{ printf "%.0f MiB", $1 / 1048576 }')"
    state
    ;;
  worker)
    parse_image "$@"
    start 256m "$image" node worker.js
    for wait in 10 60 60 60 60; do
      sleep "$wait"
      echo "$(used) | $(rss) | $(state)"
    done
    echo "heap limit: $(heap) MB"
    ;;
  heap)
    limit=${1:?memory limit, for example 256m}
    image=${2:?image}
    shift 2
    docker run --rm --memory "$limit" --memory-swap "$limit" "$@" --entrypoint node "$image" \
      -e "$HEAP_JS"
    ;;
  *) die "unknown mode: $mode" ;;
esac
