#!/usr/bin/env bash
# Starts a disposable local PostgreSQL server and runs the multi-connection tests against it.
set -euo pipefail
DIR="$(mktemp -d)"
PORT="${NYNZ_PG_PORT:-54329}"
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
initdb -D "$DIR" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DIR" -o "-p $PORT -c max_connections=200" -l "$DIR/log" -w start >/dev/null
createdb -h localhost -p "$PORT" -U postgres nynz_concurrency
NYNZ_PG_URL="postgres://postgres@localhost:$PORT/nynz_concurrency" npx vitest run tests/concurrency
