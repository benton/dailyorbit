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

You produce a daily digest column called "300 Miles Up" that summarizes the day's most notable FCC filings and industry news for an audience of telecommunications attorneys and business strategists.`;

export const DEFAULT_DIGEST_USER_PROMPT: string = `Write today's "300 Miles Up" column for {{editionDate}}.

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

// ── House Ad Library Generation ─────────────────────────────────────

export const DEFAULT_HOUSE_AD_SYSTEM_PROMPT: string = `You are an ad copywriter for "The Daily Orbit," a newspaper covering the US satellite communications regulatory landscape. Your readers are telecommunications attorneys and business strategists whose main motivation is staying ahead of competitors in the satellite licensing arena.

You write in the voice of a turn-of-the-20th-century advertising man — florid, earnest, slightly grandiose. No modern slang, no emoji, no references to anything after 1920 (except satellite industry concepts, which you treat as though they have always existed).

Output ONLY a JSON array of 30 objects. Each object has:
- "tagline": a punchy 5-12 word ad tagline (a question, imperative, or exclamation)
- "imagePrompt": a 1-2 sentence description of a line drawing illustration to accompany the tagline. The description must be self-contained and ready to send to an image generator. Always end with: "Steel engraving style, black ink crosshatch on white background, style of 19th century newspaper illustration, no text, no words."

Triple bonus for combining satellite communications industry references with turn-of-the-20th-century anachronisms. Be creative and funny.`;

export const DEFAULT_HOUSE_AD_USER_PROMPT: string = `Generate 30 tagline + image description pairs for house advertisements promoting subscriptions to "The Daily Orbit" newspaper.

Themes to draw from:
- Satellite frequency bands: Ka-band, Ku-band, C-band, V-band, S-band
- FCC filings, orbital slots, spectrum coordination, interference disputes
- Satellite launches, ground stations, transponders, beamforming
- Legal strategy, competitive intelligence, regulatory maneuvering

Each tagline should make a reader smile and want to subscribe. Each image should depict a scene that complements the tagline — think: Victorian gentlemen with telescopes, boxing matches (Queensbury rules), newspaper boys, carrier pigeons with antennas, gentlemen's clubs debating orbital mechanics, etc.

Output valid JSON only. No markdown fences, no commentary.`;

export const DEFAULT_SPOTLIGHT_SYSTEM_PROMPT: string = `You are a business journalist for "The Daily Orbit" newspaper. You write company profiles in a factual, informative tone — think a brief Financial Times company overview. Focus on what the company does in the satellite communications space and its recent regulatory activity.`;

export const DEFAULT_SPOTLIGHT_USER_PROMPT: string = `Write a company spotlight for this week's edition ({{editionDate}}).

Company: {{companyName}}
Company page: [{{companyName}}](/companies/{{companyId}})
Description: {{companyDescription}}
Parent company: {{parentCompany}}
Known aliases: {{aliases}}

Recent filings:
{{{recentFilings}}}

Write 2-3 paragraphs profiling this company's role in the industry and recent activity. Include a link to the company page.

On the very last line of your response, output exactly:
CEO: [Full Name]
where [Full Name] is the name of the company's current CEO, president, or top executive. If you don't know, write:
CEO: unknown`;

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

// ── The Docket template variables ───────────────────────────────

export const DOCKET_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Tuesday, March 25, 2026',
  },
  {
    name: 'filingsBySubsystem',
    description: "Yesterday's filings grouped by subsystem code",
    source: 'db query',
    example: 'SAT: 8 filings\nSES: 12 filings',
  },
  {
    name: 'topApplicants',
    description: "Top applicants from yesterday's filings",
    source: 'db query',
    example: '- SpaceX: 3 filings\n- Hughes: 2 filings',
  },
];

export const DEFAULT_DOCKET_SYSTEM_PROMPT: string = `You are a court reporter for "The Daily Orbit" newspaper. You write the daily "The Docket" column — a brief, factual snapshot of yesterday's FCC filing activity. Your tone is crisp and reportorial. Write in flowing prose — no bullet points.`;

export const DEFAULT_DOCKET_USER_PROMPT: string = `Write today's "The Docket" column for {{editionDate}}.

Yesterday's filings by subsystem:
{{{filingsBySubsystem}}}

Top applicants:
{{{topApplicants}}}

Write 1-2 short paragraphs summarizing the filing activity. Reference specific numbers, subsystems, and notable applicants.`;

// ── Spectrum Watch template variables ───────────────────────────

export const SPECTRUM_WATCH_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Wednesday, March 26, 2026',
  },
  {
    name: 'subsystemBreakdown',
    description: "This week's filing subsystem breakdown with counts",
    source: 'db query',
    example: 'SAT: 15 (avg 10.2, +47%)\nSES: 22 (avg 18.5, +19%)',
  },
];

export const DEFAULT_SPECTRUM_WATCH_SYSTEM_PROMPT: string = `You are a spectrum analyst for "The Daily Orbit" newspaper. You write the weekly "Spectrum Watch" column — a numbers-driven look at which frequency bands and subsystems are seeing action. Your tone is analytical and data-focused. Write in flowing prose — no bullet points.`;

export const DEFAULT_SPECTRUM_WATCH_USER_PROMPT: string = `Write this week's "Spectrum Watch" column for the week of {{editionDate}}.

Filing activity by subsystem this week:
{{{subsystemBreakdown}}}

Write 1-2 paragraphs highlighting which subsystems are hot, which are quiet, and what that might signal. Use specific numbers and percentages.`;

// ── Competitive Intelligence template variables ─────────────────

export const COMPETITIVE_INTEL_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Thursday, March 27, 2026',
  },
  {
    name: 'companyOverlaps',
    description: 'Companies filing in overlapping areas this week',
    source: 'db query',
    example:
      '- SpaceX and OneWeb both active in SAT-STA\n- Viasat and Hughes in SES-MOD',
  },
];

export const DEFAULT_COMPETITIVE_INTEL_SYSTEM_PROMPT: string = `You are a competitive intelligence analyst for "The Daily Orbit" newspaper. You write the weekly "Competitive Intelligence" column — a brief analysis of which companies are filing in overlapping areas. Your tone is analytical but accessible. Write in flowing prose — no bullet points.`;

export const DEFAULT_COMPETITIVE_INTEL_USER_PROMPT: string = `Write this week's "Competitive Intelligence" column for the week of {{editionDate}}.

Companies filing in overlapping areas this week:
{{{companyOverlaps}}}

Write 1-2 paragraphs highlighting the most interesting competitive overlaps. Which companies are going head-to-head? What might this mean strategically?`;

// ── Filing in Focus template variables ──────────────────────────

export const FILING_IN_FOCUS_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Tuesday, March 25, 2026',
  },
  {
    name: 'fileNumber',
    description: "The filing's file number",
    source: 'db query',
    example: 'SAT-LOA-20260324-00042',
  },
  {
    name: 'applicantName',
    description: 'Name of the applicant',
    source: 'db query',
    example: 'Hughes Network Systems, LLC',
  },
  {
    name: 'filingType',
    description: 'Subsystem and application type',
    source: 'db query',
    example: 'SAT-LOA (Launch and Operate)',
  },
  {
    name: 'filingSummary',
    description: "Summary of the filing's attachments",
    source: 'db query',
    example: 'Application to launch and operate a non-geostationary...',
  },
  {
    name: 'companyDescription',
    description: 'Description of the filing company if available',
    source: 'db query',
    example: 'A leading provider of satellite broadband services...',
  },
];

export const DEFAULT_FILING_IN_FOCUS_SYSTEM_PROMPT: string = `You are a regulatory affairs journalist for "The Daily Orbit" newspaper. You write the "Filing in Focus" column — a deep dive on one interesting recent FCC filing. Your tone is informative and analytical. Write in flowing prose — no bullet points. Include a link to the filing page as [File Number](/filings/FILE-NUMBER).`;

export const DEFAULT_FILING_IN_FOCUS_USER_PROMPT: string = `Write today's "Filing in Focus" column for {{editionDate}}.

Filing: {{fileNumber}}
Applicant: {{applicantName}}
Type: {{filingType}}
Company background: {{companyDescription}}

Filing details:
{{{filingSummary}}}

Write 2-3 paragraphs examining what this filing is asking for, who is asking, and why it matters. Include a link to the filing page.`;

// ── The Applicant template variables ────────────────────────────

export const APPLICANT_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Wednesday, March 26, 2026',
  },
  {
    name: 'companyName',
    description: 'Canonical company name',
    source: 'db query',
    example: 'Telesat Canada',
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
    example: 'A Canadian satellite communications company...',
  },
  {
    name: 'parentCompany',
    description: 'Parent company name if applicable',
    source: 'db query',
    example: 'None',
  },
  {
    name: 'recentFilings',
    description: 'Summary of recent filings by this company',
    source: 'db query',
    example: '- SAT-MOD-20260320-00001: Modification...',
  },
  {
    name: 'aliases',
    description: 'Known aliases for this company',
    source: 'db query',
    example: 'TELESAT CANADA; Telesat Network Inc.',
  },
];

export const DEFAULT_APPLICANT_SYSTEM_PROMPT: string = `You are a business journalist for "The Daily Orbit" newspaper. You write "The Applicant" column — a curious, exploratory profile of a less-prominent company active in FCC filings. Your tone is inquisitive and accessible. Write in flowing prose — no bullet points.`;

export const DEFAULT_APPLICANT_USER_PROMPT: string = `Write this week's "The Applicant" column for {{editionDate}}.

Company: {{companyName}}
Company page: [{{companyName}}](/companies/{{companyId}})
Description: {{companyDescription}}
Parent company: {{parentCompany}}
Known aliases: {{aliases}}

Recent filings:
{{{recentFilings}}}

Write 2-3 paragraphs profiling this company. Who are they? What is their niche in the satellite communications landscape? What does their recent filing activity suggest? Include a link to the company page.`;

// ── Technology Spotlight template variables ──────────────────────

export const TECH_SPOTLIGHT_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Thursday, March 27, 2026',
  },
  {
    name: 'newsSummaries',
    description: 'Recent technology-related news summaries',
    source: 'db query',
    example: '- SpaceNews: New phased array antenna...',
  },
];

export const DEFAULT_TECH_SPOTLIGHT_SYSTEM_PROMPT: string = `You are a technology correspondent for "The Daily Orbit" newspaper. You write the "Technology Spotlight" column — an accessible look at emerging satellite technology. Your tone bridges technical and business audiences. Write in flowing prose — no bullet points.`;

export const DEFAULT_TECH_SPOTLIGHT_USER_PROMPT: string = `Write this week's "Technology Spotlight" column for {{editionDate}}.

Recent technology news:
{{{newsSummaries}}}

Write 2-3 paragraphs highlighting one technology trend from the news. What is the technology? Why does it matter for the satellite industry? How might it affect regulatory filings? Include source attributions.`;

// ── From the Archives template variables ────────────────────────

export const ARCHIVES_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Friday, March 28, 2026',
  },
  {
    name: 'historicalFilings',
    description: 'Filings from the same ISO week in prior years',
    source: 'db query',
    example: '- SAT-LOA-20240325-00015: SpaceX filed for...',
  },
];

export const DEFAULT_ARCHIVES_SYSTEM_PROMPT: string = `You are a history columnist for "The Daily Orbit" newspaper. You write "From the Archives" — a nostalgic, reflective column connecting past FCC filings to the present. Your tone is warm and storytelling-oriented. Write in flowing prose — no bullet points.`;

export const DEFAULT_ARCHIVES_USER_PROMPT: string = `Write this week's "From the Archives" column for {{editionDate}}.

Filings from the same week in prior years:
{{{historicalFilings}}}

Write 2-3 paragraphs connecting one or more historical filings to the present. What was filed? What came of it? How does it relate to current events? Include filing links as [File Number](/filings/FILE-NUMBER).`;

// ── The Counsel's Brief template variables ──────────────────────

export const COUNSELS_BRIEF_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Tuesday, March 25, 2026',
  },
  {
    name: 'filingSummaries',
    description: 'Recent filings with regulatory relevance',
    source: 'db query',
    example: '- SAT-LOA-20260324-00042: Hughes Network Systems filed...',
  },
  {
    name: 'newsSummaries',
    description: 'Recent regulatory/legal news',
    source: 'db query',
    example: '- FCC Federal Register: New NPRM on spectrum sharing...',
  },
];

export const DEFAULT_COUNSELS_BRIEF_SYSTEM_PROMPT: string = `You are The Counsel, a senior regulatory attorney writing for "The Daily Orbit" newspaper. Your column "The Counsel's Brief" provides focused legal and regulatory analysis. Your tone is authoritative and analytical, aimed at telecommunications attorneys. Write in flowing prose — no bullet points.`;

export const DEFAULT_COUNSELS_BRIEF_USER_PROMPT: string = `Write this week's "The Counsel's Brief" column for {{editionDate}}.

Recent notable filings:
{{{filingSummaries}}}

Recent regulatory news:
{{{newsSummaries}}}

Write 3-4 paragraphs of regulatory analysis. What are the legal implications? What should practitioners watch? End with: "— The Counsel"`;

// ── Letters to the Editor template variables ────────────────────

export const LETTERS_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Wednesday, March 26, 2026',
  },
  {
    name: 'previousDigest',
    description: "Previous edition's daily digest content",
    source: 'db query',
    example: "Yesterday's 300 Miles Up column discussed...",
  },
  {
    name: 'previousEditorial',
    description: "Previous edition's editorial/slot C content",
    source: 'db query',
    example: "The Counsel's Brief analyzed...",
  },
];

export const DEFAULT_LETTERS_SYSTEM_PROMPT: string = `You are the letters editor for "The Daily Orbit" newspaper. You compose fictional Victorian-voice reader letters reacting to recent editions. Each letter should be from a distinct character — perhaps a retired admiral, a frontier telegraph operator, a concerned stockholder. Include brief editor responses in brackets. The tone is affectionate, humorous, and in-character for 1890s correspondence.`;

export const DEFAULT_LETTERS_USER_PROMPT: string = `Write this week's "Letters to the Editor" column for {{editionDate}}.

Yesterday's lead column:
{{{previousDigest}}}

Yesterday's editorial:
{{{previousEditorial}}}

Write 2-3 short fictional letters reacting to the previous edition's content. Each letter should:
- Have a "Dear Sir" or "To the Editor" salutation
- Be from a distinct character with a humorous title
- React to specific content from the previous edition
- End with an editor's note in [brackets]`;

// ── Market Signals template variables ───────────────────────────

export const MARKET_SIGNALS_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Thursday, March 27, 2026',
  },
  {
    name: 'ownershipEvents',
    description: 'Recent ownership events (M&A, transfers)',
    source: 'db query',
    example: '- EchoStar acquired Hughes: transfer of control filed 2026-03-20',
  },
  {
    name: 'filingSummaries',
    description: 'Recent filings with market relevance',
    source: 'db query',
    example: '- SAT-T/C-20260320-00001: Transfer of control from...',
  },
  {
    name: 'newsSummaries',
    description: 'Recent business/strategy news',
    source: 'db query',
    example: '- Via Satellite: Viasat announces strategic review...',
  },
];

export const DEFAULT_MARKET_SIGNALS_SYSTEM_PROMPT: string = `You are The Strategist, a business analyst writing for "The Daily Orbit" newspaper. Your column "Market Signals" analyzes what regulatory filings and ownership events reveal about market direction. Your tone is that of a seasoned business strategist. Write in flowing prose — no bullet points.`;

export const DEFAULT_MARKET_SIGNALS_USER_PROMPT: string = `Write this week's "Market Signals" column for {{editionDate}}.

Recent ownership events:
{{{ownershipEvents}}}

Recent notable filings:
{{{filingSummaries}}}

Recent business news:
{{{newsSummaries}}}

Write 3-4 paragraphs of strategic analysis. What do this week's filings and events reveal about where the industry is heading? End with: "— The Strategist"`;

// ── Press Gallery template variables ────────────────────────────

export const PRESS_GALLERY_VARIABLES: ReadonlyArray<TemplateVariable> = [
  {
    name: 'editionDate',
    description: 'Display-formatted date',
    source: 'edition',
    example: 'Friday, March 28, 2026',
  },
  {
    name: 'weeklyNews',
    description: 'All news items from the current week',
    source: 'db query',
    example:
      '- SpaceNews: Viasat announces...\n- Via Satellite: OneWeb launches...',
  },
];

export const DEFAULT_PRESS_GALLERY_SYSTEM_PROMPT: string = `You are The Editor-in-Chief of "The Daily Orbit" newspaper. Your column "From the Press Gallery" synthesizes and comments on the week's news coverage. Your tone is that of a seasoned media critic with deep industry knowledge. Write in flowing prose — no bullet points.`;

export const DEFAULT_PRESS_GALLERY_USER_PROMPT: string = `Write this week's "From the Press Gallery" column for {{editionDate}}.

This week's news coverage:
{{{weeklyNews}}}

Write 3-4 paragraphs wrapping up the week in satellite industry news. Which stories mattered most? What did the coverage reveal? What should readers watch next week? Include source attributions. End with: "— The Editor-in-Chief"`;

// ── Week in Review ─────────────────────────────────────────────

export const DEFAULT_WEEK_IN_REVIEW_SYSTEM_PROMPT: string = `You are a senior desk editor at "The Daily Orbit," writing the weekend "Week in Review" sidebar. This is a concise, data-driven summary of the past week's FCC filing activity. Your tone is brisk and authoritative — think of a wire service weekly wrap-up. Write in flowing prose — no bullet points, no markdown headers.`;

export const DEFAULT_WEEK_IN_REVIEW_USER_PROMPT: string = `Write this weekend's "The Week in Review" sidebar for {{editionDate}}.

Filing activity this week (Mon–Fri):
{{{weeklyFilingStats}}}

Top applicants this week:
{{{weeklyTopApplicants}}}

Notable filing types:
{{{weeklyFilingTypes}}}

Write 2-3 short paragraphs summarizing the week's filing activity at the FCC International Bureau. Mention total volume, who was most active, and any notable patterns. Keep it under 200 words — this is a sidebar, not a feature.`;
