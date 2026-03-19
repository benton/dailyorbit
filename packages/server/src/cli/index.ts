import { defineCommand } from 'citty';
import { attachmentsCommand } from './attachments/index.ts';
import { companiesCommand } from './companies/index.ts';
import { configCommand } from './config/index.ts';
import { consultantCommand } from './consultant/index.ts';
import { dbCommand } from './db/index.ts';
import { inferenceCommand } from './inference/index.ts';
import { ingestCommand } from './ingest/index.ts';
import { newsCommand } from './news/index.ts';
import { queryCommand } from './query/index.ts';
import { searchCommand } from './search/index.ts';
import { serveCommand } from './serve/index.ts';
import { userCommand } from './user/index.ts';

export const main = defineCommand({
  meta: {
    name: 'daily-orbit',
    description: 'Daily Orbit — FCC filing explorer CLI',
  },
  subCommands: {
    attachments: attachmentsCommand,
    companies: companiesCommand,
    config: configCommand,
    consultant: consultantCommand,
    db: dbCommand,
    inference: inferenceCommand,
    ingest: ingestCommand,
    news: newsCommand,
    query: queryCommand,
    search: searchCommand,
    serve: serveCommand,
    user: userCommand,
  },
});
