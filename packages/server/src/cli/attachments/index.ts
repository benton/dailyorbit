import { defineCommand } from 'citty';
import { discoverCommand } from './discover.ts';
import { downloadCommand } from './download.ts';
import { extractCommand } from './extract.ts';
import { resetCommand } from './reset.ts';
import { syncCommand } from './sync.ts';

export const attachmentsCommand = defineCommand({
  meta: {
    name: 'attachments',
    description: 'Attachment discovery, download, and extraction commands',
  },
  subCommands: {
    discover: discoverCommand,
    download: downloadCommand,
    extract: extractCommand,
    sync: syncCommand,
    reset: resetCommand,
  },
});
