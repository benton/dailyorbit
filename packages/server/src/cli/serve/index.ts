import { defineCommand } from 'citty';
import { serveApiCommand } from './api.ts';
import { serveHtmlCommand } from './html.ts';

export const serveCommand = defineCommand({
  meta: {
    name: 'serve',
    description: 'Start application servers',
  },
  subCommands: {
    api: serveApiCommand,
    html: serveHtmlCommand,
  },
});
