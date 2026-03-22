import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';

export type InferenceLogEntry = {
  readonly modelId: string;
  readonly operation: 'converse' | 'converse_stream' | 'embed';
  readonly caller?: string | undefined;
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
  INSERT INTO inference_log (model_id, operation, caller, input_tokens, output_tokens, latency_ms)
  VALUES ($1, $2, $3, $4, $5, $6)
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
    entry.inputTokens,
    entry.outputTokens,
    entry.latencyMs,
  ] as DuckDBValue[]);
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
