import type { TemplateVariable } from '../prompts.ts';

/**
 * Configuration for a summarization pipeline.
 * Each summarizer defines its own prompt templates and config key prefix,
 * allowing independent admin-configurable prompt sets per content type.
 */
export type SummarizerConfig = {
  /** Unique identifier, e.g. 'fcc-attachment' or 'news-article' */
  readonly typeId: string;
  /** Human-readable name for admin UI */
  readonly displayName: string;
  /** Prefix for DB config keys, e.g. 'summarization' maps to summarizationSystemPrompt */
  readonly configKeyPrefix: string;
  /** Template variables available in prompt templates */
  readonly variables: readonly TemplateVariable[];
  /** Default system prompt (used when no DB config override exists) */
  readonly defaultSystemPrompt: string;
  /** Default user prompt template (used when no DB config override exists) */
  readonly defaultUserPrompt: string;
  /** Default chunk user prompt for map-reduce on large documents */
  readonly defaultChunkUserPrompt: string;
  /** Default reduce user prompt for merging chunk summaries */
  readonly defaultReduceUserPrompt: string;
};
