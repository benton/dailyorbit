import { DuckDBInstance } from '@duckdb/node-api';

const db = await DuckDBInstance.create('data/daily-orbit.duckdb');
const conn = await db.connect();

const result = await conn.run("SELECT filing_key, file_num FROM filing WHERE file_num LIKE '%SAT-STA-20230614-00142%' LIMIT 5");
const rows = result.getRows();
console.log('Filing search results:');
for (const row of rows) {
  console.log(row);
}

const sample = await conn.run("SELECT file_num FROM filing WHERE file_num LIKE 'SAT%' LIMIT 5");
const sampleRows = sample.getRows();
console.log('\nSample SAT file numbers:');
for (const row of sampleRows) {
  console.log(row);
}

await conn.close();
