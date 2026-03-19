import { defineCommand } from 'citty';
import { evalCommand } from './eval.ts';

export const queryCommand = defineCommand({
  meta: {
    name: 'query',
    description: 'Query pipeline management and evaluation',
  },
  subCommands: {
    eval: evalCommand,
  },
});
