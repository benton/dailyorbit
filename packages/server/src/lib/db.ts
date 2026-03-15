import { DuckDBInstance } from '@duckdb/node-api';
import { trackInstance } from './graceful-shutdown.ts';

let instance: DuckDBInstance | null = null;
let configuredPath: string | null = null;

/** Set the database path before the first getDb() call. */
export function setDbPath(path: string): void {
  if (instance != null) {
    throw new Error('Cannot set DB path after database is already open');
  }
  configuredPath = path;
}

/** Return the configured database path. Throws if not yet configured. */
export function getDbPath(): string {
  if (configuredPath == null) {
    throw new Error('Database path not configured');
  }
  return configuredPath;
}

export async function getDb(): Promise<DuckDBInstance> {
  if (instance == null) {
    if (configuredPath == null) {
      throw new Error(
        'Database path not configured. Call setDbPath() during startup.',
      );
    }
    instance = await DuckDBInstance.create(configuredPath);
    trackInstance(instance);
  }
  return instance;
}
