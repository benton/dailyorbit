import { defineCommand } from 'citty';
import { embedCommand } from './embed.ts';
import { sampleSummarizeCommand } from './sample-summarize.ts';
import { summarizeCommand } from './summarize.ts';

export const inferenceCommand = defineCommand({
  meta: {
    name: 'inference',
    description: 'Inference and summarization commands',
  },
  subCommands: {
    embed: embedCommand,
    'sample-summarize': sampleSummarizeCommand,
    summarize: summarizeCommand,
  },
});
