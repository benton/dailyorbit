import { defineCommand } from 'citty';
import { discoverCommand } from './discover.ts';
import { downloadCommand } from './download.ts';
import { resetCommand } from './reset.ts';
import { syncCommand } from './sync.ts';

export const attachmentsCommand = defineCommand({
  meta: {
    name: 'attachments',
    description: 'Attachment discovery and download commands',
  },
  subCommands: {
    discover: discoverCommand,
    download: downloadCommand,
    sync: syncCommand,
    reset: resetCommand,
  },
});
