import { defineCommand } from 'citty';
import { discoverCommand } from './discover.ts';
import { downloadCommand } from './download.ts';
import { extractCommand } from './extract.ts';
import { extractCookiesCommand } from './extract-cookies.ts';
import { loginCommand } from './login.ts';
import { resetCommand } from './reset.ts';
import { syncCommand } from './sync.ts';
import { testCookiesCommand } from './test-cookies.ts';
import { validateCommand } from './validate.ts';

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
    login: loginCommand,
    sync: syncCommand,
    'test-cookies': testCookiesCommand,
    validate: validateCommand,
    reset: resetCommand,
  },
});
