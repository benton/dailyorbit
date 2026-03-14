import { defineCommand } from 'citty';
import { queryCommand } from './query.ts';

export const dbCommand = defineCommand({
  meta: {
    name: 'db',
    description: 'Database utility commands',
  },
  subCommands: {
    query: queryCommand,
  },
});
