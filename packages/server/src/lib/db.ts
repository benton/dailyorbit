import { DuckDBInstance } from '@duckdb/node-api';
import { DATABASE_URL } from './env.ts';
import { trackInstance } from './graceful-shutdown.ts';

let instance: DuckDBInstance | null = null;

export async function getDb(): Promise<DuckDBInstance> {
  if (instance == null) {
    instance = await DuckDBInstance.create(DATABASE_URL);
    trackInstance(instance);
  }
  return instance;
}
