#!/usr/bin/env bash
# applies supabase/schema.sql and every migration to a throwaway local postgres
# (docker) with supabase-like anon/authenticated roles, then runs the sql tests.
set -euo pipefail

cd "$(dirname "$0")/../.."
name="webstrafe-sqltest-$$"
docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.5
done
sleep 1

psql() { docker exec -i "$name" psql -v ON_ERROR_STOP=1 -q -U postgres "$@"; }

psql <<'SQL'
create role anon nologin;
create role authenticated nologin;
grant usage on schema public to anon, authenticated;
-- supabase grants these by default, rls is what actually guards the tables
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
SQL

psql < supabase/schema.sql
for f in supabase/migrations/*.sql; do
  echo "applying $f"
  psql < "$f"
  # migrations must be safe to run twice
  psql < "$f"
done
psql < supabase/tests/surf_runs.test.sql
