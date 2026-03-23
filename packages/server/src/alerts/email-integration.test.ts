import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDBInstance, DuckDBConnection } from '@duckdb/node-api';
import { ensureAlertTables } from './schema.ts';
import { ensureHiddenItemTables } from '../hidden-item/schema.ts';
import { ensureSavedSearchTables } from '../saved-search/schema.ts';
import { ensureContentFlagTables } from '../content-flag/schema.ts';
import { ensurePipelineTrackingTables } from '../pipeline/schema.ts';
import { ensureViewingHistoryTables } from '../viewing-history/schema.ts';
import {
  createSavedSearch,
  updateSavedSearch,
} from '../saved-search/repository.ts';
import {
  insertPipelineRun,
  finishPipelineRun,
} from '../pipeline/tracking-repository.ts';
import { createEmailService } from '../email/email-service.ts';
import { evaluateAlertsWithEmail } from './evaluator.ts';
import type { ContentFlagRow } from '../content-flag/types.ts';

describe('alert email integration', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  const userId: string = 'email-test-user';

  /** Backdate a saved search's updated_at so filings with current_timestamp are "newer". */
  async function backdateSearch(searchId: number): Promise<void> {
    await conn.run(
      `UPDATE saved_search SET updated_at = '2026-01-01 00:00:00' WHERE id = $1`,
      [searchId],
    );
  }

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
      INSERT INTO "user" (id, name, email)
        VALUES ('email-test-user', 'Alice', 'alice@example.com');

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id VARCHAR NOT NULL PRIMARY KEY,
        email_daily_orbit BOOLEAN NOT NULL DEFAULT false,
        wide_view BOOLEAN NOT NULL DEFAULT false
      );
      INSERT INTO user_settings (user_id, email_daily_orbit)
        VALUES ('email-test-user', true);

      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        callsign VARCHAR, address_attention VARCHAR,
        subsystem_code VARCHAR NOT NULL, app_type_code VARCHAR NOT NULL,
        status_code VARCHAR, date_filed TIMESTAMP,
        company_id INTEGER, _first_seen_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS company (
        id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL,
        parent_company_id INTEGER
      );
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER NOT NULL, file_number VARCHAR NOT NULL,
        summary VARCHAR, attachment_name VARCHAR
      );
    `);

    await ensurePipelineTrackingTables(conn);
    await ensureSavedSearchTables(conn);
    await ensureContentFlagTables(conn);
    await ensureViewingHistoryTables(conn);
    await ensureAlertTables(conn);
    await ensureHiddenItemTables(conn);
  });

  afterAll(() => {
    conn.closeSync();
  });

  it('should send email digest and mark flags as emailed', async () => {
    // Create and enable saved search, then backdate it so the filing is "newer"
    const searchId: number = await createSavedSearch(conn, userId, {
      name: 'All SAT filings',
      content_type: 'filing',
      filters: { subsystem_code: ['SAT'] },
    });
    await updateSavedSearch(conn, searchId, userId, { alert_enabled: true });
    await backdateSearch(searchId);

    // Filing discovered after the backdated search updated_at
    await conn.run(`
      INSERT INTO filing VALUES
        (1, 'SAT-LOA-20260321-00001', 'E100', 'SpaceX Inc', 'SAT', 'LOA',
         'A', '2026-03-21', NULL, '2026-03-21 00:00:00');
    `);

    // Create pipeline run
    const runId: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, runId, 'completed');

    // Create test email service
    const emailService = createEmailService({ transport: 'test' });

    // Evaluate with email
    const result = await evaluateAlertsWithEmail(
      conn,
      runId,
      emailService,
      'http://localhost:5173',
    );

    expect(result.searchesEvaluated).toEqual(1);
    expect(result.totalMatched).toEqual(1);
    expect(result.totalFlagged).toEqual(1);
    expect(result.emailsSent).toEqual(1);

    // Verify emailed_at is set on the flag
    const flagReader = await conn.runAndReadAll(
      `SELECT emailed_at::VARCHAR AS emailed_at
       FROM user_content_flag
       WHERE user_id = $1 AND content_key = 'SAT-LOA-20260321-00001'`,
      [userId],
    );
    const flagRow = flagReader.getRowObjectsJS()[0] as Record<string, unknown>;
    expect(flagRow.emailed_at).not.toBeNull();

    // Verify alert_run.email_sent is true
    const runReader = await conn.runAndReadAll(
      `SELECT email_sent FROM alert_run
       WHERE pipeline_run_id = $1 AND items_flagged > 0
       ORDER BY executed_at DESC LIMIT 1`,
      [runId],
    );
    const runRow = runReader.getRowObjectsJS()[0] as Record<string, unknown>;
    expect(runRow.email_sent).toEqual(true);
  });

  it('should NOT re-email the same content on subsequent runs', async () => {
    // Create another pipeline run
    const runId2: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, runId2, 'completed');

    const emailService = createEmailService({ transport: 'test' });

    const result = await evaluateAlertsWithEmail(
      conn,
      runId2,
      emailService,
      'http://localhost:5173',
    );

    // Watermark from prior alert_run should prevent re-matching
    expect(result.totalMatched).toEqual(0);
    expect(result.emailsSent).toEqual(0);
  });

  it('should NOT alert on pre-existing content when a new search is enabled', async () => {
    // Create a second search — the filing already exists before this search
    const searchId2: number = await createSavedSearch(conn, userId, {
      name: 'LOA filings',
      content_type: 'filing',
      filters: { app_type_code: ['LOA'] },
    });
    await updateSavedSearch(conn, searchId2, userId, {
      alert_enabled: true,
    });

    const runId3: number = await insertPipelineRun(conn, 'schedule');
    await finishPipelineRun(conn, runId3, 'completed');

    const emailService = createEmailService({ transport: 'test' });

    const result = await evaluateAlertsWithEmail(
      conn,
      runId3,
      emailService,
      'http://localhost:5173',
    );

    // The new search's watermark is its updated_at (when alert was enabled),
    // which is after the filing was ingested, so no new matches
    expect(result.searchesEvaluated).toEqual(2);
    expect(result.totalMatched).toEqual(0);
    expect(result.emailsSent).toEqual(0);

    // Only the original flag from the first search exists
    const flags: ContentFlagRow[] = (
      await conn.runAndReadAll(
        `SELECT id, saved_search_id, emailed_at::VARCHAR AS emailed_at
         FROM user_content_flag
         WHERE user_id = $1 AND content_key = 'SAT-LOA-20260321-00001'
         ORDER BY saved_search_id`,
        [userId],
      )
    ).getRowObjectsJS() as ContentFlagRow[];

    expect(flags.length).toEqual(1);
  });
});
