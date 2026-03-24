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

// ── Editorial template variables ─────────────────────────────────

export const EDITORIAL_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Monday, March 24, 2026',
  },
  {
    name: 'personaName',
    description: 'Name of the editorial persona',
    source: 'rotation',
    example: 'The Strategist',
  },
  {
    name: 'personaAngle',
    description: 'Editorial angle for this week',
    source: 'rotation',
    example: 'competitive dynamics',
  },
  {
    name: 'personaVoice',
    description: 'Voice description for the persona',
    source: 'rotation',
    example: 'analytical and sharp, focused on corporate maneuvering',
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

export const DEFAULT_EDITORIAL_SYSTEM_PROMPT: string = `You are {{personaName}}, a columnist for "The Daily Orbit" newspaper. Your editorial column is called "Over the Horizon." Your voice is {{personaVoice}}. You write with the authority of a seasoned industry observer.

Your angle this week is {{personaAngle}}. Frame your analysis through this lens, drawing connections between recent filings and broader industry trends. Write in flowing prose — no bullet points. Use short paragraphs.`;

export const DEFAULT_EDITORIAL_USER_PROMPT: string = `Write this week's "Over the Horizon" editorial column for the week of {{editionDate}}.

Recent notable filings (last 7 days):
{{{filingSummaries}}}

Recent industry news:
{{{newsSummaries}}}

Write 3-4 paragraphs of editorial analysis. End with a brief byline: "— {{personaName}}"`;

// ── Company Spotlight template variables ─────────────────────────

export const SPOTLIGHT_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Monday, March 24, 2026',
  },
  {
    name: 'companyName',
    description: 'Canonical company name',
    source: 'db query',
    example: 'Hughes Network Systems',
  },
  {
    name: 'companyId',
    description: 'Company ID for link generation',
    source: 'db query',
    example: '42',
  },
  {
    name: 'companyDescription',
    description: 'Company description if available',
    source: 'db query',
    example: 'A leading provider of satellite broadband services...',
  },
  {
    name: 'parentCompany',
    description: 'Parent company name if applicable',
    source: 'db query',
    example: 'EchoStar Corporation',
  },
  {
    name: 'recentFilings',
    description: 'Summary of recent filings by this company',
    source: 'db query',
    example: '- SAT-LOA-20260320-00001: Launch and operate...',
  },
  {
    name: 'aliases',
    description: 'Known aliases for this company',
    source: 'db query',
    example: 'HUGHES NETWORK SYSTEMS, LLC; HNS License Sub, LLC',
  },
];

export const DEFAULT_SPOTLIGHT_SYSTEM_PROMPT: string = `You are a business journalist for "The Daily Orbit" newspaper. You write company profiles in a factual, informative tone — think a brief Financial Times company overview. Focus on what the company does in the satellite communications space and its recent regulatory activity.`;

export const DEFAULT_SPOTLIGHT_USER_PROMPT: string = `Write a company spotlight for this week's edition ({{editionDate}}).

Company: {{companyName}}
Company page: [{{companyName}}](/companies/{{companyId}})
Description: {{companyDescription}}
Parent company: {{parentCompany}}
Known aliases: {{aliases}}

Recent filings:
{{{recentFilings}}}

Write 2-3 paragraphs profiling this company's role in the industry and recent activity. Include a link to the company page.`;

// ── Orbital Forecast template variables ──────────────────────────

export const FORECAST_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Monday, March 24, 2026',
  },
  {
    name: 'filingStats',
    description: 'Filing volume this week vs 90-day average by subsystem',
    source: 'db query',
    example: 'SAT: 12 this week (avg 8.3, +44%)',
  },
  {
    name: 'companyActivity',
    description: 'Notable company filing activity',
    source: 'db query',
    example: 'SpaceX: 5 filings (3 STA, 2 MOD)',
  },
];

export const DEFAULT_FORECAST_SYSTEM_PROMPT: string = `You are a data analyst for "The Daily Orbit" newspaper. You write the weekly "Orbital Forecast" column — a brief, numbers-driven analysis of filing trends. Your tone is authoritative and precise. You reference specific numbers and percentages. Write in flowing prose — no bullet points.`;

export const DEFAULT_FORECAST_USER_PROMPT: string = `Write this week's "Orbital Forecast" column for the week of {{editionDate}}.

Filing volume this week vs. 90-day average:
{{{filingStats}}}

Notable company activity:
{{{companyActivity}}}

Write 1-2 paragraphs highlighting the most notable trends. Use specific numbers and percentages. Reference company names and filing types.`;

// ── Classifieds template variables ───────────────────────────────

export const CLASSIFIEDS_VARIABLES: ReadonlyArray<TemplateVariable> = [
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
    example: '- SAT-LOA\n- SES-MOD',
  },
];

export const DEFAULT_CLASSIFIEDS_SYSTEM_PROMPT: string = `You are a classified ads editor for "The Daily Orbit" newspaper. You write tongue-in-cheek classified advertisements that parody real newspaper classifieds but reference satellite industry concepts. Your ads are affectionate and humorous, never mean-spirited.`;

export const DEFAULT_CLASSIFIEDS_USER_PROMPT: string = `Generate 7 fake classified ads for "The Daily Orbit" newspaper, one for each day this week.

Use these real data points for inspiration:
Companies: {{{companyNames}}}
Filing types: {{{recentFilingTypes}}}
Frequency bands: Ka-band, Ku-band, C-band, V-band, S-band

Each ad should be 2-3 lines in this format:
**[CATEGORY]** — [Ad text]. Contact: [fictional contact].

Categories: FOR SALE, WANTED, SERVICES, POSITIONS AVAILABLE, LOST & FOUND

Be creative and humorous. Reference real satellite industry concepts in absurd ways.`;
