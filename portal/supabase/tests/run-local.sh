#!/usr/bin/env bash
# Runs the schema + RLS tests against a throwaway local Postgres (16+).
# Uses a stub of Supabase's auth schema (tests/local_auth_stub.sql).
# Final checks must also run against a real Supabase project (see docs/RLS-PLAN.md).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
[ -x "$PGBIN/initdb" ] || { echo "Postgres server binaries not found. Set PGBIN."; exit 1; }

TMP="$(mktemp -d)"
trap '"$PGBIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

if [ "$(id -u)" = "0" ]; then RUN=(runuser -u postgres --); chown -R postgres "$TMP"; else RUN=(); fi

"${RUN[@]}" "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust >/dev/null
"${RUN[@]}" "$PGBIN/pg_ctl" -D "$TMP/data" -o "-k $TMP -c listen_addresses=''" -l "$TMP/log" -w start >/dev/null

PSQL=("${RUN[@]}" psql -h "$TMP" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$HERE/local_auth_stub.sql"
for f in "$ROOT"/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
"${PSQL[@]}" -f "$ROOT/seed.sql"
"${PSQL[@]}" -c "select tests_ok from (select count(*) = 80 as tests_ok from public.institutions) s" -t | grep -q t \
  || { echo "Seed count wrong"; exit 1; }
"${PSQL[@]}" -f "$HERE/rls_tests.sql" 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //'
