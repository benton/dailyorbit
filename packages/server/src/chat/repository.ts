import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { RetrievedSource } from '../query/types.ts';
import type { Conversation, Message } from './types.ts';

// ── Row mappers ─────────────────────────────────────────────────────

function rowToConversation(r: Record<string, unknown>): Conversation {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    consultantId: Number(r.consultant_id),
    consultantName:
      r.consultant_name != null ? String(r.consultant_name) : null,
    consultantIcon:
      r.consultant_icon != null ? String(r.consultant_icon) : null,
    consultantColor:
      r.consultant_color != null ? String(r.consultant_color) : null,
    title: r.title != null ? String(r.title) : null,
    totalInputTokens: Number(r.total_input_tokens),
    totalOutputTokens: Number(r.total_output_tokens),
    totalCostCents: Number(r.total_cost_cents),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToMessage(r: Record<string, unknown>): Message {
  let sources: RetrievedSource[] | null = null;
  if (r.sources != null) {
    const raw: unknown = r.sources;
    if (typeof raw === 'string') {
      sources = JSON.parse(raw) as RetrievedSource[];
    } else if (Array.isArray(raw)) {
      sources = raw as RetrievedSource[];
    }
  }

  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    role: String(r.role) as 'user' | 'assistant',
    content: String(r.content),
    sources,
    inputTokens: r.input_tokens != null ? Number(r.input_tokens) : null,
    outputTokens: r.output_tokens != null ? Number(r.output_tokens) : null,
    costCents: Number(r.cost_cents),
    modelId: r.model_id != null ? String(r.model_id) : null,
    consultantId: r.consultant_id != null ? Number(r.consultant_id) : null,
    sequence: Number(r.sequence),
    createdAt: String(r.created_at),
  };
}

// ── Conversation SQL ────────────────────────────────────────────────

const CONVERSATION_SELECT: string = `
  SELECT c.*,
         con.name  AS consultant_name,
         con.icon  AS consultant_icon,
         con.color AS consultant_color
  FROM conversation c
  LEFT JOIN consultant con ON con.id = c.consultant_id
`;

// ── Conversation CRUD ───────────────────────────────────────────────

export async function createConversation(
  conn: DuckDBConnection,
  data: { userId: string; consultantId: number },
): Promise<Conversation> {
  await conn.run(
    `INSERT INTO conversation (id, user_id, consultant_id)
     VALUES (gen_random_uuid()::VARCHAR, $1, $2)`,
    [data.userId, data.consultantId] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `${CONVERSATION_SELECT}
     WHERE c.id = (SELECT id FROM conversation ORDER BY created_at DESC LIMIT 1)`,
  );
  return rowToConversation(reader.getRowObjectsJS()[0]!);
}

export async function getConversationById(
  conn: DuckDBConnection,
  id: string,
): Promise<Conversation | null> {
  const reader = await conn.runAndReadAll(
    `${CONVERSATION_SELECT} WHERE c.id = $1`,
    [id] as DuckDBValue[],
  );
  const rows = reader.getRowObjectsJS();
  if (rows.length === 0) return null;
  return rowToConversation(rows[0]!);
}

export async function listConversations(
  conn: DuckDBConnection,
  userId: string,
): Promise<Conversation[]> {
  const reader = await conn.runAndReadAll(
    `${CONVERSATION_SELECT} WHERE c.user_id = $1 ORDER BY c.updated_at DESC`,
    [userId] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToConversation);
}

export async function updateConversationTitle(
  conn: DuckDBConnection,
  id: string,
  title: string,
): Promise<Conversation | null> {
  await conn.run(
    `UPDATE conversation SET title = $1, updated_at = current_timestamp WHERE id = $2`,
    [title, id] as DuckDBValue[],
  );
  return getConversationById(conn, id);
}

export async function deleteConversation(
  conn: DuckDBConnection,
  id: string,
): Promise<boolean> {
  const before = await conn.runAndReadAll(
    `SELECT count(*)::INTEGER AS cnt FROM conversation WHERE id = $1`,
    [id] as DuckDBValue[],
  );
  const count: number = Number(before.getRowObjectsJS()[0]!.cnt);
  if (count === 0) return false;

  await conn.run(`DELETE FROM message WHERE conversation_id = $1`, [
    id,
  ] as DuckDBValue[]);
  await conn.run(`DELETE FROM conversation WHERE id = $1`, [
    id,
  ] as DuckDBValue[]);
  return true;
}

export async function updateConversationTotals(
  conn: DuckDBConnection,
  id: string,
  data: {
    inputTokens: number;
    outputTokens: number;
    costCents: number;
    consultantId: number;
  },
): Promise<void> {
  await conn.run(
    `UPDATE conversation
     SET total_input_tokens  = total_input_tokens + $1,
         total_output_tokens = total_output_tokens + $2,
         total_cost_cents    = total_cost_cents + $3,
         consultant_id       = $4,
         updated_at          = current_timestamp
     WHERE id = $5`,
    [
      data.inputTokens,
      data.outputTokens,
      data.costCents,
      data.consultantId,
      id,
    ] as DuckDBValue[],
  );
}

// ── Message CRUD ────────────────────────────────────────────────────

export async function createMessage(
  conn: DuckDBConnection,
  data: {
    conversationId: string;
    role: 'user' | 'assistant';
    content: string;
    sources?: RetrievedSource[];
    inputTokens?: number;
    outputTokens?: number;
    costCents?: number;
    modelId?: string;
    consultantId?: number;
    sequence: number;
  },
): Promise<Message> {
  const sourcesJson: string | null =
    data.sources != null ? JSON.stringify(data.sources) : null;

  await conn.run(
    `INSERT INTO message (id, conversation_id, role, content, sources, input_tokens, output_tokens, cost_cents, model_id, consultant_id, sequence)
     VALUES (gen_random_uuid()::VARCHAR, $1, $2, $3, $4::JSON, $5, $6, $7, $8, $9, $10)`,
    [
      data.conversationId,
      data.role,
      data.content,
      sourcesJson,
      data.inputTokens ?? null,
      data.outputTokens ?? null,
      data.costCents ?? 0,
      data.modelId ?? null,
      data.consultantId ?? null,
      data.sequence,
    ] as DuckDBValue[],
  );

  const reader = await conn.runAndReadAll(
    `SELECT * FROM message WHERE conversation_id = $1 AND sequence = $2`,
    [data.conversationId, data.sequence] as DuckDBValue[],
  );
  return rowToMessage(reader.getRowObjectsJS()[0]!);
}

export async function listMessages(
  conn: DuckDBConnection,
  conversationId: string,
): Promise<Message[]> {
  const reader = await conn.runAndReadAll(
    `SELECT * FROM message WHERE conversation_id = $1 ORDER BY sequence ASC`,
    [conversationId] as DuckDBValue[],
  );
  return reader.getRowObjectsJS().map(rowToMessage);
}

export async function getNextSequence(
  conn: DuckDBConnection,
  conversationId: string,
): Promise<number> {
  const reader = await conn.runAndReadAll(
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS next_seq FROM message WHERE conversation_id = $1`,
    [conversationId] as DuckDBValue[],
  );
  return Number(reader.getRowObjectsJS()[0]!.next_seq);
}
