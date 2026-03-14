import { resolve } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { trackInstance } from '../../lib/graceful-shutdown.ts';

export function resolveFromRoot(relativePath: string): string {
  return resolve(process.cwd(), relativePath);
}

export async function createDb(databasePath: string): Promise<DuckDBInstance> {
  const resolved: string = resolveFromRoot(databasePath);
  const instance: DuckDBInstance = await DuckDBInstance.create(resolved);
  trackInstance(instance);
  return instance;
}
