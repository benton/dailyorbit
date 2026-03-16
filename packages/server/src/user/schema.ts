import type { DuckDBConnection } from '@duckdb/node-api';

/**
 * Create auth-related tables if they don't already exist.
 * Idempotent — safe to call multiple times.
 */
export async function ensureAuthTables(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS "user" (
      id              VARCHAR PRIMARY KEY,
      name            VARCHAR NOT NULL,
      email           VARCHAR NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
      image           VARCHAR,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT current_timestamp,
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT current_timestamp,
      role            VARCHAR NOT NULL DEFAULT 'user',
      banned          BOOLEAN NOT NULL DEFAULT FALSE,
      "banReason"     VARCHAR,
      "banExpires"    TIMESTAMP
    )
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS session (
      id               VARCHAR PRIMARY KEY,
      "userId"         VARCHAR NOT NULL,
      token            VARCHAR NOT NULL UNIQUE,
      "expiresAt"      TIMESTAMP NOT NULL,
      "ipAddress"      VARCHAR,
      "userAgent"      VARCHAR,
      "createdAt"      TIMESTAMP NOT NULL DEFAULT current_timestamp,
      "updatedAt"      TIMESTAMP NOT NULL DEFAULT current_timestamp,
      "impersonatedBy" VARCHAR
    )
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS account (
      id                      VARCHAR PRIMARY KEY,
      "userId"                VARCHAR NOT NULL,
      "accountId"             VARCHAR NOT NULL,
      "providerId"            VARCHAR NOT NULL,
      "accessToken"           VARCHAR,
      "refreshToken"          VARCHAR,
      "accessTokenExpiresAt"  TIMESTAMP,
      "refreshTokenExpiresAt" TIMESTAMP,
      scope                   VARCHAR,
      "idToken"               VARCHAR,
      password                VARCHAR,
      "createdAt"             TIMESTAMP NOT NULL DEFAULT current_timestamp,
      "updatedAt"             TIMESTAMP NOT NULL DEFAULT current_timestamp
    )
  `);

  await conn.run(`
    CREATE TABLE IF NOT EXISTS verification (
      id         VARCHAR PRIMARY KEY,
      identifier VARCHAR NOT NULL,
      value      VARCHAR NOT NULL,
      "expiresAt" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT current_timestamp,
      "updatedAt" TIMESTAMP NOT NULL DEFAULT current_timestamp
    )
  `);
}
