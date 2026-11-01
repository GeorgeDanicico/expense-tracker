#!/usr/bin/env bash
# Looks for secrets in build output that the browser (or a registry reader) can download.
#
#   scripts/scan-build-secrets.sh                      scan .next/static, the browser bundle
#   scripts/scan-build-secrets.sh DIR [DIR...]         scan the given browser-facing folders
#   scripts/scan-build-secrets.sh --server DIR [...]   scan a whole server tree, such as the files
#                                                      copied out of the image (see the image job in ci.yml)
#   scripts/scan-build-secrets.sh --self-test          check that the patterns catch planted fakes
#
# Exit codes: 0 clean, 1 a secret pattern was found, 2 misuse or nothing to scan.
#
# It NEVER prints a matched value: only the file and the name of the pattern. It uses `grep -l`
# (file names only) and never `grep -o` or a plain `grep`, so a leaked key can't reach CI logs.
#
# Patterns, each kept specific so library code doesn't trip it:
#
#   supabase-secret-key      sb_secret_ followed by 20+ key characters. The placeholders in
#                            .env.example and CI (sb_secret_your_key, sb_secret_ci_placeholder)
#                            are shorter and don't match.
#   private-key-pem          A PEM private key header (RSA, EC, OpenSSH or plain PRIVATE KEY).
#   openai-key               sk- followed by 32+ key characters (covers sk-proj-, sk-svcacct-),
#                            after a character that can't be part of a word, so "task-..." or
#                            "risk-..." in minified code don't match.
#   openai-key-marker        The T3BlbkFJ marker ("OpenAI" in base64) inside a long token, which
#                            every classic OpenAI key carries.
#   app-token                sl_mcp_ or sl_cal_ followed by exactly 43 base64url characters: this
#                            app's MCP access tokens and calendar feed tokens. The bare prefix
#                            appears in client code on purpose, only a whole token matches.
#   secret-assignment        A name that says "secret", "token", "password", "private key" or
#                            "api key" assigned a quoted base64url string of 40+ characters.
#   secret-env-name          (browser folders only) the name of a server-only variable:
#                            SUPABASE_SECRET_KEY, VAPID_PRIVATE or OPENAI_API_KEY. The name has no
#                            business in client code, because it means server configuration code
#                            was bundled. Skipped with --server, where the server reads them.
#   secret-env-value         The actual value of a server-only environment variable that is set
#                            while the script runs (SUPABASE_SECRET_KEY, VAPID_PRIVATE_KEY,
#                            OPENAI_API_KEY), found anywhere in the scanned files. In CI these hold placeholders, so a build that
#                            inlined them is caught. The value is read from the environment, passed
#                            to grep through a file descriptor and never printed. Values shorter than
#                            8 characters or spanning several lines are skipped.
#   env-or-key-file          (--server only) a file named .env*, *.pem, *.key or id_rsa* in the tree.
#                            .env.example is allowed.
#
# Not covered: a secret with no recognisable shape and no name next to it, and secrets in images
# (the --server mode reads text files only). gitleaks (the "secrets" CI job) covers the source.

set -euo pipefail
export LC_ALL=C

NAMES=(
  supabase-secret-key
  private-key-pem
  openai-key
  openai-key-marker
  app-token
  secret-assignment
)
REGEXES=(
  'sb_secret_[A-Za-z0-9_-]{20,}'
  '-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----'
  '(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{32,}'
  '[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}'
  'sl_(mcp|cal)_[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)'
  '(secret|token|password|passwd|private_?key|api_?key|apikey)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_-]{40,}["'"'"']'
)
# Case-insensitive patterns (the assignment names are written in any case).
INSENSITIVE=(0 0 0 0 0 1)

# Browser folders only: names of server-only variables.
NAME_PATTERNS=(
  'SUPABASE_SECRET_KEY'
  'VAPID_PRIVATE'
  'OPENAI_API_KEY'
)
# Server-only variables whose value must not appear in the output.
SECRET_ENV_VARS=(SUPABASE_SECRET_KEY VAPID_PRIVATE_KEY OPENAI_API_KEY)

mode=browser
dirs=()

scan() {
  local found=0 file i name

  for dir in "${dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      echo "scan-build-secrets: $dir is not a folder" >&2
      return 2
    fi
  done
  local count
  count=$(find "${dirs[@]}" -type f | wc -l | tr -d ' ')
  if [[ "$count" -eq 0 ]]; then
    echo "scan-build-secrets: no files in ${dirs[*]}; did the build run?" >&2
    return 2
  fi

  for i in "${!NAMES[@]}"; do
    local flags=(-rIlE)
    [[ "${INSENSITIVE[$i]}" == 1 ]] && flags=(-rIliE)
    while IFS= read -r file; do
      echo "FOUND: $file matches pattern ${NAMES[$i]}"
      found=1
    done < <(grep "${flags[@]}" -e "${REGEXES[$i]}" "${dirs[@]}" || true)
  done

  if [[ "$mode" == browser ]]; then
    for name in "${NAME_PATTERNS[@]}"; do
      while IFS= read -r file; do
        echo "FOUND: $file matches pattern secret-env-name ($name)"
        found=1
      done < <(grep -rIlF -e "$name" "${dirs[@]}" || true)
    done
  else
    while IFS= read -r file; do
      echo "FOUND: $file is a key or environment file (env-or-key-file)"
      found=1
    done < <(find "${dirs[@]}" -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o -name 'id_rsa*' \) ! -name '.env.example' || true)
  fi

  local var value
  for var in "${SECRET_ENV_VARS[@]}"; do
    value="${!var:-}"
    [[ ${#value} -ge 8 && "$value" != *$'\n'* ]] || continue
    while IFS= read -r file; do
      echo "FOUND: $file holds the value of \$$var (secret-env-value)"
      found=1
    done < <(grep -rIlF -f <(printf '%s\n' "$value") "${dirs[@]}" || true)
  done

  if [[ "$found" -eq 1 ]]; then
    echo "scan-build-secrets: secret patterns found (values are never printed)" >&2
    return 1
  fi
  echo "scan-build-secrets: $count files scanned in ${dirs[*]}, no secret patterns found"
}

# Plants fake secrets, built at run time so this file holds none, and checks each is found and that
# no output contains the value.
self_test() {
  local tmp out status failures=0
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN
  local b43 b45 b20
  b43=$(printf 'Ab%.0s' {1..21})A
  b45=$(printf 'Ab%.0s' {1..22})A
  b20=$(printf 'Zq%.0s' {1..10})

  expect() { # expect <label> <file content> <pattern name expected, or "clean">
    local label=$1 content=$2 want=$3
    rm -rf "$tmp/t" && mkdir "$tmp/t"
    printf '%s\n' "$content" >"$tmp/t/chunk.js"
    status=0
    out=$(env -u SUPABASE_SECRET_KEY -u VAPID_PRIVATE_KEY -u OPENAI_API_KEY bash "$0" "$tmp/t" 2>&1) || status=$?
    if [[ "$want" == clean ]]; then
      [[ $status -eq 0 ]] || { echo "self-test FAILED: $label should be clean"; failures=1; }
    else
      [[ $status -eq 1 && "$out" == *"$want"* ]] || { echo "self-test FAILED: $label should match $want"; failures=1; }
    fi
    # Nothing printed may repeat a planted value.
    for v in "$b43" "$b45" "$b20"; do
      [[ "$out" != *"$v"* ]] || { echo "self-test FAILED: $label printed a value"; failures=1; }
    done
  }

  expect "supabase key" "var a=\"sb_secret_${b43}\"" supabase-secret-key
  expect "supabase placeholder" "var a=\"sb_secret_ci_placeholder\"" clean
  # The header is assembled here so this file holds no key header for a scanner to find.
  local pem="-----BEGIN"
  expect "PEM key" "x='${pem} PRIVATE KEY-----'" private-key-pem
  expect "RSA PEM key" "x='${pem} RSA PRIVATE KEY-----'" private-key-pem
  expect "openai key" "k=\"sk-proj-${b45}${b20}\"" openai-key
  expect "openai marker" "k=\"${b20}T3BlbkFJ${b20}\"" openai-key-marker
  expect "app token" "t=\"sl_mcp_${b43}\"" app-token
  expect "calendar token" "t=\"sl_cal_${b43}\"" app-token
  expect "bare token prefix" "if(t.startsWith(\"sl_mcp_\")){}" clean
  expect "word ending in sk-" "class=\"task-${b45}\" id=\"risk-${b45}\"" clean
  expect "named secret" "var o={apiKey:\"${b45}${b20}\"}" secret-assignment
  expect "server variable name" "process.env.SUPABASE_SECRET_KEY" secret-env-name
  expect "VAPID variable name" "process.env.VAPID_PRIVATE_KEY" secret-env-name
  expect "ordinary bundle" 'function a(){return fetch("/api/expenses",{headers:{authorization:token}})}' clean

  # A server variable's value found in the files, caught through the environment.
  rm -rf "$tmp/t" && mkdir "$tmp/t"
  printf '%s\n' "var a=\"${b20}-placeholder\"" >"$tmp/t/chunk.js"
  status=0
  out=$(SUPABASE_SECRET_KEY="${b20}-placeholder" bash "$0" "$tmp/t" 2>&1) || status=$?
  [[ $status -eq 1 && "$out" == *secret-env-value* ]] || { echo "self-test FAILED: env value should match"; failures=1; }
  [[ "$out" != *"$b20"* ]] || { echo "self-test FAILED: env value was printed"; failures=1; }

  # Server mode allows variable names, but not key files or planted values.
  rm -rf "$tmp/t" && mkdir "$tmp/t"
  printf '%s\n' 'const k = process.env.SUPABASE_SECRET_KEY' >"$tmp/t/server.js"
  status=0
  bash "$0" --server "$tmp/t" >/dev/null 2>&1 || status=$?
  [[ $status -eq 0 ]] || { echo "self-test FAILED: --server should allow variable names"; failures=1; }
  : >"$tmp/t/.env.production"
  status=0
  out=$(bash "$0" --server "$tmp/t" 2>&1) || status=$?
  [[ $status -eq 1 && "$out" == *env-or-key-file* ]] || { echo "self-test FAILED: --server should flag .env files"; failures=1; }

  # An empty folder is an error, not a pass.
  rm -rf "$tmp/t" && mkdir "$tmp/t"
  status=0
  bash "$0" "$tmp/t" >/dev/null 2>&1 || status=$?
  [[ $status -eq 2 ]] || { echo "self-test FAILED: an empty folder should exit 2"; failures=1; }

  if [[ $failures -eq 0 ]]; then
    echo "scan-build-secrets: self-test passed"
  fi
  return $failures
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --self-test) self_test; exit $? ;;
    --server) mode=server; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "scan-build-secrets: unknown option $1" >&2; exit 2 ;;
    *) dirs+=("$1"); shift ;;
  esac
done

if [[ ${#dirs[@]} -eq 0 ]]; then
  dirs=(.next/static)
fi

status=0
scan || status=$?
exit "$status"
