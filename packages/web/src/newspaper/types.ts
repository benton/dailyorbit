/** Content types for newspaper articles (mirrors server NewspaperContentType) */
export type NewspaperContentType =
  | 'daily_digest'
  | 'hero_image'
  | 'fake_ad'
  | 'editorial'
  | 'editorial_cartoon'
  | 'company_spotlight'
  | 'orbital_forecast'
  | 'classifieds';

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
  daily_digest: 'three-miles-up',
  editorial: 'over-the-horizon',
  editorial_cartoon: 'editorial-cartoon',
  orbital_forecast: 'orbital-forecast',
};

/** Maps content type to human-readable section title */
export const DISPLAY_NAME_MAP: Record<NewspaperContentType, string> = {
  classifieds: 'The Classifieds',
  company_spotlight: 'Company Spotlight',
  daily_digest: '300 Miles Up',
  editorial: 'Over the Horizon',
  editorial_cartoon: 'Editorial Cartoon',
  fake_ad: 'Advertisement',
  hero_image: 'Hero Image',
  orbital_forecast: 'Orbital Forecast',
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
