import { DuckDBConnection } from '@duckdb/node-api';
import { Hono } from 'hono';
import { getDb } from '../lib/db.ts';
import type { SessionUser } from '../user/SessionUser.ts';
import {
  getOrCreateSettings,
  updateSettings,
  type SettingsPatch,
} from './repository.ts';

const userSettingsRoutes = new Hono();

userSettingsRoutes.get('/', async (c) => {
  const user: SessionUser = c.get('user');
  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    const settings = await getOrCreateSettings(conn, user.id);
    return c.json(settings);
  } finally {
    conn.closeSync();
  }
});

userSettingsRoutes.patch('/', async (c) => {
  const user: SessionUser = c.get('user');
  const body = await c.req.json<SettingsPatch>();

  const db = await getDb();
  const conn: DuckDBConnection = await DuckDBConnection.create(db);
  try {
    await getOrCreateSettings(conn, user.id);
    const settings = await updateSettings(conn, user.id, body);
    return c.json(settings);
  } finally {
    conn.closeSync();
  }
});

export { userSettingsRoutes };
