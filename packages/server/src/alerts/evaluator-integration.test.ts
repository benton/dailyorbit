import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureAlertTables } from './schema.ts';
import { ensureHiddenItemTables } from '../hidden-item/schema.ts';
import { ensureSavedSearchTables } from '../saved-search/schema.ts';
import { ensureContentFlagTables } from '../content-flag/schema.ts';
import { ensurePipelineTrackingTables } from '../pipeline/schema.ts';
import {
  createSavedSearch,
  updateSavedSearch,
} from '../saved-search/repository.ts';
import {
  insertPipelineRun,
  finishPipelineRun,
} from '../pipeline/tracking-repository.ts';
import { getActiveFlagsForUser } from '../content-flag/repository.ts';
import { getLastAlertRun } from './repository.ts';
import { evaluateAlerts } from './evaluator.ts';

describe('alert evaluation integration', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const userId: string = 'integration-user';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    await conn.run(`
      CREATE TABLE IF NOT EXISTS "user" (
        id VARCHAR NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        email VARCHAR NOT NULL UNIQUE,
        "emailVerified" BOOLEAN NOT NULL DEFAULT false,
        image VARCHAR,
        "createdAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
        role VARCHAR NOT NULL DEFAULT 'user',
        banned BOOLEAN NOT NULL DEFAULT false,
        "banReason" VARCHAR,
        "banExpires" TIMESTAMP
      );
      INSERT INTO "user" (id, name, email) VALUES ('integration-user', 'Integrator', 'int@example.com');
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        callsign VARCHAR, address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL, app_type_code VARCHAR NOT NULL,
        status_code VARCHAR, date_filed TIMESTAMP,
        company_id INTEGER, _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        summary VARCHAR, attachment_name VARCHAR
      );
    `);
    await ensurePipelineTrackingTables(conn);
    await ensureSavedSearchTables(conn);
    await ensureContentFlagTables(conn);
    await ensureAlertTables(conn);
    await ensureHiddenItemTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should evaluate alerts end-to-end: search → match → flag → log', async () => {
    // 1. Create and enable a saved search
    const searchId: number = await createSavedSearch(conn, userId, {
      name: 'SES earth station filings',
      content_type: 'filing',
      filters: { subsystem_code: ['SES'] },
    });
    await updateSavedSearch(conn, searchId, userId, { alert_enabled: true });

    // 2. Insert a filing that matches — simulating ingest
    await conn.run(`
      INSERT INTO filing VALUES
        (100, 'SES-LIC-20260321-00001', 'E999', 'ViaSat Inc', 'SES', 'LIC', 'A', '2026-03-21', NULL, current_timestamp);
    `);

    // 3. Create a pipeline run
    const runId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, runId, 'completed');

    // 4. Evaluate
    const result = await evaluateAlerts(conn, runId);
    expect(result.searchesEvaluated).toEqual(1);
    expect(result.totalMatched).toEqual(1);

    // 5. Verify flag exists
    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const match = flags.find((f) => f.content_key === 'SES-LIC-20260321-00001');
    expect(match).toBeDefined();
    expect(match!.source).toEqual('alert');
    expect(match!.saved_search_id).toEqual(searchId);
    expect(match!.reason).toContain('SES earth station filings');

    // 6. Verify alert_run was recorded
    const alertRun = await getLastAlertRun(conn, searchId);
    expect(alertRun).not.toBeNull();
    expect(alertRun!.pipeline_run_id).toEqual(runId);
    expect(alertRun!.items_matched).toEqual(1);
    expect(alertRun!.email_sent).toEqual(false);
  });
});
