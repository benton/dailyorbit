import { defineCommand } from 'citty';
import { ibfsCommand } from './ibfs.ts';
import { icfsCommand } from './icfs.ts';

export const ingestCommand = defineCommand({
  meta: {
    name: 'ingest',
    description: 'Data ingestion commands',
  },
  subCommands: {
    ibfs: ibfsCommand,
    icfs: icfsCommand,
  },
});
