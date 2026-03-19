import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { Consultant } from './types.ts';

// ── Row mapper ──────────────────────────────────────────────────────

function rowToConsultant(r: Record<string, unknown>): Consultant {
  return {
    id: Number(r.id),
    name: String(r.name),
    slug: String(r.slug),
    description: r.description != null ? String(r.description) : null,
    systemPrompt: String(r.system_prompt),
    modelId: r.model_id != null ? String(r.model_id) : null,
    temperature: r.temperature != null ? Number(r.temperature) : null,
    maxResponseTokens: r.max_response_tokens != null ? Number(r.max_response_tokens) : null,
    icon: r.icon != null ? String(r.icon) : null,
    color: r.color != null ? String(r.color) : null,
    sortOrder: Number(r.sort_order),
    enabled: Boolean(r.enabled),
    archivedAt: r.archived_at != null ? String(r.archived_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

// ── CRUD operations ─────────────────────────────────────────────────

export async function createConsultant(
  conn: DuckDBConnection,
  data: {
    name: string;
    slug: string;
    description: string | null;
    systemPrompt: string;
    modelId: string | null;
    temperature: number | null;
    maxResponseTokens: number | null;
    icon: string | null;
    color: string | null;
    sortOrder: number;
    enabled: boolean;
  },
): Promise<Consultant> {
  await conn.run(
    `INSERT INTO consultant (name, slug, description, system_prompt, model_id, temperature, max_response_tokens, icon, color, sort_order, enabled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      data.name,
      data.slug,
      data.description,
      data.systemPrompt,
      data.modelId,
      data.temperature,
      data.maxResponseTokens,
      data.icon,
      data.color,
      data.sortOrder,
      data.enabled,
    ] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `SELECT * FROM consultant WHERE id = (SELECT max(id) FROM consultant)`,
  );
  return rowToConsultant(reader.getRowObjectsJS()[0]!);
}

export async function getConsultantById(
  conn: DuckDBConnection,
  id: number,
): Promise<Consultant | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM consultant WHERE id = $1`,
    [id] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToConsultant(rows[0]!);
}

export async function getConsultantBySlug(
  conn: DuckDBConnection,
  slug: string,
): Promise<Consultant | null> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM consultant WHERE slug = $1`,
    [slug] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToConsultant(rows[0]!);
}

export async function listConsultants(
  conn: DuckDBConnection,
  opts: { enabledOnly: boolean },
): Promise<Consultant[]> {
  let sql: string = `SELECT * FROM consultant`;
  if (opts.enabledOnly) {
    sql += ` WHERE enabled = true AND archived_at IS NULL`;
  }
  sql += ` ORDER BY sort_order, name`;

  const reader = await conn.runAndReadAll(sql);
  return reader.getRowObjectsJS().map(rowToConsultant);
}

export async function updateConsultant(
  conn: DuckDBConnection,
  id: number,
  data: {
    name?: string;
    slug?: string;
    description?: string | null;
    systemPrompt?: string;
    modelId?: string | null;
    temperature?: number | null;
    maxResponseTokens?: number | null;
    icon?: string | null;
    color?: string | null;
    sortOrder?: number;
    enabled?: boolean;
  },
): Promise<Consultant | null> {
  const sets: string[] = [];
  const params: DuckDBValue[] = [];
  let idx: number = 1;

  const fields: Array<[string, unknown]> = [
    ['name', data.name],
    ['slug', data.slug],
    ['description', data.description],
    ['system_prompt', data.systemPrompt],
    ['model_id', data.modelId],
    ['temperature', data.temperature],
    ['max_response_tokens', data.maxResponseTokens],
    ['icon', data.icon],
    ['color', data.color],
    ['sort_order', data.sortOrder],
    ['enabled', data.enabled],
  ];

  for (const [col, val] of fields) {
    if (val !== undefined) {
      sets.push(`"${col}" = $${String(idx)}`);
      params.push(val as DuckDBValue);
      idx++;
    }
  }

  if (sets.length === 0) return getConsultantById(conn, id);

  sets.push(`updated_at = current_timestamp`);
  params.push(id as DuckDBValue);

  await conn.run(
    `UPDATE consultant SET ${sets.join(', ')} WHERE id = $${String(idx)}`,
    params,
  );

  return getConsultantById(conn, id);
}

export async function archiveConsultant(
  conn: DuckDBConnection,
  id: number,
): Promise<boolean> {
  const before = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS cnt FROM consultant WHERE id = $1`,
    [id] as DuckDBValue[],
  );
  const count: number = Number(before.getRowObjectsJS()[0]!.cnt);
  if (count === 0) return false;

  await conn.run(
    `UPDATE consultant SET archived_at = current_timestamp, updated_at = current_timestamp WHERE id = $1`,
    [id] as DuckDBValue[],
  );
  return true;
}
