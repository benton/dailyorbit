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
  daily_digest: 'three-miles-up',
  editorial: 'over-the-horizon',
  editorial_cartoon: 'editorial-cartoon',
  company_spotlight: 'company-spotlight',
  orbital_forecast: 'orbital-forecast',
  classifieds: 'the-classifieds',
};

/** Maps content type to human-readable section title */
export const DISPLAY_NAME_MAP: Record<NewspaperContentType, string> = {
  daily_digest: '300 Miles Up',
  hero_image: 'Hero Image',
  fake_ad: 'Advertisement',
  editorial: 'Over the Horizon',
  editorial_cartoon: 'Editorial Cartoon',
  company_spotlight: 'Company Spotlight',
  orbital_forecast: 'Orbital Forecast',
  classifieds: 'The Classifieds',
};

export type RecentFiling = {
  file_number: string;
  callsign: string | null;
  address_attention: string | null;
  subsystem_code: string;
  app_type_code: string;
  status_code: string | null;
  date_filed: string | null;
  company_name: string | null;
  summary: string | null;
};

export type RecentFilingsResponse = {
  date: string;
  dayLabel: string;
  filings: Array<RecentFiling>;
};

import env from '../lib/env.tsx';

/** Build API URL for an edition image from its filesystem path */
export function editionImageUrl(editionDate: string, imagePath: string): string {
  const filename: string = imagePath.split('/').pop() ?? imagePath;
  return `${env('SERVER_URL')}/api/newspaper/images/${editionDate}/${filename}`;
}

/** Build API URL for a library image */
export function libraryImageUrl(subpath: string): string {
  return `${env('SERVER_URL')}/api/newspaper/images/library/${subpath}`;
}
