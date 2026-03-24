import type { TemplateVariable } from '../inference/prompts.ts';

// ── Template variable catalog ───────────────────────────────────────

export const NEWSPAPER_COPY_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Monday, March 24, 2026',
  },
  {
    name: 'filingSummaries',
    description: 'Markdown list of recent notable filings with summaries',
    source: 'db query',
    example: '- SAT-LOA-20260324-00042: Hughes Network Systems filed...',
  },
  {
    name: 'newsSummaries',
    description: 'Markdown list of recent news headlines + summaries',
    source: 'db query',
    example: '- SpaceNews: Viasat announces...',
  },
];

// ── Default prompts ─────────────────────────────────────────────────

export const DEFAULT_DIGEST_SYSTEM_PROMPT: string = `You are the editor of "The Daily Orbit," a newspaper covering the US satellite communications regulatory landscape. Your writing style emulates early 20th century broadsheet journalism: authoritative, concise, and slightly formal. You write in the third person. You never use bullet points — everything is flowing prose organized into short paragraphs.

You produce a daily digest column called "3 Miles Up" that summarizes the day's most notable FCC filings and industry news for an audience of telecommunications attorneys and business strategists.`;

export const DEFAULT_DIGEST_USER_PROMPT: string = `Write today's "3 Miles Up" column for {{editionDate}}.

Today's notable filings:
{{{filingSummaries}}}

Recent industry news:
{{{newsSummaries}}}

Write 2-3 paragraphs. Reference specific file numbers and company names. Include links to Daily Orbit filing pages as [Company Name](/filings/FILE-NUMBER). At the bottom, include source attributions as "Source: [Publication Name](original-url)".`;

// ── Fake Ad template variables ─────────────────────────────────────

export const AD_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Monday, March 24, 2026',
  },
  {
    name: 'companyNames',
    description: 'List of real company names for inspiration',
    source: 'db query',
    example: '- Hughes Network Systems\n- SES S.A.',
  },
  {
    name: 'recentFilingTypes',
    description: 'Recent filing subsystem/type pairs',
    source: 'db query',
    example: '- SAT-LOA (Launch and Operate)\n- SES-MOD (Modification)',
  },
];

// ── Default fake ad prompts ────────────────────────────────────────

export const DEFAULT_AD_SYSTEM_PROMPT: string = `You are a copywriter for "The Daily Orbit" newspaper, specializing in tongue-in-cheek display advertisements that parody turn-of-the-century newspaper ads. Your ads are affectionate, never mean-spirited. They reference real satellite industry concepts but in an absurdly formal Victorian advertising voice.

Output a single advertisement in this exact markdown format:

# [COMPANY OR PRODUCT NAME]
## [Tagline in quotes]

[2-3 lines of flowery ad copy]

*Est. [year] · [City]*`;

export const DEFAULT_AD_USER_PROMPT: string = `Generate one fake display advertisement for today's edition ({{editionDate}}).

Use one of these real companies for inspiration (pick one, or invent a plausible fictional company):
{{{companyNames}}}

Recent filing activity for flavor:
{{{recentFilingTypes}}}

The ad should reference satellite industry concepts (Ka-band, orbital slots, earth stations, spectrum coordination) in an absurdly formal way. Keep it to 5-6 lines max.`;
