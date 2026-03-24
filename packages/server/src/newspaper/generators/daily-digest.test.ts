import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureNewspaperTables } from '../schema.ts';
import { ensureNewsTables } from '../../news/schema.ts';
import {
  formatEditionDate,
  formatFilingSummaries,
  formatNewsSummaries,
  generateDailyDigest,
} from './daily-digest.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import type { InferenceResponse } from '../../inference/types.ts';

// ── Helpers ─────────────────────────────────────────────────────────

function makeMockInferenceService(content: string) {
  return {
    complete: vi.fn().mockResolvedValue({
      content,
      modelId: 'test-model',
      usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 },
      stopReason: 'end_turn',
      latencyMs: 50,
    } satisfies InferenceResponse),
  };
}

function makeMockConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    newspaperCopyModel: 'test-model',
    newspaperCopySystemPrompt: '',
    newspaperCopyUserPrompt: '',
    ...overrides,
  };
  return {
    get: vi.fn((key: string) => defaults[key] ?? ''),
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe('formatEditionDate', () => {
  it('formats an ISO date into a readable date string', () => {
    const result: string = formatEditionDate('2026-03-24');
    expect(result).toEqual('Tuesday, March 24, 2026');
  });
});

describe('formatFilingSummaries', () => {
  it('returns placeholder when empty', () => {
    expect(formatFilingSummaries([])).toContain('No notable filings');
  });

  it('formats filings as a markdown list', () => {
    const result: string = formatFilingSummaries([
      {
        fileNumber: 'SAT-LOA-20260324-00042',
        applicantName: 'Hughes Network Systems',
        dateFiled: '2026-03-24',
        summary: 'Application for new satellite license.',
      },
    ]);
    expect(result).toContain('SAT-LOA-20260324-00042');
    expect(result).toContain('Hughes Network Systems');
    expect(result).toContain('Application for new satellite license.');
  });
});

describe('formatNewsSummaries', () => {
  it('returns placeholder when empty', () => {
    expect(formatNewsSummaries([])).toContain('No recent industry news');
  });

  it('formats news items as a markdown list', () => {
    const result: string = formatNewsSummaries([
      {
        id: 1,
        title: 'Viasat announces merger',
        sourceUrl: 'https://example.com/article',
        sourceName: 'SpaceNews',
        summary: 'Viasat has announced a merger with another company.',
      },
    ]);
    expect(result).toContain('SpaceNews');
    expect(result).toContain('Viasat announces merger');
  });
});

describe('generateDailyDigest', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureNewspaperTables(conn);
    await ensureNewsTables(conn);

    // Minimal filing + attachment tables for the query
    await conn.run(`
      CREATE TABLE IF NOT EXISTS filing (
        filing_key INTEGER PRIMARY KEY,
        file_number VARCHAR NOT NULL,
        subsystem_code VARCHAR,
        app_type_code VARCHAR,
        date_filed DATE,
        address_attention VARCHAR,
        status_code VARCHAR
      )
    `);
    await conn.run(`
      CREATE TABLE IF NOT EXISTS attachment (
        attachment_key INTEGER PRIMARY KEY,
        filing_key INTEGER NOT NULL,
        file_number VARCHAR NOT NULL,
        attachment_name VARCHAR NOT NULL,
        download_url VARCHAR NOT NULL DEFAULT '',
        download_status VARCHAR NOT NULL DEFAULT 'pending',
        summary VARCHAR
      )
    `);
  });

  afterEach(() => {
    conn.closeSync();
  });

  it('returns fallback article when no filings or news exist', async () => {
    const inferenceService = makeMockInferenceService('unused');
    const config = makeMockConfig();

    const result: GeneratorResult = await generateDailyDigest({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.headline).toEqual('A Quiet Day on the Docket');
    expect(result.body).toContain('No new filings');
    expect(result.sourceData).toEqual({ filings: [], news: [] });
    expect(inferenceService.complete).not.toHaveBeenCalled();
  });

  it('calls inference with formatted prompt when data exists', async () => {
    // Insert a filing + attachment with summary
    await conn.run(
      `INSERT INTO filing (filing_key, file_number, date_filed, address_attention)
       VALUES (1, 'SAT-LOA-20260324-00042', '2026-03-24', 'Hughes Network Systems')`,
    );
    await conn.run(
      `INSERT INTO attachment (attachment_key, filing_key, file_number, attachment_name, summary)
       VALUES (1, 1, 'SAT-LOA-20260324-00042', 'application.pdf', 'Application for new orbital license.')`,
    );

    const responseText: string =
      '# Busy Day at the Bureau\n\nThe FCC received several notable filings today.';
    const inferenceService = makeMockInferenceService(responseText);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateDailyDigest({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.headline).toEqual('Busy Day at the Bureau');
    expect(result.body).toContain('FCC received several notable filings');
    expect(result.sourceData.filings).toContain('SAT-LOA-20260324-00042');
    expect(result.sourceData.modelId).toEqual('test-model');

    // Verify the inference call
    expect(inferenceService.complete).toHaveBeenCalledOnce();
    const call = inferenceService.complete.mock.calls[0]![0]!;
    expect(call.modelId).toEqual('test-model');
    expect(call.messages[0]!.content).toContain('Tuesday, March 24, 2026');
    expect(call.messages[0]!.content).toContain('SAT-LOA-20260324-00042');
    expect(call.params!.systemPrompt).toContain('Daily Orbit');
  });

  it('includes news items in source data when present', async () => {
    // Insert a news source + item with summary
    await conn.run(
      `INSERT INTO news_source (name, feed_url) VALUES ('SpaceNews', 'https://spacenews.com/feed/')`,
    );
    const sourceReader = await conn.runAndReadAll(
      `SELECT id FROM news_source LIMIT 1`,
    );
    const sourceId: number = Number(sourceReader.getRowObjectsJS()[0]!.id);

    await conn.run(
      `INSERT INTO news_item (news_source_id, source_url, title, published_at, summary, extract_status)
       VALUES (?, 'https://spacenews.com/article', 'Viasat merger update', '2026-03-24T10:00:00', 'Viasat announced new terms.', 'extracted')`,
      [sourceId],
    );

    const responseText: string =
      '# Industry Shakeup\n\nViasat continues merger talks.';
    const inferenceService = makeMockInferenceService(responseText);
    const config = makeMockConfig();

    const result: GeneratorResult = await generateDailyDigest({
      conn,
      editionId: 1,
      editionDate: '2026-03-24',
      inferenceService:
        inferenceService as unknown as GenerateOptions['inferenceService'],
      config: config as unknown as GenerateOptions['config'],
      log: vi.fn(),
    });

    expect(result.sourceData.news).toEqual([
      {
        id: expect.any(Number),
        title: 'Viasat merger update',
        sourceUrl: 'https://spacenews.com/article',
      },
    ]);
  });
});
