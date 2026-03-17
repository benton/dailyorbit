import { defineCommand } from 'citty';
import { rebuildIndexCommand } from './rebuild-index.ts';

export const searchCommand = defineCommand({
  meta: {
    name: 'search',
    description: 'Search index management',
  },
  subCommands: {
    'rebuild-index': rebuildIndexCommand,
  },
});
