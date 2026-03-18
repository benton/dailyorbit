import type { TemplateVariable } from '../prompts.ts';
import type { SummarizerConfig } from './types.ts';

// ── Template variables for news article summarization ───────────────

export const NEWS_ARTICLE_VARIABLES: readonly TemplateVariable[] = [
  {
    name: 'sourceUrl',
    source: 'NewsItem',
    description: 'Original article URL',
    example: 'https://spacenews.com/spacex-starlink-batch/',
  },
  {
    name: 'sourceName',
    source: 'NewsSource',
    description: 'Name of the RSS feed source',
    example: 'SpaceNews',
  },
  {
    name: 'title',
    source: 'NewsItem',
    description: 'Article headline',
    example: 'SpaceX launches latest batch of Starlink satellites',
  },
  {
    name: 'author',
    source: 'NewsItem',
    description: 'Article author (if available)',
    example: 'Jeff Foust',
  },
  {
    name: 'publishedAt',
    source: 'NewsItem',
    description: 'Publication date',
    example: '2026-03-15',
  },
  {
    name: 'fullText',
    source: 'NewsItem',
    description: 'Full extracted article text (markdown)',
    example: '(article text)',
  },
  {
    name: 'tags',
    source: 'NewsItem',
    description: 'Comma-separated RSS categories/tags',
    example: 'spacex, starlink, launch',
  },
];

// ── Default prompts ─────────────────────────────────────────────────

const DEFAULT_NEWS_SYSTEM_PROMPT: string = `You are an analyst specializing in satellite communications and space industry news.
You produce concise, factual summaries for attorneys and business strategists tracking
the competitive landscape of satellite operators, spectrum policy, and launch providers.

Your tone is professional and neutral. Focus on industry impact: what happened, who is
affected, and what it means for competition, regulation, or market positioning.`;

const DEFAULT_NEWS_USER_PROMPT: string = `Summarize the following news article in one to two paragraphs.
Focus on: what happened, which companies or regulators are involved, and the
potential impact on the satellite communications industry.

Source: {{sourceName}}
Title: {{title}}
Author: {{author}}
Published: {{publishedAt}}
Tags: {{tags}}

--- Begin article text ---
{{{fullText}}}
--- End article text ---`;

const DEFAULT_NEWS_CHUNK_USER_PROMPT: string = `Summarize part {{chunkIndex}} of {{totalChunks}} of the following news article. This is a section of a larger article, so focus on capturing the substantive content in this section.

Source: {{sourceName}} | Title: {{title}} | Published: {{publishedAt}}

--- Begin section {{chunkIndex}} of {{totalChunks}} ---
{{{fullText}}}
--- End section ---`;

const DEFAULT_NEWS_REDUCE_USER_PROMPT: string = `The following are partial summaries of different sections of a single news article. Combine them into one cohesive summary of one to two paragraphs. Focus on: what happened, which companies or regulators are involved, and the potential impact on the satellite communications industry.

Source: {{sourceName}} | Title: {{title}} | Published: {{publishedAt}}

--- Partial summaries ---
{{{subSummaries}}}
--- End partial summaries ---`;

// ── Summarizer config ───────────────────────────────────────────────

/**
 * Summarizer configuration for news articles.
 * Uses the 'newsSummarization' config key prefix, adding new DB config keys:
 * - newsSummarizationModel
 * - newsSummarizationSystemPrompt
 * - newsSummarizationUserPrompt
 */
export const NEWS_ARTICLE_SUMMARIZER: SummarizerConfig = {
  typeId: 'news-article',
  displayName: 'News Article',
  configKeyPrefix: 'newsSummarization',
  variables: NEWS_ARTICLE_VARIABLES,
  defaultSystemPrompt: DEFAULT_NEWS_SYSTEM_PROMPT,
  defaultUserPrompt: DEFAULT_NEWS_USER_PROMPT,
  defaultChunkUserPrompt: DEFAULT_NEWS_CHUNK_USER_PROMPT,
  defaultReduceUserPrompt: DEFAULT_NEWS_REDUCE_USER_PROMPT,
};
