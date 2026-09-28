#!/usr/bin/env bash
# applies supabase/schema.sql and every migration to a throwaway local postgres
# (docker) with supabase-like anon/authenticated roles, then runs the sql tests.
# with --e2e it also starts postgrest and drives the real SurfBoards client.
set -euo pipefail

cd "$(dirname "$0")/../.."
e2e=0
[[ "${1:-}" == "--e2e" ]] && e2e=1
tag="webstrafe-sqltest-$$"
jwt_secret="webstrafe-local-test-secret-0123456789abcdef"
docker network create "$tag" >/dev/null
cleanup() {
  docker rm -f "$tag-pg" "$tag-rest" >/dev/null 2>&1 || true
  docker network rm "$tag" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker run -d --rm --name "$tag-pg" --network "$tag" --network-alias pg -e POSTGRES_PASSWORD=test postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$tag-pg" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 0.5
done
sleep 1

psql() { docker exec -i "$tag-pg" psql -v ON_ERROR_STOP=1 -q -U postgres "$@"; }

psql <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role authenticator login noinherit password 'test';
grant anon, authenticated to authenticator;
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

if [[ $e2e -eq 1 ]]; then
  psql -c "insert into public.webstrafe_map_rules (map_id, stages, min_time_ms, min_stage_ms) values ('e2e_map', '{2}', 1000, '{500,500}');"
  docker run -d --rm --name "$tag-rest" --network "$tag" -p 127.0.0.1:54330:3000 \
    -e PGRST_DB_URI="postgres://authenticator:test@pg:5432/postgres" \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
    -e PGRST_JWT_SECRET="$jwt_secret" postgrest/postgrest:v12.2.3 >/dev/null
  for _ in $(seq 1 60); do
    if curl -sf http://127.0.0.1:54330/ >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
  BOARDS_URL=http://127.0.0.1:54330 BOARDS_JWT_SECRET="$jwt_secret" npx tsx tools/surf/boards-e2e.ts
fi
