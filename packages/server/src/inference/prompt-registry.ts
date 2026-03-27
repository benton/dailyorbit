import type { TemplateVariable } from './prompts.ts';
import {
  DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
  DEFAULT_SUMMARIZATION_USER_PROMPT,
  SUMMARIZATION_VARIABLES,
} from './prompts.ts';
import { NEWS_ARTICLE_SUMMARIZER } from './summarizers/news-article.ts';
import { DEFAULT_REWRITE_SYSTEM_PROMPT } from '../query/rewrite.ts';
import {
  DEFAULT_GENERATE_SYSTEM_PROMPT,
  DEFAULT_GENERATE_USER_PROMPT,
} from '../query/generate.ts';
import {
  QUERY_REWRITE_VARIABLES,
  QUERY_GENERATE_VARIABLES,
} from '../query/prompts.ts';
import {
  AD_VARIABLES,
  APPLICANT_VARIABLES,
  ARCHIVES_VARIABLES,
  CLASSIFIEDS_VARIABLES,
  COMPETITIVE_INTEL_VARIABLES,
  COUNSELS_BRIEF_VARIABLES,
  DEFAULT_AD_SYSTEM_PROMPT,
  DEFAULT_AD_USER_PROMPT,
  DEFAULT_APPLICANT_SYSTEM_PROMPT,
  DEFAULT_APPLICANT_USER_PROMPT,
  DEFAULT_ARCHIVES_SYSTEM_PROMPT,
  DEFAULT_ARCHIVES_USER_PROMPT,
  DEFAULT_CLASSIFIEDS_SYSTEM_PROMPT,
  DEFAULT_CLASSIFIEDS_USER_PROMPT,
  DEFAULT_COMPETITIVE_INTEL_SYSTEM_PROMPT,
  DEFAULT_COMPETITIVE_INTEL_USER_PROMPT,
  DEFAULT_COUNSELS_BRIEF_SYSTEM_PROMPT,
  DEFAULT_COUNSELS_BRIEF_USER_PROMPT,
  DEFAULT_DIGEST_SYSTEM_PROMPT,
  DEFAULT_DIGEST_USER_PROMPT,
  DEFAULT_EDITORIAL_SYSTEM_PROMPT,
  DEFAULT_EDITORIAL_USER_PROMPT,
  DEFAULT_FILING_IN_FOCUS_SYSTEM_PROMPT,
  DEFAULT_FILING_IN_FOCUS_USER_PROMPT,
  DEFAULT_FORECAST_SYSTEM_PROMPT,
  DEFAULT_FORECAST_USER_PROMPT,
  DEFAULT_LETTERS_SYSTEM_PROMPT,
  DEFAULT_LETTERS_USER_PROMPT,
  DEFAULT_MARKET_SIGNALS_SYSTEM_PROMPT,
  DEFAULT_MARKET_SIGNALS_USER_PROMPT,
  DEFAULT_PRESS_GALLERY_SYSTEM_PROMPT,
  DEFAULT_PRESS_GALLERY_USER_PROMPT,
  DEFAULT_SPOTLIGHT_SYSTEM_PROMPT,
  DEFAULT_SPOTLIGHT_USER_PROMPT,
  DEFAULT_SPECTRUM_WATCH_SYSTEM_PROMPT,
  DEFAULT_SPECTRUM_WATCH_USER_PROMPT,
  DEFAULT_TECH_SPOTLIGHT_SYSTEM_PROMPT,
  DEFAULT_TECH_SPOTLIGHT_USER_PROMPT,
  DEFAULT_DOCKET_SYSTEM_PROMPT,
  DEFAULT_DOCKET_USER_PROMPT,
  DOCKET_VARIABLES,
  EDITORIAL_VARIABLES,
  FILING_IN_FOCUS_VARIABLES,
  FORECAST_VARIABLES,
  LETTERS_VARIABLES,
  MARKET_SIGNALS_VARIABLES,
  NEWSPAPER_COPY_VARIABLES,
  PRESS_GALLERY_VARIABLES,
  SPECTRUM_WATCH_VARIABLES,
  SPOTLIGHT_VARIABLES,
  TECH_SPOTLIGHT_VARIABLES,
} from '../newspaper/prompts.ts';

// ── Types ──────────────────────────────────────────────────────────

export type PromptSetCategory = 'pipeline' | 'query' | 'newspaper';

export type PromptSetDef = {
  slug: string;
  displayName: string;
  category: PromptSetCategory;
  systemPromptKey: string;
  userPromptKey: string;
  defaultSystemPrompt: string;
  defaultUserPrompt: string;
  variables: ReadonlyArray<TemplateVariable>;
};

// ── Registry ───────────────────────────────────────────────────────

export const PROMPT_REGISTRY: ReadonlyArray<PromptSetDef> = [
  // ── Pipeline ───────────────────────────────────────────────────
  {
    slug: 'summarization',
    displayName: 'Attachment Summarization',
    category: 'pipeline',
    systemPromptKey: 'summarizationSystemPrompt',
    userPromptKey: 'summarizationUserPrompt',
    defaultSystemPrompt: DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_SUMMARIZATION_USER_PROMPT,
    variables: SUMMARIZATION_VARIABLES,
  },
  {
    slug: 'news-summarization',
    displayName: 'News Summarization',
    category: 'pipeline',
    systemPromptKey: 'newsSummarizationSystemPrompt',
    userPromptKey: 'newsSummarizationUserPrompt',
    defaultSystemPrompt: NEWS_ARTICLE_SUMMARIZER.defaultSystemPrompt,
    defaultUserPrompt: NEWS_ARTICLE_SUMMARIZER.defaultUserPrompt,
    variables: NEWS_ARTICLE_SUMMARIZER.variables,
  },

  // ── Query (RAG) ────────────────────────────────────────────────
  {
    slug: 'query-rewrite',
    displayName: 'Query Rewrite',
    category: 'query',
    systemPromptKey: 'queryRewriteSystemPrompt',
    userPromptKey: '',
    defaultSystemPrompt: DEFAULT_REWRITE_SYSTEM_PROMPT,
    defaultUserPrompt: '',
    variables: QUERY_REWRITE_VARIABLES,
  },
  {
    slug: 'query-generate',
    displayName: 'Query Answer Generation',
    category: 'query',
    systemPromptKey: 'queryGenerateSystemPrompt',
    userPromptKey: 'queryGenerateUserPrompt',
    defaultSystemPrompt: DEFAULT_GENERATE_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_GENERATE_USER_PROMPT,
    variables: QUERY_GENERATE_VARIABLES,
  },

  // ── Newspaper — Daily ──────────────────────────────────────────
  {
    slug: 'newspaper-daily-digest',
    displayName: 'Daily Digest (300 Miles Up)',
    category: 'newspaper',
    systemPromptKey: 'newspaperCopySystemPrompt',
    userPromptKey: 'newspaperCopyUserPrompt',
    defaultSystemPrompt: DEFAULT_DIGEST_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_DIGEST_USER_PROMPT,
    variables: NEWSPAPER_COPY_VARIABLES,
  },
  {
    slug: 'newspaper-fake-ad',
    displayName: 'Fake Ad',
    category: 'newspaper',
    systemPromptKey: 'newspaperAdSystemPrompt',
    userPromptKey: 'newspaperAdUserPrompt',
    defaultSystemPrompt: DEFAULT_AD_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_AD_USER_PROMPT,
    variables: AD_VARIABLES,
  },
  {
    slug: 'newspaper-classifieds',
    displayName: 'Classifieds',
    category: 'newspaper',
    systemPromptKey: 'newspaperClassifiedsSystemPrompt',
    userPromptKey: 'newspaperClassifiedsUserPrompt',
    defaultSystemPrompt: DEFAULT_CLASSIFIEDS_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_CLASSIFIEDS_USER_PROMPT,
    variables: CLASSIFIEDS_VARIABLES,
  },

  // ── Newspaper — Slot A ─────────────────────────────────────────
  {
    slug: 'newspaper-orbital-forecast',
    displayName: 'Orbital Forecast',
    category: 'newspaper',
    systemPromptKey: 'newspaperForecastSystemPrompt',
    userPromptKey: 'newspaperForecastUserPrompt',
    defaultSystemPrompt: DEFAULT_FORECAST_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_FORECAST_USER_PROMPT,
    variables: FORECAST_VARIABLES,
  },
  {
    slug: 'newspaper-the-docket',
    displayName: 'The Docket',
    category: 'newspaper',
    systemPromptKey: 'newspaperDocketSystemPrompt',
    userPromptKey: 'newspaperDocketUserPrompt',
    defaultSystemPrompt: DEFAULT_DOCKET_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_DOCKET_USER_PROMPT,
    variables: DOCKET_VARIABLES,
  },
  {
    slug: 'newspaper-spectrum-watch',
    displayName: 'Spectrum Watch',
    category: 'newspaper',
    systemPromptKey: 'newspaperSpectrumWatchSystemPrompt',
    userPromptKey: 'newspaperSpectrumWatchUserPrompt',
    defaultSystemPrompt: DEFAULT_SPECTRUM_WATCH_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_SPECTRUM_WATCH_USER_PROMPT,
    variables: SPECTRUM_WATCH_VARIABLES,
  },
  {
    slug: 'newspaper-competitive-intel',
    displayName: 'Competitive Intelligence',
    category: 'newspaper',
    systemPromptKey: 'newspaperCompetitiveIntelSystemPrompt',
    userPromptKey: 'newspaperCompetitiveIntelUserPrompt',
    defaultSystemPrompt: DEFAULT_COMPETITIVE_INTEL_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_COMPETITIVE_INTEL_USER_PROMPT,
    variables: COMPETITIVE_INTEL_VARIABLES,
  },

  // ── Newspaper — Slot B ─────────────────────────────────────────
  {
    slug: 'newspaper-company-spotlight',
    displayName: 'Company Spotlight',
    category: 'newspaper',
    systemPromptKey: 'newspaperSpotlightSystemPrompt',
    userPromptKey: 'newspaperSpotlightUserPrompt',
    defaultSystemPrompt: DEFAULT_SPOTLIGHT_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_SPOTLIGHT_USER_PROMPT,
    variables: SPOTLIGHT_VARIABLES,
  },
  {
    slug: 'newspaper-filing-in-focus',
    displayName: 'Filing in Focus',
    category: 'newspaper',
    systemPromptKey: 'newspaperFilingInFocusSystemPrompt',
    userPromptKey: 'newspaperFilingInFocusUserPrompt',
    defaultSystemPrompt: DEFAULT_FILING_IN_FOCUS_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_FILING_IN_FOCUS_USER_PROMPT,
    variables: FILING_IN_FOCUS_VARIABLES,
  },
  {
    slug: 'newspaper-the-applicant',
    displayName: 'The Applicant',
    category: 'newspaper',
    systemPromptKey: 'newspaperApplicantSystemPrompt',
    userPromptKey: 'newspaperApplicantUserPrompt',
    defaultSystemPrompt: DEFAULT_APPLICANT_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_APPLICANT_USER_PROMPT,
    variables: APPLICANT_VARIABLES,
  },
  {
    slug: 'newspaper-tech-spotlight',
    displayName: 'Technology Spotlight',
    category: 'newspaper',
    systemPromptKey: 'newspaperTechSpotlightSystemPrompt',
    userPromptKey: 'newspaperTechSpotlightUserPrompt',
    defaultSystemPrompt: DEFAULT_TECH_SPOTLIGHT_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_TECH_SPOTLIGHT_USER_PROMPT,
    variables: TECH_SPOTLIGHT_VARIABLES,
  },
  {
    slug: 'newspaper-from-the-archives',
    displayName: 'From the Archives',
    category: 'newspaper',
    systemPromptKey: 'newspaperArchivesSystemPrompt',
    userPromptKey: 'newspaperArchivesUserPrompt',
    defaultSystemPrompt: DEFAULT_ARCHIVES_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_ARCHIVES_USER_PROMPT,
    variables: ARCHIVES_VARIABLES,
  },

  // ── Newspaper — Slot C ─────────────────────────────────────────
  {
    slug: 'newspaper-editorial',
    displayName: 'Editorial (Over the Horizon)',
    category: 'newspaper',
    systemPromptKey: 'newspaperEditorialSystemPrompt',
    userPromptKey: 'newspaperEditorialUserPrompt',
    defaultSystemPrompt: DEFAULT_EDITORIAL_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_EDITORIAL_USER_PROMPT,
    variables: EDITORIAL_VARIABLES,
  },
  {
    slug: 'newspaper-counsels-brief',
    displayName: "Counsel's Brief",
    category: 'newspaper',
    systemPromptKey: 'newspaperCounselsBriefSystemPrompt',
    userPromptKey: 'newspaperCounselsBriefUserPrompt',
    defaultSystemPrompt: DEFAULT_COUNSELS_BRIEF_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_COUNSELS_BRIEF_USER_PROMPT,
    variables: COUNSELS_BRIEF_VARIABLES,
  },
  {
    slug: 'newspaper-letters-to-editor',
    displayName: 'Letters to the Editor',
    category: 'newspaper',
    systemPromptKey: 'newspaperLettersSystemPrompt',
    userPromptKey: 'newspaperLettersUserPrompt',
    defaultSystemPrompt: DEFAULT_LETTERS_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_LETTERS_USER_PROMPT,
    variables: LETTERS_VARIABLES,
  },
  {
    slug: 'newspaper-market-signals',
    displayName: 'Market Signals',
    category: 'newspaper',
    systemPromptKey: 'newspaperMarketSignalsSystemPrompt',
    userPromptKey: 'newspaperMarketSignalsUserPrompt',
    defaultSystemPrompt: DEFAULT_MARKET_SIGNALS_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_MARKET_SIGNALS_USER_PROMPT,
    variables: MARKET_SIGNALS_VARIABLES,
  },
  {
    slug: 'newspaper-press-gallery',
    displayName: 'From the Press Gallery',
    category: 'newspaper',
    systemPromptKey: 'newspaperPressGallerySystemPrompt',
    userPromptKey: 'newspaperPressGalleryUserPrompt',
    defaultSystemPrompt: DEFAULT_PRESS_GALLERY_SYSTEM_PROMPT,
    defaultUserPrompt: DEFAULT_PRESS_GALLERY_USER_PROMPT,
    variables: PRESS_GALLERY_VARIABLES,
  },
];

export const CATEGORY_LABELS: Record<PromptSetCategory, string> = {
  pipeline: 'Pipeline',
  query: 'Search & Query',
  newspaper: 'Newspaper',
};
