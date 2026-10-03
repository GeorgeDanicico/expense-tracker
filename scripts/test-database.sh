#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

# No host port, connection string, or live credentials: this runner can only
# touch its own disposable container. Supabase's image includes pgTAP.
test_container="expense-tracker-sql-test-$$"
test_image="${EXPENSE_TEST_POSTGRES_IMAGE:-supabase/postgres:17.4.1.054}"
trap 'docker rm -f "$test_container" >/dev/null 2>&1 || true' EXIT
docker run --name "$test_container" -e POSTGRES_PASSWORD=rehearsal-only -d "$test_image" >/dev/null
for ((attempt=0; attempt<60; attempt++)); do
  if docker exec "$test_container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
sql() { docker exec -i -e PGPASSWORD=rehearsal-only "$test_container" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
sql < supabase/tests/support/legacy-bootstrap.sql >/dev/null
for migration in supabase/migrations/*.sql; do
  echo "Replay $migration"
  sql < "$migration" >/dev/null
done
for test_file in supabase/tests/*.sql; do
  echo "Test $test_file"
  test_output="$(sql -At < "$test_file")"
  echo "$test_output"
  if echo "$test_output" | rg -q '^not ok|^# (Looks like|No tests run)|^Bail out!'; then exit 1; fi
done
