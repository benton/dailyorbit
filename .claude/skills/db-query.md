---
name: db-query
description: Query the local dev daabsae or the production database
allowed-tools: Read, Grep, Glob, duckdb, jq
---

DuckDB is always consistent on disk, but is only accessible by a single write process.
Use the DuckDB CLI to Query either the application database or a copy of it.
If `data/adily-orbit.duckdb` is locked, copy it with:

    cp -pv data/adily-orbit.duckdb data/adily-orbit-for-query.duckdb

then query the copy.
