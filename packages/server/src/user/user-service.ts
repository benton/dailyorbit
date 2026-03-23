import { randomUUID } from 'node:crypto';
import type { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { getLogger } from '../lib/logger.ts';
import { DuckDBConnection as DuckDBConn } from '@duckdb/node-api';
import { hashPassword } from 'better-auth/crypto';
import type { SecretValue } from '../lib/encryption.ts';
import { setWatermark } from '../viewing-history/repository.ts';

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RawUserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function rowToUser(row: RawUserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    banned: row.banned,
    banReason: row.banReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class UserService {
  readonly #db: DuckDBInstance;

  constructor(db: DuckDBInstance) {
    this.#db = db;
  }

  async #conn(): Promise<DuckDBConnection> {
    return DuckDBConn.create(this.#db);
  }

  async getUserCount(): Promise<number> {
    const conn: DuckDBConnection = await this.#conn();
    const result = await conn.runAndReadAll(
      'SELECT COUNT(*) AS count FROM "user"',
    );
    conn.closeSync();
    return Number(result.getRowObjectsJS()[0]?.count ?? 0);
  }

  async createUser(
    email: string,
    name: string,
    password: SecretValue,
    role?: string,
  ): Promise<UserRecord> {
    const count: number = await this.getUserCount();
    let assignedRole: string = role ?? 'user';

    if (count === 0 && role == null) {
      assignedRole = 'admin';
      getLogger().warn(`Warning: first user auto-promoted to admin — ${email}`);
    }

    const id: string = randomUUID();
    const now: Date = new Date();
    const nowIso: string = now.toISOString();

    const hash: string = await hashPassword(password.unwrap());

    const conn: DuckDBConnection = await this.#conn();

    await conn.run(
      `INSERT INTO "user" (id, name, email, role, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, name, email, assignedRole, nowIso, nowIso],
    );

    const accountId: string = randomUUID();
    await conn.run(
      `INSERT INTO account (id, "userId", "accountId", "providerId", password, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [accountId, id, id, 'credential', hash, nowIso, nowIso],
    );

    // Initialize watermarks so back catalog is implicitly "read" from day one
    await setWatermark(conn, id, 'filing', now);
    await setWatermark(conn, id, 'news', now);

    conn.closeSync();

    return {
      id,
      name,
      email,
      role: assignedRole,
      banned: false,
      banReason: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listUsers(): Promise<UserRecord[]> {
    const conn: DuckDBConnection = await this.#conn();
    const result = await conn.runAndReadAll(
      'SELECT id, name, email, role, banned, "banReason", "createdAt", "updatedAt" FROM "user" ORDER BY "createdAt" DESC',
    );
    conn.closeSync();
    return result.getRowObjectsJS().map((row) => rowToUser(row as RawUserRow));
  }

  async getUser(userId: string): Promise<UserRecord | null> {
    const conn: DuckDBConnection = await this.#conn();
    const result = await conn.runAndReadAll(
      'SELECT id, name, email, role, banned, "banReason", "createdAt", "updatedAt" FROM "user" WHERE id = $1',
      [userId],
    );
    conn.closeSync();
    const rows = result.getRowObjectsJS();
    return rows.length > 0 ? rowToUser(rows[0] as RawUserRow) : null;
  }

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const conn: DuckDBConnection = await this.#conn();
    const result = await conn.runAndReadAll(
      'SELECT id, name, email, role, banned, "banReason", "createdAt", "updatedAt" FROM "user" WHERE email = $1',
      [email],
    );
    conn.closeSync();
    const rows = result.getRowObjectsJS();
    return rows.length > 0 ? rowToUser(rows[0] as RawUserRow) : null;
  }

  async disableUser(userId: string, reason?: string): Promise<void> {
    const conn: DuckDBConnection = await this.#conn();
    await conn.run(
      'UPDATE "user" SET banned = TRUE, "banReason" = $1, "updatedAt" = current_timestamp WHERE id = $2',
      [reason ?? null, userId],
    );
    conn.closeSync();
  }

  async enableUser(userId: string): Promise<void> {
    const conn: DuckDBConnection = await this.#conn();
    await conn.run(
      'UPDATE "user" SET banned = FALSE, "banReason" = NULL, "updatedAt" = current_timestamp WHERE id = $1',
      [userId],
    );
    conn.closeSync();
  }

  async deleteUser(userId: string): Promise<void> {
    const conn: DuckDBConnection = await this.#conn();
    await conn.run('DELETE FROM session WHERE "userId" = $1', [userId]);
    await conn.run('DELETE FROM account WHERE "userId" = $1', [userId]);
    await conn.run('DELETE FROM "user" WHERE id = $1', [userId]);
    conn.closeSync();
  }

  async resetPassword(userId: string, newPassword: SecretValue): Promise<void> {
    const hash: string = await hashPassword(newPassword.unwrap());

    const conn: DuckDBConnection = await this.#conn();
    await conn.run(
      'UPDATE account SET password = $1, "updatedAt" = current_timestamp WHERE "userId" = $2 AND "providerId" = $3',
      [hash, userId, 'credential'],
    );
    conn.closeSync();
  }

  async setRole(userId: string, role: string): Promise<void> {
    const conn: DuckDBConnection = await this.#conn();
    await conn.run(
      'UPDATE "user" SET role = $1, "updatedAt" = current_timestamp WHERE id = $2',
      [role, userId],
    );
    conn.closeSync();
  }
}
