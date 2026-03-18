import type { SummarizerConfig } from './types.ts';
import {
  CHUNK_USER_PROMPT,
  DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
  DEFAULT_SUMMARIZATION_USER_PROMPT,
  REDUCE_USER_PROMPT,
  SUMMARIZATION_VARIABLES,
} from '../prompts.ts';

/**
 * Summarizer configuration for FCC filing attachments.
 * Uses the existing 'summarization' config key prefix for backwards
 * compatibility — admin-customized prompts in the DB continue to work.
 */
export const FCC_ATTACHMENT_SUMMARIZER: SummarizerConfig = {
  typeId: 'fcc-attachment',
  displayName: 'FCC Filing Attachment',
  configKeyPrefix: 'summarization',
  variables: SUMMARIZATION_VARIABLES,
  defaultSystemPrompt: DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
  defaultUserPrompt: DEFAULT_SUMMARIZATION_USER_PROMPT,
  defaultChunkUserPrompt: CHUNK_USER_PROMPT,
  defaultReduceUserPrompt: REDUCE_USER_PROMPT,
};
