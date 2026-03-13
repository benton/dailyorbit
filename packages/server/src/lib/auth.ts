import { betterAuth } from "better-auth";
import type { Adapter } from "better-auth";
import { buildWhereClause } from "./auth-helpers.ts";
import { getDb } from "./db.ts";
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL, CLIENT_DOMAIN } from "./env.ts";

function toRecord(row: unknown): Record<string, unknown> {
  return row as Record<string, unknown>;
}

function createDuckDbAdapter(): Adapter {
  return {
    id: "duckdb",

    async create({ model, data }) {
      const db = await getDb();
      const conn = await db.connect();
      const keys = Object.keys(data);
      const cols = keys.map((k) => `"${k}"`).join(", ");
      const placeholders = keys.map(() => "?").join(", ");
      const values = Object.values(data);
      const stmt = await conn.prepare(
        `INSERT INTO "${model}" (${cols}) VALUES (${placeholders}) RETURNING *`,
      );
      const result = await stmt.query(...values);
      await conn.close();
      return toRecord(result.getRowObjects()[0]) as never;
    },

    async findOne({ model, where, select }) {
      const db = await getDb();
      const conn = await db.connect();
      const cols =
        select != null && select.length > 0 ? select.map((c) => `"${String(c)}"`).join(", ") : "*";
      const { sql, params } = buildWhereClause(where);
      const stmt = await conn.prepare(`SELECT ${cols} FROM "${model}" ${sql} LIMIT 1`);
      const result = await stmt.query(...params);
      await conn.close();
      const rows = result.getRowObjects();
      return rows.length > 0 ? (toRecord(rows[0]) as never) : null;
    },

    async findMany({ model, where, limit, offset, sortBy }) {
      const db = await getDb();
      const conn = await db.connect();
      const { sql, params } = buildWhereClause(where ?? []);
      const order =
        sortBy != null ? `ORDER BY "${sortBy.field}" ${sortBy.direction.toUpperCase()}` : "";
      const limitSql = limit != null ? `LIMIT ${limit}` : "";
      const offsetSql = offset != null ? `OFFSET ${offset}` : "";
      const stmt = await conn.prepare(
        `SELECT * FROM "${model}" ${sql} ${order} ${limitSql} ${offsetSql}`,
      );
      const result = await stmt.query(...params);
      await conn.close();
      return result.getRowObjects().map((r) => toRecord(r)) as never;
    },

    async update({ model, where, update: data }) {
      const db = await getDb();
      const conn = await db.connect();
      const setClauses = Object.keys(data)
        .map((k) => `"${k}" = ?`)
        .join(", ");
      const setValues = Object.values(data);
      const { sql, params } = buildWhereClause(where);
      const stmt = await conn.prepare(`UPDATE "${model}" SET ${setClauses} ${sql} RETURNING *`);
      const result = await stmt.query(...setValues, ...params);
      await conn.close();
      const rows = result.getRowObjects();
      return rows.length > 0 ? (toRecord(rows[0]) as never) : null;
    },

    async updateMany({ model, where, update: data }) {
      const db = await getDb();
      const conn = await db.connect();
      const setClauses = Object.keys(data)
        .map((k) => `"${k}" = ?`)
        .join(", ");
      const setValues = Object.values(data);
      const { sql, params } = buildWhereClause(where);
      const stmt = await conn.prepare(`UPDATE "${model}" SET ${setClauses} ${sql}`);
      await stmt.query(...setValues, ...params);
      await conn.close();
      return 0;
    },

    async delete({ model, where }) {
      const db = await getDb();
      const conn = await db.connect();
      const { sql, params } = buildWhereClause(where);
      const stmt = await conn.prepare(`DELETE FROM "${model}" ${sql}`);
      await stmt.query(...params);
      await conn.close();
    },

    async deleteMany({ model, where }) {
      const db = await getDb();
      const conn = await db.connect();
      const { sql, params } = buildWhereClause(where);
      const stmt = await conn.prepare(`DELETE FROM "${model}" ${sql}`);
      await stmt.query(...params);
      await conn.close();
      return 0;
    },
  };
}

export const auth = betterAuth({
  secret: BETTER_AUTH_SECRET,
  baseURL: BETTER_AUTH_URL,
  trustedOrigins: [CLIENT_DOMAIN],
  database: createDuckDbAdapter(),
  emailAndPassword: {
    enabled: true,
  },
});
