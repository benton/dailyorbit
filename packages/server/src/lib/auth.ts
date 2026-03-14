import { DuckDBConnection } from '@duckdb/node-api';
import type { DuckDBValue } from '@duckdb/node-api';
import { betterAuth } from 'better-auth';
import type { Adapter } from 'better-auth';
import { buildWhereClause } from './auth-helpers.ts';
import type { ConfigService } from './config-service.ts';
import { getDb } from './db.ts';
import type { SecretValue } from './encryption.ts';

function createDuckDbAdapter(): Adapter {
  const adapter: Adapter = {
    id: 'duckdb',

    async create({ model, data }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const keys = Object.keys(data);
      const cols = keys.map((k) => `"${k}"`).join(', ');
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
      const values = Object.values(data) as DuckDBValue[];
      const reader = await conn.runAndReadAll(
        `INSERT INTO "${model}" (${cols}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      conn.closeSync();
      return reader.getRowObjectsJS()[0] as never;
    },

    async findOne({ model, where, select }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const cols =
        select != null && select.length > 0
          ? select.map((c) => `"${String(c)}"`).join(', ')
          : '*';
      const { sql, params } = buildWhereClause(where);
      const reader = await conn.runAndReadAll(
        `SELECT ${cols} FROM "${model}" ${sql} LIMIT 1`,
        params as DuckDBValue[],
      );
      conn.closeSync();
      const rows = reader.getRowObjectsJS();
      return rows.length > 0 ? (rows[0] as never) : null;
    },

    async findMany({ model, where, limit, offset, sortBy }) {
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
      conn.closeSync();
      return reader.getRowObjectsJS() as never;
    },

    async update({ model, where, update: data }) {
      const db = await getDb();
      const conn = await DuckDBConnection.create(db);
      const setValues = Object.values(data) as DuckDBValue[];
      const setClauses = Object.keys(data)
        .map((k, i) => `"${k}" = $${i + 1}`)
        .join(', ');
      const { sql, params } = buildWhereClause(where, setValues.length + 1);
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
