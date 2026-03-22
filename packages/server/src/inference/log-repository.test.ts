import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureInferenceLogTable } from './schema.ts';
import {
  logInference,
  logInferenceBatch,
  summarizeInferenceLog,
  type InferenceLogEntry,
  type InferenceLogSummaryRow,
} from './log-repository.ts';

describe('InferenceLogRepository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureInferenceLogTable(conn);
  });

  afterEach(() => {
    conn.closeSync();
    db.closeSync();
  });

  const ENTRY: InferenceLogEntry = {
    modelId: 'us.amazon.nova-pro-v1:0',
    operation: 'converse',
    caller: 'summarize',
    inputTokens: 500,
    outputTokens: 200,
    latencyMs: 1200,
  };

  describe('logInference', () => {
    it('inserts a single log entry', async () => {
      await logInference(conn, ENTRY);

      const reader = await conn.runAndReadAll(
        'SELECT model_id, operation, caller, input_tokens, output_tokens, latency_ms FROM inference_log',
      );
      const rows = reader.getRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual([
        'us.amazon.nova-pro-v1:0',
        'converse',
        'summarize',
        500,
        200,
        1200,
      ]);
    });

    it('allows null caller', async () => {
      await logInference(conn, { ...ENTRY, caller: undefined });

      const reader = await conn.runAndReadAll(
        'SELECT caller FROM inference_log',
      );
      expect(reader.getRows()[0]![0]).toBeNull();
    });

    it('stores user_id when provided', async () => {
      await logInference(conn, { ...ENTRY, userId: 'user-abc' });

      const reader = await conn.runAndReadAll(
        'SELECT user_id FROM inference_log',
      );
      expect(reader.getRows()[0]![0]).toEqual('user-abc');
    });

    it('allows null user_id', async () => {
      await logInference(conn, ENTRY);

      const reader = await conn.runAndReadAll(
        'SELECT user_id FROM inference_log',
      );
      expect(reader.getRows()[0]![0]).toBeNull();
    });
  });

  describe('logInferenceBatch', () => {
    it('inserts multiple entries', async () => {
      const entries: InferenceLogEntry[] = [
        { ...ENTRY, inputTokens: 100 },
        { ...ENTRY, inputTokens: 200, operation: 'embed' },
        { ...ENTRY, inputTokens: 300, operation: 'converse_stream' },
      ];
      await logInferenceBatch(conn, entries);

      const reader = await conn.runAndReadAll(
        'SELECT COUNT(*) FROM inference_log',
      );
      expect(Number(reader.getRows()[0]![0])).toEqual(3);
    });
  });

  describe('summarizeInferenceLog', () => {
    it('aggregates by model_id and caller', async () => {
      await logInferenceBatch(conn, [
        { ...ENTRY, inputTokens: 100, outputTokens: 50, latencyMs: 100 },
        { ...ENTRY, inputTokens: 200, outputTokens: 100, latencyMs: 200 },
        {
          ...ENTRY,
          caller: 'chat',
          inputTokens: 300,
          outputTokens: 150,
          latencyMs: 300,
        },
      ]);

      const summary: InferenceLogSummaryRow[] =
        await summarizeInferenceLog(conn);
      expect(summary).toHaveLength(2);

      const summarizeCaller = summary.find((r) => r.caller === 'summarize')!;
      expect(summarizeCaller.totalCalls).toEqual(2);
      expect(summarizeCaller.totalInputTokens).toEqual(300);
      expect(summarizeCaller.totalOutputTokens).toEqual(150);

      const chatCaller = summary.find((r) => r.caller === 'chat')!;
      expect(chatCaller.totalCalls).toEqual(1);
      expect(chatCaller.totalInputTokens).toEqual(300);
    });

    it('returns empty array for empty table', async () => {
      const summary: InferenceLogSummaryRow[] =
        await summarizeInferenceLog(conn);
      expect(summary).toEqual([]);
    });
  });
});
