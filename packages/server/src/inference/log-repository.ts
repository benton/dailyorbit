import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import {
  type PaginatedRequest,
  type PaginatedResponse,
  buildPaginatedQuery,
  buildPaginatedResponse,
} from '../lib/pagination.ts';
import { computeCost } from './pricing.ts';

export type InferenceLogEntry = {
  readonly modelId: string;
  readonly operation: 'converse' | 'converse_stream' | 'embed';
  readonly caller?: string | undefined;
  readonly userId?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
};

export type InferenceLogSummaryRow = {
  readonly modelId: string;
  readonly caller: string | null;
  readonly totalCalls: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly avgLatencyMs: number;
};

const INSERT_SQL: string = `
  INSERT INTO inference_log (model_id, operation, caller, user_id, conversation_id, input_tokens, output_tokens, latency_ms)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
`;

/** Insert a single inference log entry. */
export async function logInference(
  conn: DuckDBConnection,
  entry: InferenceLogEntry,
): Promise<void> {
  await conn.run(INSERT_SQL, [
    entry.modelId,
    entry.operation,
    entry.caller ?? null,
    entry.userId ?? null,
    entry.conversationId ?? null,
    entry.inputTokens,
    entry.outputTokens,
    entry.latencyMs,
  ] as DuckDBValue[]);
}

/** Detach inference log rows from a conversation (nullify conversation_id, keep the rows). */
export async function detachConversationCosts(
  conn: DuckDBConnection,
  conversationId: string,
): Promise<void> {
  await conn.run(
    `UPDATE inference_log SET conversation_id = NULL WHERE conversation_id = $1`,
    [conversationId] as DuckDBValue[],
  );
}

/** Batch-insert multiple inference log entries. */
export async function logInferenceBatch(
  conn: DuckDBConnection,
  entries: readonly InferenceLogEntry[],
): Promise<void> {
  for (const entry of entries) {
    await logInference(conn, entry);
  }
}

/** Aggregate inference usage, optionally filtered by date range. */
export async function summarizeInferenceLog(
  conn: DuckDBConnection,
  from?: string,
  to?: string,
): Promise<InferenceLogSummaryRow[]> {
  const conditions: string[] = [];
  const params: DuckDBValue[] = [];
  let paramIndex: number = 1;

  if (from != null) {
    conditions.push(`created_at >= $${String(paramIndex)}::TIMESTAMP`);
    params.push(from);
    paramIndex++;
  }
  if (to != null) {
    conditions.push(`created_at <= $${String(paramIndex)}::TIMESTAMP`);
    params.push(to);
    paramIndex++;
  }

  const whereClause: string =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql: string = `
    SELECT
      model_id,
      caller,
      COUNT(*)::INTEGER AS total_calls,
      SUM(input_tokens)::INTEGER AS total_input_tokens,
      SUM(output_tokens)::INTEGER AS total_output_tokens,
      ROUND(AVG(latency_ms))::INTEGER AS avg_latency_ms
    FROM inference_log
    ${whereClause}
    GROUP BY model_id, caller
    ORDER BY total_calls DESC
  `;

  const reader = await conn.runAndReadAll(sql, params);
  const rows: InferenceLogSummaryRow[] = [];
  for (const row of reader.getRows()) {
    rows.push({
      modelId: String(row[0]),
      caller: row[1] != null ? String(row[1]) : null,
      totalCalls: Number(row[2]),
      totalInputTokens: Number(row[3]),
      totalOutputTokens: Number(row[4]),
      avgLatencyMs: Number(row[5]),
    });
  }
  return rows;
}

/** Row shape returned by the paginated inference log query. */
export type InferenceLogRow = {
  readonly id: number;
  readonly modelId: string;
  readonly operation: string;
  readonly caller: string | null;
  readonly userId: string | null;
  readonly conversationId: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
  readonly latencyMs: number;
  readonly createdAt: string;
};

const LOG_ALLOWED_COLUMNS: ReadonlySet<string> = new Set([
  'id',
  'model_id',
  'operation',
  'caller',
  'user_id',
  'conversation_id',
  'input_tokens',
  'output_tokens',
  'latency_ms',
  'created_at',
]);

/** Return a paginated list of inference log entries with computed cost. */
export async function listInferenceLog(
  conn: DuckDBConnection,
  request: PaginatedRequest,
): Promise<PaginatedResponse<InferenceLogRow>> {
  const baseSql: string = `
    SELECT id, model_id, operation, caller, user_id, conversation_id,
           input_tokens, output_tokens, latency_ms, created_at
    FROM inference_log
  `;

  const { sql, params, countSql, countParams } = buildPaginatedQuery(
    baseSql,
    [],
    request,
    LOG_ALLOWED_COLUMNS,
    'created_at',
  );

  const [dataReader, countReader] = await Promise.all([
    conn.runAndReadAll(sql, params),
    conn.runAndReadAll(countSql, countParams),
  ]);

  const totalRows: number = Number(countReader.getRows()[0]?.[0] ?? 0);

  const data: InferenceLogRow[] = [];
  for (const row of dataReader.getRows()) {
    const modelId: string = String(row[1]);
    const inputTokens: number = Number(row[6]);
    const outputTokens: number = Number(row[7]);
    data.push({
      id: Number(row[0]),
      modelId,
      operation: String(row[2]),
      caller: row[3] != null ? String(row[3]) : null,
      userId: row[4] != null ? String(row[4]) : null,
      conversationId: row[5] != null ? String(row[5]) : null,
      inputTokens,
      outputTokens,
      costCents: computeCost(modelId, inputTokens, outputTokens),
      latencyMs: Number(row[8]),
      createdAt: String(row[9]),
    });
  }

  return buildPaginatedResponse(data, totalRows, request);
}
