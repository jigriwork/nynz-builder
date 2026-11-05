#!/usr/bin/env bash
# Rehearses the resumable-builds migration on a disposable local PostgreSQL 17
# server with production-shaped builds and credits. Never touches a hosted database.
set -euo pipefail
PGBIN="${PGBIN:-$(brew --prefix postgresql@17 2>/dev/null)/bin}"
DIR="$(mktemp -d)"
PORT="${NYNZ_PG_PORT:-54331}"
trap '"$PGBIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$PGBIN/initdb" -D "$DIR" -U postgres --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT" -l "$DIR/log" -w start >/dev/null
"$PGBIN/createdb" -h localhost -p "$PORT" -U postgres nynz_rehearsal
NYNZ_REHEARSAL_PG_URL="postgres://postgres@localhost:$PORT/nynz_rehearsal" npx tsx tests/rehearsal/run-pg.ts
