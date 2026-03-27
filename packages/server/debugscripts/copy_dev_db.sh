#!/usr/bin/env bash
# Copies the dev database so you can query it while the API server holds a lock.
# Run from the repo root.
set -euo pipefail

SRC="data/daily-orbit.duckdb"
DST="data/daily-orbit-for-querying.duckdb"

if [ ! -f "$SRC" ]; then
  echo "Error: $SRC not found. Run from the repo root." >&2
  exit 1
fi

cp -pv "$SRC" "$DST"
echo "Done. Query with: duckdb $DST"
