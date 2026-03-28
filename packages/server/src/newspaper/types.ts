import type { DuckDBConnection } from '@duckdb/node-api';
import type { InferenceService } from '../inference/inference-service.ts';
import type { ConfigService } from '../lib/config-service.ts';

/** Edition type: daily broadsheet or weekly recap */
export type EditionType = 'daily' | 'weekly';

/** Status of an edition or article through the generation pipeline */
export type EditionStatus = 'pending' | 'generating' | 'complete' | 'failed';

export type ArticleStatus = 'pending' | 'generated' | 'failed';

/** Content types for newspaper articles */
export type NewspaperContentType =
  // Daily (every day)
  | 'daily_digest'
  | 'hero_image'
  | 'fake_ad'
  | 'editorial_cartoon'
  | 'classifieds'
  // Slot A rotation
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

export type NewspaperEdition = {
  id: number;
  editionDate: string;
  editionType: EditionType;
  status: EditionStatus;
  pipelineRunId: number | null;
  heroImagePath: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NewspaperArticle = {
  id: number;
  editionId: number;
  contentType: NewspaperContentType;
  slug: string;
  headline: string | null;
  body: string;
  sourceData: string | null;
  generatedBy: string | null;
  imagePath: string | null;
  imagePrompt: string | null;
  displayOrder: number;
  status: ArticleStatus;
  createdAt: string;
  updatedAt: string;
};

export type NewspaperImage = {
  id: number;
  imageType: 'portrait' | 'section_header' | 'logo' | 'house_ad';
  imagePath: string;
  prompt: string | null;
  tags: string[];
  generatedBy: string | null;
  createdAt: string;
};

/** Common return type for all content generators */
export type GeneratorResult = {
  headline: string;
  body: string;
  imagePath?: string;
  imagePrompt?: string;
  sourceData: Record<string, unknown>;
};

/** Dependencies injected into content generators */
export type GenerateOptions = {
  conn: DuckDBConnection;
  editionId: number;
  editionDate: string;
  inferenceService: InferenceService;
  config: ConfigService;
  log: (level: 'info' | 'error', message: string) => void;
};

// ── Weekly generation helpers ───────────────────────────────────

/**
 * Returns the ISO 8601 week number for the given date.
 * Week 1 is the week containing the first Thursday of the year.
 */
export function getISOWeekNumber(date: Date): number {
  const d: Date = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Set to nearest Thursday: current date + 4 - current day number (Monday=1, Sunday=7)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart: Date = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNumber: number = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return weekNumber;
}

export type HouseAd = {
  id: number;
  tagline: string;
  imagePath: string;
  imagePrompt: string;
  generatedBy: string | null;
  createdAt: string;
};
