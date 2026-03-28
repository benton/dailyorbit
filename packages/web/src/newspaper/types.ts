/** Content types for newspaper articles (mirrors server NewspaperContentType) */
export type NewspaperContentType =
  // Daily (every day)
  | 'daily_digest'
  | 'hero_image'
  | 'fake_ad'
  | 'editorial_cartoon'
  | 'classifieds'
  // Slot A rotation
  | 'week_in_review'
  | 'orbital_forecast'
  | 'the_docket'
  | 'spectrum_watch'
  | 'competitive_intel'
  // Slot B rotation
  | 'company_spotlight'
  | 'filing_in_focus'
  | 'the_applicant'
  | 'tech_spotlight'
  | 'from_the_archives'
  // Slot C rotation
  | 'editorial'
  | 'counsels_brief'
  | 'letters_to_editor'
  | 'market_signals'
  | 'press_gallery';

export type ArticleStatus = 'pending' | 'generated' | 'failed';
export type EditionStatus = 'pending' | 'generating' | 'complete' | 'failed';
export type EditionType = 'daily' | 'weekly';

export type Article = {
  body: string;
  contentType: NewspaperContentType;
  createdAt: string;
  displayOrder: number;
  editionId: number;
  generatedBy: string | null;
  headline: string | null;
  id: number;
  imagePath: string | null;
  imagePrompt: string | null;
  slug: string;
  sourceData: string | null;
  status: ArticleStatus;
  updatedAt: string;
};

export type EditionWithArticles = {
  articles: Array<Article>;
  createdAt: string;
  editionDate: string;
  editionType: EditionType;
  heroImagePath: string | null;
  id: number;
  status: EditionStatus;
  updatedAt: string;
};

/** Maps content type to the section header image name in the library */
export const SECTION_HEADER_MAP: Partial<Record<NewspaperContentType, string>> = {
  classifieds: 'the-classifieds',
  company_spotlight: 'company-spotlight',
  competitive_intel: 'competitive-intel',
  counsels_brief: 'counsels-brief',
  daily_digest: 'three-miles-up',
  editorial: 'over-the-horizon',
  editorial_cartoon: 'editorial-cartoon',
  filing_in_focus: 'filing-in-focus',
  from_the_archives: 'on-this-day',
  letters_to_editor: 'letters-to-the-editor',
  market_signals: 'market-ticker',
  orbital_forecast: 'orbital-forecast',
  press_gallery: 'press-gallery',
  spectrum_watch: 'spectrum-watch',
  tech_spotlight: 'tech-spotlight',
  the_applicant: 'the-applicant',
  the_docket: 'the-docket',
};

/** Maps content type to human-readable section title */
export const DISPLAY_NAME_MAP: Record<NewspaperContentType, string> = {
  classifieds: 'The Classifieds',
  company_spotlight: 'Company Spotlight',
  competitive_intel: 'Competitive Intelligence',
  counsels_brief: "The Counsel's Brief",
  daily_digest: '300 Miles Up',
  editorial: 'Over the Horizon',
  editorial_cartoon: 'Editorial Cartoon',
  fake_ad: 'Advertisement',
  filing_in_focus: 'Filing in Focus',
  from_the_archives: 'From the Archives',
  hero_image: 'Hero Image',
  letters_to_editor: 'Letters to the Editor',
  market_signals: 'Market Signals',
  orbital_forecast: 'Orbital Forecast',
  week_in_review: 'The Week in Review',
  press_gallery: 'From the Press Gallery',
  spectrum_watch: 'Spectrum Watch',
  tech_spotlight: 'Technology Spotlight',
  the_applicant: 'The Applicant',
  the_docket: 'The Docket',
};

/** Maps content type to byline/tagline */
export const TAGLINE_MAP: Partial<Record<NewspaperContentType, string>> = {
  competitive_intel: "Who's Filing Where",
  counsels_brief: 'Regulatory Analysis',
  editorial: 'By the Editors',
  filing_in_focus: 'A Closer Look',
  from_the_archives: 'This Week in History',
  letters_to_editor: 'Our Readers Write',
  market_signals: 'Business & Strategy',
  orbital_forecast: 'FCC Filings',
  press_gallery: 'The Week in Review',
  spectrum_watch: 'Band Activity',
  tech_spotlight: 'Innovation Watch',
  the_applicant: 'Industry Profiles',
  the_docket: 'Daily Filing Activity',
  week_in_review: 'Seven Days at the Bureau',
};

export type RecentFiling = {
  address_attention: string | null;
  app_type_code: string;
  callsign: string | null;
  company_name: string | null;
  date_filed: string | null;
  file_number: string;
  status_code: string | null;
  subsystem_code: string;
  summary: string | null;
};

export type RecentFilingsResponse = {
  date: string;
  dayLabel: string;
  filings: Array<RecentFiling>;
};

export type NewsListItem = {
  author: string | null;
  companyName: string | null;
  extractStatus: string;
  id: number;
  newsSourceId: number;
  publishedAt: string | null;
  sourceName: string | null;
  sourceUrl: string;
  summary: string | null;
  tags: Array<string>;
  title: string;
};

export type PaginatedNewsResponse = {
  data: Array<NewsListItem>;
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
};

import env from '../lib/env.tsx';

/**
 * Base URL for newspaper images.
 * Production: '/newspaper' (same-origin via CloudFront -> S3).
 * Dev: falls back to SERVER_URL + /api/newspaper (local API server).
 */
function newspaperImagesBase(): string {
  const cdnBase: string = import.meta.env.VITE_NEWSPAPER_IMAGES_URL ?? '';
  if (cdnBase) {
    return cdnBase;
  }
  return `${env('SERVER_URL')}/api/newspaper`;
}

/** Build URL for an edition image from its filesystem path */
export function editionImageUrl(editionDate: string, imagePath: string): string {
  const filename: string = imagePath.split('/').pop() ?? imagePath;
  return `${newspaperImagesBase()}/images/${editionDate}/${filename}`;
}

/** Build URL for a library image */
export function libraryImageUrl(subpath: string): string {
  return `${newspaperImagesBase()}/images/library/${subpath}`;
}
