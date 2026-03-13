export { parseDdl } from './ddl-parser.ts';
export { parseRecords, coerceValue } from './dat-parser.ts';
export {
  createTable,
  insertBatch,
  upsertBatch,
  generateCreateTableSql,
} from './loader.ts';
export { runIngest, loadTable, parseCountsManifest } from './pipeline.ts';
export {
  loadTableDefs,
  loadTableDefsFromDdl,
  createMetadataTables,
} from './schema.ts';
export type { TableDef, ColumnDef, DuckDbType } from './types.ts';
export type {
  IngestOptions,
  IngestResult,
  LoadTableResult,
  LoadTableOptions,
} from './pipeline.ts';
