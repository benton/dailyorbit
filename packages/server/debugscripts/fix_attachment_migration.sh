#!/usr/bin/bash
# Fix: drop FTS index on attachment table, rename local_path -> storage_key,
# strip path prefixes, then let the app recreate FTS on next startup/pipeline run.
# Run via: ./run_in_prod.sh fix_attachment_migration.sh
set -eox pipefail

echo "=== Attachment migration fix: $(date -u) ==="

echo "--- Stopping service ---"
sudo systemctl stop daily-orbit.service

echo "--- Backing up DB ---"
sudo cp -pv /data/daily-orbit.duckdb /data/daily-orbit.duckdb.bak

echo "--- Running migration ---"
sudo duckdb /data/daily-orbit.duckdb <<'SQL'
-- Check current state
SELECT column_name FROM information_schema.columns
WHERE table_name = 'attachment' AND column_name IN ('local_path', 'storage_key');

-- Drop FTS index that blocks ALTER TABLE
INSTALL fts;
LOAD fts;
PRAGMA drop_fts_index('attachment');

-- Drop the regular index too
DROP INDEX IF EXISTS idx_attachment_text_checksum;

-- Rename the column
ALTER TABLE attachment RENAME COLUMN local_path TO storage_key;

-- Strip absolute/relative data/attachments/ prefix to make values relative keys
UPDATE attachment
SET storage_key = regexp_replace(storage_key, '^(.*?/)?data/attachments/', '')
WHERE storage_key IS NOT NULL AND storage_key LIKE '%data/attachments/%';

-- Recreate index
CREATE INDEX idx_attachment_text_checksum ON attachment(text_checksum);

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_name = 'attachment' AND column_name IN ('local_path', 'storage_key');

SELECT count(*) AS total_rows, count(storage_key) AS has_storage_key FROM attachment;
SQL

echo "--- Starting service ---"
sudo systemctl start daily-orbit.service
sleep 5
sudo systemctl is-active daily-orbit.service && echo "Service is RUNNING" || echo "Service FAILED"

echo "--- Cleanup ---"
sudo rm -f /data/debug.duckdb
