import { defineCommand } from 'citty';
import { attachmentsCommand } from './attachments/index.ts';
import { configCommand } from './config/index.ts';
import { dbCommand } from './db/index.ts';
import { ingestCommand } from './ingest/index.ts';
import { serveCommand } from './serve.ts';

export const main = defineCommand({
  meta: {
    name: 'daily-orbit',
    description: 'Daily Orbit — FCC filing explorer CLI',
  },
  subCommands: {
    serve: serveCommand,
    config: configCommand,
    ingest: ingestCommand,
    attachments: attachmentsCommand,
    db: dbCommand,
  },
});
