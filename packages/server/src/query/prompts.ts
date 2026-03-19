import type { TemplateVariable } from '../inference/prompts.ts';

// Variable catalogs for RAG query prompt templates.
// Shared between server (rendering) and frontend (admin UI help).

export const QUERY_REWRITE_VARIABLES: readonly TemplateVariable[] = [
  {
    name: 'question',
    source: 'User',
    description: "The user's original question (sent as user message)",
    example: 'What Ka-band applications has Hughes filed recently?',
  },
];

export const QUERY_GENERATE_VARIABLES: readonly TemplateVariable[] = [
  {
    name: 'question',
    source: 'User',
    description: "The user's original question",
    example: 'What Ka-band applications has Hughes filed recently?',
  },
  {
    name: 'context',
    source: 'Retrieval',
    description: 'Formatted source context block from retrieved documents',
    example:
      '[Source 1: filing \u2014 SAT-LOA-20240701-00011]\\nTitle: Hughes Ka-band\\n...',
  },
];
