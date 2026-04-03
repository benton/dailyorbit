import { defineCommand } from 'citty';
import { checkpointCommand } from './checkpoint.ts';
import { exportParquetCommand } from './export-parquet.ts';
import { importParquetCommand } from './import-parquet.ts';
import { localizeCommand } from './localize.ts';
import { queryCommand } from './query.ts';
import { remediateHtmlCommand } from './remediate-html.ts';
import { snapshotCommand } from './snapshot.ts';

export const dbCommand = defineCommand({
  meta: {
    name: 'db',
    description: 'Database utility commands',
  },
  subCommands: {
    checkpoint: checkpointCommand,
    'export-parquet': exportParquetCommand,
    'import-parquet': importParquetCommand,
    localize: localizeCommand,
    query: queryCommand,
    'remediate-html': remediateHtmlCommand,
    snapshot: snapshotCommand,
  },
});
