import { defineCommand } from 'citty';
import { checkpointCommand } from './checkpoint.ts';
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
    query: queryCommand,
    'remediate-html': remediateHtmlCommand,
    snapshot: snapshotCommand,
  },
});
