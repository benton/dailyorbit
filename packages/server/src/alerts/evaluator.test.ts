import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureAlertTables } from './schema.ts';
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
import { evaluateAlerts } from './evaluator.ts';

describe('alert evaluator', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const userId: string = 'test-user-001';

  beforeAll(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);

    // Create required tables
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
      INSERT INTO "user" (id, name, email) VALUES ('test-user-001', 'Test', 'test@example.com');
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        callsign VARCHAR,
        address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL,
        app_type_code VARCHAR NOT NULL,
        status_code VARCHAR,
        date_filed TIMESTAMP,
        company_id INTEGER,
        _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY,
        name VARCHAR NOT NULL,
        parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        summary VARCHAR,
        attachment_name VARCHAR
      );
    `);
    await ensurePipelineTrackingTables(conn);
    await ensureSavedSearchTables(conn);
    await ensureContentFlagTables(conn);
    await ensureAlertTables(conn);

    // Seed a filing that was "just discovered"
    await conn.run(`
      INSERT INTO filing VALUES
        (1, 'SAT-LOA-20260321-00001', 'E100', 'SpaceX Inc', 'SAT', 'LOA', 'A', '2026-03-21', NULL, current_timestamp);
    `);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should flag new content matching an alert-enabled saved search', async () => {
    // Create a saved search and enable alerting
    const searchId: number = await createSavedSearch(conn, userId, {
      name: 'All SAT filings',
      content_type: 'filing',
      filters: { subsystem_code: ['SAT'] },
    });
    await updateSavedSearch(conn, searchId, userId, { alert_enabled: true });

    // Create a pipeline run to reference
    const pipelineRunId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, pipelineRunId, 'completed');

    // Evaluate alerts
    const result = await evaluateAlerts(conn, pipelineRunId);
    expect(result.searchesEvaluated).toEqual(1);
    expect(result.totalMatched).toEqual(1);
    expect(result.totalFlagged).toEqual(1);

    // Verify flag was written
    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const match = flags.find((f) => f.content_key === 'SAT-LOA-20260321-00001');
    expect(match).toBeDefined();
    expect(match!.source).toEqual('alert');
    expect(match!.saved_search_id).toEqual(searchId);
  });

  it('should not duplicate flags on repeated evaluations', async () => {
    const pipelineRunId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, pipelineRunId, 'completed');

    const result = await evaluateAlerts(conn, pipelineRunId);
    // Should match but not flag (already flagged from previous run)
    expect(result.searchesEvaluated).toEqual(1);

    const flags = await getActiveFlagsForUser(conn, userId, 'filing');
    const matches = flags.filter(
      (f) => f.content_key === 'SAT-LOA-20260321-00001',
    );
    expect(matches).toHaveLength(1); // Still just one flag
  });

  it('should not evaluate searches that are not alert-enabled', async () => {
    await createSavedSearch(conn, userId, {
      name: 'Non-alert search',
      content_type: 'filing',
      filters: { subsystem_code: ['SES'] },
    });
    // Not calling updateSavedSearch to enable alerting

    const pipelineRunId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, pipelineRunId, 'completed');

    const result = await evaluateAlerts(conn, pipelineRunId);
    // Should still only evaluate 1 search (the alert-enabled one)
    expect(result.searchesEvaluated).toEqual(1);
  });
});
