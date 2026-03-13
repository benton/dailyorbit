#!/usr/bin/env node --no-warnings

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDdl } from '../packages/server/src/ingest/ddl-parser.ts';

const ROOT: string = resolve(import.meta.dirname, '..');
const DDL_PATH: string = resolve(ROOT, 'tmp/ibfs-schema.txt');
const OUTPUT_PATH: string = resolve(ROOT, 'doc/ibfs-tables.json');

const ddl: string = readFileSync(DDL_PATH, 'utf-8');
const tables = parseDdl(ddl);

writeFileSync(OUTPUT_PATH, JSON.stringify(tables, null, 2) + '\n');

console.log(
  `Wrote ${String(tables.length)} table definitions to ${OUTPUT_PATH}`,
);

// Summary
for (const table of tables) {
  console.log(
    `  ${table.appName} (${table.datFile}): ${String(table.columns.length)} columns, PK: [${table.primaryKey.join(', ')}]`,
  );
}
