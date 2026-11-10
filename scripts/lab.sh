#!/usr/bin/env bash
# The local performance lab (docs/lab.md): a throwaway Supabase stack on this machine, a fake family,
# and the app's production build pointed at them. It never talks to the live project.
#
#   scripts/lab.sh up [--jwt shared|asymmetric]   start the stack, replay the schema, build and start the app, seed
#   scripts/lab.sh app [--delay-ms N] [--no-build]  (re)build and (re)start the app against the lab
#   scripts/lab.sh delay <ms>                     change the delay between the app and Supabase (restarts the delay proxy)
#   scripts/lab.sh jwt shared|asymmetric          switch how Auth signs tokens (restarts Auth and the app)
#   scripts/lab.sh measure <page> [options]       scripts/lab/measure.mjs with the lab's files (see its --help)
#   scripts/lab.sh status                         what's running
#   scripts/lab.sh stop-app                       stop the app and the delay proxy
#   scripts/lab.sh down                           stop everything and delete the containers, volumes and lab files
#
# `npm run lab -- <command>` runs the same. Needs Docker, Node, jq and curl.
#
# Safety: the app and the seed get their Supabase address from .lab/app.env, which this script
# writes from the local stack. Before anything reads it, scripts/lab/guard.mjs refuses any address
# that isn't on this machine. The app is built and run from a copy of the checkout that has no .env
# file at all (checked before every build and start), with an empty environment plus that file
# (`env -i`), so the live project's .env.local can't reach it. After start-up the script also checks
# the app's own start-up line to prove it.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

readonly SUPABASE_CLI_VERSION=2.122.0
readonly PROJECT_ID=expense-tracker-lab
# The lab's files (env, accounts, logs, results). LAB_DIR is for the tests.
readonly LAB="${LAB_DIR:-.lab}"
readonly APP_PORT="${LAB_APP_PORT:-3110}"
readonly PROXY_PORT="${LAB_PROXY_PORT:-54400}"
readonly STACK_URL=http://127.0.0.1:54321
readonly DB_CONTAINER="supabase_db_${PROJECT_ID}"
readonly AUTH_CONTAINER="supabase_auth_${PROJECT_ID}"
readonly NETWORK="supabase_network_${PROJECT_ID}"
# Where the app is built and run: a copy of the checkout outside it, without any .env file.
readonly BUILD_DIR="${LAB_BUILD_DIR:-${TMPDIR:-/tmp}/expense-tracker-lab/app}"
# The app's command line, as a regex: `next start` renames its process to `next-server (vX)` once it runs.
readonly APP_PROCESS="next-server|next/dist/bin/next start"
# The Supabase CLI runs in its own folder inside .lab with a copy of scripts/lab/supabase-config.toml,
# so its state never lands in supabase/.temp (tracked) and no `supabase` command run in the repo
# itself ever sees the lab's config.
readonly CLI_DIR="$LAB/cli"
# Only Postgres, Auth, PostgREST, Kong and Storage run. Storage only because the avatars migration
# needs the storage.buckets table, which in the CLI's stack only the Storage service creates.
readonly EXCLUDED=imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor,realtime

say() { printf 'lab: %s\n' "$*"; }
usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }
die() { printf 'lab: %s\n' "$*" >&2; exit 1; }
supabase() {
  mkdir -p "$CLI_DIR/supabase"
  cp scripts/lab/supabase-config.toml "$CLI_DIR/supabase/config.toml"
  npx -y "supabase@${SUPABASE_CLI_VERSION}" --workdir "$CLI_DIR" "$@" 2> >(grep -v -e 'new version of Supabase CLI' -e 'We recommend updating' >&2)
}
need() { command -v "$1" >/dev/null || die "$1 is needed"; }
stack_running() { [[ -n "$(docker ps -q --filter "name=^${DB_CONTAINER}$")" ]]; }

# ---- processes we start, stopped only by their PID --------------------------------------------

# pid_alive <file> <part of its command line>: true when the PID in the file is running that command.
pid_alive() {
  local file=$1 expect=$2 pid
  [[ -f $file ]] || return 1
  pid=$(cat "$file")
  [[ $pid =~ ^[0-9]+$ ]] || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -qE -- "$expect"
}

# stop_pid <file> <part of its command line>: TERM, then KILL after 10 s. Never by name.
stop_pid() {
  local file=$1 expect=$2 pid
  if pid_alive "$file" "$expect"; then
    pid=$(cat "$file")
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      ps -p "$pid" >/dev/null 2>&1 || break
      sleep 0.5
    done
    if ps -p "$pid" >/dev/null 2>&1; then kill -9 "$pid" 2>/dev/null || true; fi
    say "stopped $expect (pid $pid)"
  fi
  rm -f "$file"
}

port_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# ---- the env file ------------------------------------------------------------------------------

# Writes .lab/app.env from the running stack. Local, well-known development keys only, but it's
# generated (and git-ignored) rather than committed so the secret scanner never sees a key shape.
write_env() {
  local status publishable secret
  status=$(supabase status -o env)
  publishable=$(printf '%s\n' "$status" | sed -n 's/^PUBLISHABLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
  secret=$(printf '%s\n' "$status" | sed -n 's/^SECRET_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
  [[ -n $publishable && -n $secret ]] || die "could not read the local stack's keys from 'supabase status'"
  umask 077
  cat > "$LAB/app.env" <<EOF
# Written by scripts/lab.sh from the local Supabase stack. Local development values only.
SUPABASE_URL=http://127.0.0.1:${PROXY_PORT}
SUPABASE_PUBLISHABLE_KEY=${publishable}
SUPABASE_SECRET_KEY=${secret}
SITE_URL=http://localhost:${APP_PORT}
FAMILY_ENABLED=true
LOG_LEVEL=info
# For the lab's own scripts only (the app never gets LAB_ variables): the stack without the delay proxy.
LAB_SUPABASE_DIRECT_URL=${STACK_URL}
LAB_DB_CONTAINER=${DB_CONTAINER}
EOF
}

guard() {
  [[ -f "$LAB/app.env" ]] || die "no $LAB/app.env: run 'scripts/lab.sh up' first"
  node scripts/lab/guard.mjs "$LAB/app.env"
}

# The app's environment: the env file without the lab's own LAB_ variables, as `env` arguments.
app_env_args() {
  local line
  while IFS= read -r line; do
    [[ -z $line || $line == \#* || $line == LAB_* ]] && continue
    printf '%s\n' "$line"
  done < "$LAB/app.env"
}

# ---- the stack ---------------------------------------------------------------------------------

replay_schema() {
  local migration
  sql() { docker exec -i "$DB_CONTAINER" psql -X -q -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
  if [[ "$(sql -At -c "select to_regclass('public.profiles') is not null")" == t ]]; then
    die "the lab database already has a schema; run 'scripts/lab.sh down' first"
  fi
  # The same route as scripts/test-database.sh: the legacy bootstrap, then every migration in order.
  sql < supabase/tests/support/legacy-bootstrap.sql > /dev/null 2> "$LAB/replay.err" || { cat "$LAB/replay.err" >&2; die "the legacy bootstrap failed"; }
  for migration in supabase/migrations/*.sql; do
    sql < "$migration" > /dev/null 2> "$LAB/replay.err" || { cat "$LAB/replay.err" >&2; die "replaying $migration failed"; }
  done
  rm -f "$LAB/replay.err"
  sql -c "notify pgrst, 'reload schema'" > /dev/null
  say "schema: legacy bootstrap and $(find supabase/migrations -name '*.sql' | wc -l | tr -d ' ') migrations replayed"
}

jwks_key_count() { curl -sf "$STACK_URL/auth/v1/.well-known/jwks.json" | jq '.keys | length'; }

# set_jwt_mode shared|asymmetric. The CLI's Auth signs with its own ES256 key (asymmetric). For
# "shared", the Auth container is re-created with the same settings minus GOTRUE_JWT_KEYS, so it
# signs with the shared secret (HS256) and its JWKS is empty, like the live project today.
set_jwt_mode() {
  local mode=$1 image keys=-1
  [[ $mode == shared || $mode == asymmetric ]] || die "--jwt is shared or asymmetric"
  if [[ ! -f "$LAB/auth-original.env" ]]; then
    umask 077
    docker inspect "$AUTH_CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -v -e '^PATH=' -e '^$' > "$LAB/auth-original.env"
    docker inspect "$AUTH_CONTAINER" --format '{{.Config.Image}}' > "$LAB/auth-image"
  fi
  image=$(cat "$LAB/auth-image")
  if [[ $mode == shared ]]; then
    grep -v '^GOTRUE_JWT_KEYS=' "$LAB/auth-original.env" > "$LAB/auth.env"
  else
    cp "$LAB/auth-original.env" "$LAB/auth.env"
  fi
  docker rm -f "$AUTH_CONTAINER" > /dev/null
  docker run -d --name "$AUTH_CONTAINER" --network "$NETWORK" --network-alias auth \
    --label "com.supabase.cli.project=${PROJECT_ID}" --label "com.docker.compose.project=${PROJECT_ID}" \
    --health-cmd 'wget --no-verbose --tries=1 --spider http://127.0.0.1:9999/health' --health-interval 2s \
    --env-file "$LAB/auth.env" "$image" auth > /dev/null
  for _ in $(seq 1 60); do
    keys=$(jwks_key_count 2>/dev/null) && break
    sleep 1
  done
  if [[ $mode == shared && $keys != 0 ]]; then die "Auth still publishes $keys signing keys; expected none in shared mode"; fi
  if [[ $mode == asymmetric && ! $keys -ge 1 ]]; then die "Auth publishes no signing key; expected one in asymmetric mode"; fi
  printf '%s\n' "$mode" > "$LAB/jwt-mode"
  say "JWT signing: $mode (JWKS lists $keys key(s))"
}

# ---- the app -----------------------------------------------------------------------------------

# Copies the checkout (working tree, uncommitted changes included) to $BUILD_DIR without .env files,
# git, build output, docs or local scratch (not the same list as .dockerignore: rsync can't read its
# `!` lines), links node_modules, and builds there.
build_app() {
  local root=$PWD
  say "building the app in $BUILD_DIR (a copy without any .env file; next build --webpack)"
  mkdir -p "$BUILD_DIR"
  rsync -a --delete --exclude '/node_modules' --exclude '/.next' --exclude '/.git' --exclude '.env*' --exclude '/.lab' \
    --exclude '/.claude' --exclude '/tmp' --exclude '/dist' --exclude '/eval-results' --exclude '/docs' --exclude '/coverage' \
    --exclude '*.tsbuildinfo' --exclude '/next-env.d.ts' ./ "$BUILD_DIR/"
  ln -sfn "$root/node_modules" "$BUILD_DIR/node_modules"
  no_env_files
  (cd "$BUILD_DIR" && env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build --webpack) \
    > "$LAB/build.log" 2>&1 || { tail -30 "$LAB/build.log" >&2; die "build failed"; }
  if grep -q 'Environments:' "$LAB/build.log"; then die "the build loaded an .env file; refusing to run it against the lab"; fi
  printf '%s%s\n' "$(git rev-parse --short HEAD)" "$(git diff --quiet HEAD -- . ':!docs' 2>/dev/null || echo '+changes')" > "$LAB/build-commit"
}

start_proxy() {
  local delay=$1
  [[ $delay =~ ^[0-9]+$ ]] || die "the delay is a whole number of milliseconds"
  stop_pid "$LAB/proxy.pid" supabase-proxy.mjs
  port_free "$PROXY_PORT" || die "port $PROXY_PORT is in use"
  node scripts/lab/supabase-proxy.mjs --port "$PROXY_PORT" --target "$STACK_URL" --delay-ms "$delay" --log "$LAB/supabase-calls.jsonl" \
    >> "$LAB/proxy.log" 2>&1 &
  echo $! > "$LAB/proxy.pid"
  for _ in $(seq 1 50); do
    curl -s -o /dev/null "http://127.0.0.1:${PROXY_PORT}/" && break
    sleep 0.1
  done
  pid_alive "$LAB/proxy.pid" supabase-proxy.mjs || { cat "$LAB/proxy.log" >&2; die "the delay proxy did not start"; }
  printf '%s\n' "$delay" > "$LAB/delay-ms"
  say "delay proxy on 127.0.0.1:${PROXY_PORT}: +${delay} ms per Supabase call"
}

# next build and next start read .env* from the folder they run in: the build copy must have none.
no_env_files() {
  if find "$BUILD_DIR" -maxdepth 1 -name '.env*' | grep -q .; then die "the build copy has an .env file; refusing to run it against the lab"; fi
}

start_app() {
  local args=() line
  guard
  no_env_files
  stop_pid "$LAB/app.pid" "$APP_PROCESS"
  port_free "$APP_PORT" || die "port $APP_PORT is in use"
  while IFS= read -r line; do args+=("$line"); done < <(app_env_args)
  # The app's whole environment, by name (and its Supabase address), for the record.
  { printf '%s\n' PATH HOME NODE_ENV NEXT_TELEMETRY_DISABLED; printf '%s\n' "${args[@]%%=*}"; grep '^SUPABASE_URL=' "$LAB/app.env"; } > "$LAB/app-environment"
  : > "$LAB/app.log"
  (cd "$BUILD_DIR" && exec env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 "${args[@]}" \
    node node_modules/next/dist/bin/next start -p "$APP_PORT" -H 127.0.0.1) >> "$LAB/app.log" 2>&1 &
  echo $! > "$LAB/app.pid"
  for _ in $(seq 1 100); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${APP_PORT}/health")" == 200 ]] && break
    sleep 0.2
  done
  pid_alive "$LAB/app.pid" "$APP_PROCESS" || { tail -20 "$LAB/app.log" >&2; die "the app did not start"; }
  # A second proof, from the app itself, that .env.local wasn't loaded: it sets the AI and
  # price-service variables, and the app's start-up line (env_optional_off) must say both are off.
  if ! grep '"event":"env_optional_off"' "$LAB/app.log" | grep -q 'AI (AI_PROVIDER' \
    || ! grep '"event":"env_optional_off"' "$LAB/app.log" | grep -q 'PRICE_SERVICE_URL'; then
    stop_pid "$LAB/app.pid" "$APP_PROCESS"
    die "the app's start-up line doesn't show AI and prices off: it may have loaded .env.local; stopped it"
  fi
  say "app on http://localhost:${APP_PORT} (pid $(cat "$LAB/app.pid"), build $(cat "$LAB/build-commit" 2>/dev/null || echo '?'))"
}

# ---- commands ----------------------------------------------------------------------------------

cmd_up() {
  local mode=shared
  while (($# > 0)); do
    case "$1" in
      --jwt) mode="${2:?--jwt needs shared or asymmetric}"; shift 2 ;;
      *) die "unknown option $1" ;;
    esac
  done
  need docker; need jq; need curl; need node
  mkdir -p "$LAB"
  if stack_running && [[ -f "$LAB/users.json" ]]; then
    say "the lab is already up and seeded; 'scripts/lab.sh down' first for a fresh one"
    cmd_status
    return
  fi
  if stack_running; then
    say "a half-made lab is running; removing it first"
    cmd_down
    mkdir -p "$LAB"
  fi
  say "starting Supabase (CLI ${SUPABASE_CLI_VERSION}): Postgres, Auth, PostgREST, Kong, Storage"
  supabase start -x "$EXCLUDED" > "$LAB/supabase-start.log" || { tail -20 "$LAB/supabase-start.log" >&2; die "supabase start failed"; }
  write_env
  guard
  set_jwt_mode "$mode"
  replay_schema
  build_app
  start_proxy 0
  start_app
  say "seeding"
  env -i PATH="$PATH" HOME="$HOME" node scripts/lab/seed.mjs "$LAB/app.env" "$LAB/users.json"
  say "up: sign-in names and passwords are in $LAB/users.json; measure with 'npm run lab:measure -- /dashboard'"
}

cmd_app() {
  local delay build=1
  delay=$(cat "$LAB/delay-ms" 2>/dev/null || echo 0)
  while (($# > 0)); do
    case "$1" in
      --delay-ms) delay="${2:?--delay-ms needs a number}"; shift 2 ;;
      --no-build) build=0; shift ;;
      *) die "unknown option $1" ;;
    esac
  done
  guard
  stack_running || die "the stack isn't running: 'scripts/lab.sh up' first"
  stop_pid "$LAB/app.pid" "$APP_PROCESS"
  if ((build)) || [[ ! -f "$BUILD_DIR/.next/BUILD_ID" ]]; then build_app; fi
  start_proxy "$delay"
  start_app
}

cmd_delay() {
  [[ $# -eq 1 ]] || die "usage: scripts/lab.sh delay <ms>"
  start_proxy "$1"
}

cmd_jwt() {
  [[ $# -eq 1 ]] || die "usage: scripts/lab.sh jwt shared|asymmetric"
  stack_running || die "the stack isn't running"
  set_jwt_mode "$1"
  # The app caches the JWKS for 10 minutes; restart it so a run starts from what a fresh server sees.
  if pid_alive "$LAB/app.pid" "$APP_PROCESS"; then start_app; fi
}

cmd_stop_app() {
  stop_pid "$LAB/app.pid" "$APP_PROCESS"
  stop_pid "$LAB/proxy.pid" supabase-proxy.mjs
}

cmd_status() {
  if stack_running; then
    say "stack: up ($(docker ps --filter "label=com.supabase.cli.project=${PROJECT_ID}" --format '{{.Names}}' | sed "s/_${PROJECT_ID}//; s/supabase_//" | sort | tr '\n' ' '))"
    say "JWT signing: $(cat "$LAB/jwt-mode" 2>/dev/null || echo unknown); JWKS lists $(jwks_key_count 2>/dev/null || echo '?') key(s)"
  else
    say "stack: down"
  fi
  if pid_alive "$LAB/app.pid" "$APP_PROCESS"; then say "app: http://localhost:${APP_PORT} (pid $(cat "$LAB/app.pid"), build $(cat "$LAB/build-commit" 2>/dev/null || echo '?'))"; else say "app: stopped"; fi
  if pid_alive "$LAB/proxy.pid" supabase-proxy.mjs; then say "delay proxy: +$(cat "$LAB/delay-ms") ms (pid $(cat "$LAB/proxy.pid"))"; else say "delay proxy: stopped"; fi
  if [[ -f "$LAB/users.json" ]]; then say "seeded on $(jq -r .today "$LAB/users.json")"; fi
}

cmd_down() {
  cmd_stop_app
  if docker ps -aq --filter "label=com.supabase.cli.project=${PROJECT_ID}" | grep -q .; then
    supabase stop --no-backup --project-id "$PROJECT_ID" > /dev/null || true
  fi
  # Anything the CLI left (the re-created Auth container included), by the project's label.
  docker ps -aq --filter "label=com.supabase.cli.project=${PROJECT_ID}" | xargs docker rm -f > /dev/null 2>&1 || true
  docker volume ls -q --filter "label=com.supabase.cli.project=${PROJECT_ID}" | xargs docker volume rm > /dev/null 2>&1 || true
  docker network rm "$NETWORK" > /dev/null 2>&1 || true
  # The lab's files, except measurement results.
  if [[ -d $LAB ]]; then find "$LAB" -mindepth 1 -maxdepth 1 ! -name results -exec rm -rf {} +; fi
  rm -rf "$BUILD_DIR"
  rmdir "$(dirname "$BUILD_DIR")" 2>/dev/null || true
  if docker ps -aq --filter "label=com.supabase.cli.project=${PROJECT_ID}" | grep -q . \
    || docker volume ls -q --filter "label=com.supabase.cli.project=${PROJECT_ID}" | grep -q .; then
    die "something of the lab is still there: docker ps -a / docker volume ls"
  fi
  say "down: containers, volumes, network and lab files removed (results in $LAB/results kept)"
}

cmd_measure() {
  guard
  pid_alive "$LAB/app.pid" "$APP_PROCESS" || die "the app isn't running: 'scripts/lab.sh app' first"
  node scripts/lab/measure.mjs "$@"
}

command=${1:-}
[[ -n $command ]] || { usage; exit 2; }
shift
case "$command" in
  up) cmd_up "$@" ;;
  app) cmd_app "$@" ;;
  delay) cmd_delay "$@" ;;
  jwt) cmd_jwt "$@" ;;
  measure) cmd_measure "$@" ;;
  status) cmd_status ;;
  stop-app) cmd_stop_app ;;
  down) cmd_down ;;
  guard) guard ;;
  -h | --help | help) usage ;;
  *) die "unknown command $command (up, app, delay, jwt, measure, status, stop-app, down)" ;;
esac
