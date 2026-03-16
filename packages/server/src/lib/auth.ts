import { DuckDBConnection } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { betterAuth } from 'better-auth';
import type { Adapter } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import { buildWhereClause } from './auth-helpers.ts';
import type { ConfigService } from './config-service.ts';
import { getDb } from './db.ts';
import type { SecretValue } from './encryption.ts';

// DuckDB can't bind Date or other non-primitive types; convert to strings.
function coerceToDuckDBValue(v: unknown): DuckDBValue {
  if (v instanceof Date) return v.toISOString() as DuckDBValue;
  if (typeof v === 'boolean') return v as DuckDBValue;
  if (typeof v === 'number') return v as DuckDBValue;
  if (typeof v === 'string') return v as DuckDBValue;
  return String(v) as DuckDBValue;
}

// Resolve joined models for better-auth queries.
// Two join directions:
//   one-to-many: user → account[] — FK "userId" lives on account, match row.id
//   many-to-one: session → user   — FK "userId" lives on session, match row.userId to user.id
//
// Heuristic: if the source row has a "{joinModel}Id" column, it's many-to-one
// (look up joinModel.id = row[joinModelId]). Otherwise it's one-to-many
// (look up joinModel.{model}Id = row.id).
async function resolveJoins(
  conn: DuckDBConnection,
  model: string,
  row: Record<string, unknown>,
  join: Record<string, boolean | { limit?: number }> | undefined,
): Promise<Record<string, unknown>> {
  if (join == null) return row;
  const result: Record<string, unknown> = { ...row };
  for (const [joinModel, joinOpt] of Object.entries(join)) {
    if (!joinOpt) continue;
    const limit: number | undefined =
      typeof joinOpt === 'object' ? joinOpt.limit : undefined;
    const limitSql: string = limit != null ? `LIMIT ${String(limit)}` : '';

    // Check if source row has a FK pointing to the joined model (many-to-one)
    const fkOnSource: string = `${joinModel}Id`;
    if (fkOnSource in row && row[fkOnSource] != null) {
      // many-to-one: e.g. session.userId → user.id
      const reader = await conn.runAndReadAll(
        `SELECT * FROM "${joinModel}" WHERE "id" = $1 LIMIT 1`,
        [row[fkOnSource] as DuckDBValue],
      );
      const rows = reader.getRowObjectsJS();
      result[joinModel] = rows.length > 0 ? rows[0] : null;
    } else {
      // one-to-many: e.g. user.id → account.userId
      const fk: string = `${model}Id`;
      const reader = await conn.runAndReadAll(
        `SELECT * FROM "${joinModel}" WHERE "${fk}" = $1 ${limitSql}`,
        [row.id as DuckDBValue],
      );
      result[joinModel] = reader.getRowObjectsJS();
    }
  }
  return result;
}

function createDuckDbAdapter(): Adapter {
  const adapter: Adapter = {
    id: 'duckdb',

    async create({ model, data }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      // Ensure an id is present — better-auth may omit it for DB-generated ids,
      // but DuckDB has no auto-id so we generate one.
      if (!('id' in data) || (data as Record<string, unknown>).id == null) {
        (data as Record<string, unknown>).id = crypto.randomUUID();
      }
      // Filter out null/undefined values — DuckDB can't bind untyped NULLs.
      // The table's DEFAULT constraints handle missing columns.
      const entries = Object.entries(data).filter(([, v]) => v != null);
      const cols = entries.map(([k]) => `"${k}"`).join(', ');
      const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ');
      const values = entries.map(([, v]) =>
        coerceToDuckDBValue(v),
      ) as DuckDBValue[];
      const reader = await conn.runAndReadAll(
        `INSERT INTO "${model}" (${cols}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      conn.closeSync();
      return reader.getRowObjectsJS()[0] as never;
    },

    async findOne({ model, where, select, join }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const cols =
        select != null && select.length > 0
          ? select.map((c) => `"${String(c)}"`).join(', ')
          : '*';
      const { sql, params } = buildWhereClause(where);
      const query: string = `SELECT ${cols} FROM "${model}" ${sql} LIMIT 1`;
      const reader = await conn.runAndReadAll(query, params as DuckDBValue[]);
      const rows = reader.getRowObjectsJS();
      if (rows.length === 0) {
        conn.closeSync();
        return null;
      }
      const row = await resolveJoins(
        conn,
        model,
        rows[0] as Record<string, unknown>,
        join as Record<string, boolean | { limit?: number }> | undefined,
      );
      conn.closeSync();
      return row as never;
    },

    async findMany({ model, where, limit, offset, sortBy, join }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const { sql, params } = buildWhereClause(where ?? []);
      const order =
        sortBy != null
          ? `ORDER BY "${sortBy.field}" ${sortBy.direction.toUpperCase()}`
          : '';
      const limitSql = limit != null ? `LIMIT ${limit}` : '';
      const offsetSql = offset != null ? `OFFSET ${offset}` : '';
      const reader = await conn.runAndReadAll(
        `SELECT * FROM "${model}" ${sql} ${order} ${limitSql} ${offsetSql}`,
        params as DuckDBValue[],
      );
      const rows = reader.getRowObjectsJS() as Record<string, unknown>[];
      const joinOpt = join as
        | Record<string, boolean | { limit?: number }>
        | undefined;
      if (joinOpt != null) {
        const resolved: Record<string, unknown>[] = [];
        for (const row of rows) {
          resolved.push(await resolveJoins(conn, model, row, joinOpt));
        }
        conn.closeSync();
        return resolved as never;
      }
      conn.closeSync();
      return rows as never;
    },

    async update({ model, where, update: data }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      // Separate null values (inline as NULL) from non-null (parameterized).
      const entries = Object.entries(data);
      const setClauseParts: string[] = [];
      const setValues: DuckDBValue[] = [];
      let paramIdx = 1;
      for (const [k, v] of entries) {
        if (v == null) {
          setClauseParts.push(`"${k}" = NULL`);
        } else {
          setClauseParts.push(`"${k}" = $${paramIdx++}`);
          setValues.push(coerceToDuckDBValue(v));
        }
      }
      const setClauses: string = setClauseParts.join(', ');
      const { sql, params } = buildWhereClause(where, paramIdx);
      const reader = await conn.runAndReadAll(
        `UPDATE "${model}" SET ${setClauses} ${sql} RETURNING *`,
        [...setValues, ...(params as DuckDBValue[])],
      );
      conn.closeSync();
      const rows = reader.getRowObjectsJS();
      return rows.length > 0 ? (rows[0] as never) : null;
    },

    async updateMany({ model, where, update: data }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const setValues = Object.values(data) as DuckDBValue[];
      const setClauses = Object.keys(data)
        .map((k, i) => `"${k}" = $${i + 1}`)
        .join(', ');
      const { sql, params } = buildWhereClause(where, setValues.length + 1);
      await conn.run(`UPDATE "${model}" SET ${setClauses} ${sql}`, [
        ...setValues,
        ...(params as DuckDBValue[]),
      ]);
      conn.closeSync();
      return 0;
    },

    async delete({ model, where }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const { sql, params } = buildWhereClause(where);
      await conn.run(`DELETE FROM "${model}" ${sql}`, params as DuckDBValue[]);
      conn.closeSync();
    },

    async deleteMany({ model, where }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const { sql, params } = buildWhereClause(where);
      await conn.run(`DELETE FROM "${model}" ${sql}`, params as DuckDBValue[]);
      conn.closeSync();
      return 0;
    },

    async count({ model, where }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const { sql, params } = buildWhereClause(where ?? []);
      const reader = await conn.runAndReadAll(
        `SELECT COUNT(*) AS count FROM "${model}" ${sql}`,
        params as DuckDBValue[],
      );
      conn.closeSync();
      const rows = reader.getRowObjectsJS();
      return Number(rows[0]?.count ?? 0);
    },

    async transaction(callback) {
      return callback(adapter);
    },
  };
  return adapter;
}

let authInstance: ReturnType<typeof betterAuth> | null = null;

export function initializeAuth(config: ConfigService): void {
  authInstance = betterAuth({
    secret: (config.get('betterAuthSecret') as SecretValue).unwrap(),
    baseURL: config.get('betterAuthUrl') as string,
    trustedOrigins: [config.get('clientDomain') as string],
    database: createDuckDbAdapter,
    emailAndPassword: {
      enabled: true,
    },
    plugins: [admin()],
  });
}

export function getAuth(): ReturnType<typeof betterAuth> {
  if (authInstance == null) {
    throw new Error(
      'Auth not initialized. Call initializeAuth() during startup.',
    );
  }
  return authInstance;
}
