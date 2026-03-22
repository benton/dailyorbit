import { defineCommand } from 'citty';
import { rewindCommand } from './rewind.ts';

export const testCommand = defineCommand({
  meta: {
    name: 'test',
    description: 'Testing and debugging commands',
  },
  subCommands: {
    rewind: rewindCommand,
  },
});
