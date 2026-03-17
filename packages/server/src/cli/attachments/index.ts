import { defineCommand } from 'citty';
import { discoverCommand } from './discover.ts';
import { downloadCommand } from './download.ts';
import { extractCommand } from './extract.ts';
import { extractCookiesCommand } from './extract-cookies.ts';
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
    'extract-cookies': extractCookiesCommand,
    sync: syncCommand,
    reset: resetCommand,
  },
});
