import type { DuckDBConnection } from '@duckdb/node-api';
import { ensureDiscoverySnapshotTable } from './snapshot-repository.ts';

/** New columns for ICFS-sourced filing data and v0.1.6 enrichment */
const ICFS_COLUMNS: Array<[string, string]> = [
  ['icfs_sys_id', 'VARCHAR'],
  ['applicant_frn', 'VARCHAR'],
  ['applicant_street', 'VARCHAR'],
  ['applicant_city', 'VARCHAR'],
  ['applicant_state', 'VARCHAR'],
  ['applicant_zip_code', 'VARCHAR'],
  ['applicant_country', 'VARCHAR'],
  ['contact_street', 'VARCHAR'],
  ['contact_city', 'VARCHAR'],
  ['contact_state', 'VARCHAR'],
  ['contact_zip_code', 'VARCHAR'],
  ['contact_country', 'VARCHAR'],
  ['da_number', 'VARCHAR'],
  ['red_light_status', 'VARCHAR'],
  ['streamlined', 'VARCHAR'],
  ['environmental_impact', 'VARCHAR'],
  ['nature_of_service', 'VARCHAR'],
  ['brief_description', 'VARCHAR'],
  ['transferor_name', 'VARCHAR'],
  ['transferor_street', 'VARCHAR'],
  ['transferor_city', 'VARCHAR'],
  ['transferor_zip_code', 'VARCHAR'],
  ['transferee_name', 'VARCHAR'],
  ['transferee_street', 'VARCHAR'],
  ['transferee_city', 'VARCHAR'],
  ['transferee_zip_code', 'VARCHAR'],
  ['icfs_service_types', 'VARCHAR'],
  ['icfs_last_fetched_at', 'TIMESTAMP'],
];

/**
 * Add ICFS-specific columns to the filing table.
 * Safe to call multiple times — uses ADD COLUMN IF NOT EXISTS.
 */
export async function ensureIcfsColumns(conn: DuckDBConnection): Promise<void> {
  for (const [name, type] of ICFS_COLUMNS) {
    await conn.run(
      `ALTER TABLE filing ADD COLUMN IF NOT EXISTS "${name}" ${type}`,
    );
  }

  await ensureDiscoverySnapshotTable(conn);
}
