import { defineCommand } from 'citty';
import { sampleSummarizeCommand } from './sample-summarize.ts';
import { summarizeCommand } from './summarize.ts';

export const inferenceCommand = defineCommand({
  meta: {
    name: 'inference',
    description: 'Inference and summarization commands',
  },
  subCommands: {
    'sample-summarize': sampleSummarizeCommand,
    summarize: summarizeCommand,
  },
});
