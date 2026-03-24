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
  | 'daily_digest'
  | 'hero_image'
  | 'fake_ad'
  | 'editorial'
  | 'editorial_cartoon'
  | 'company_spotlight'
  | 'orbital_forecast'
  | 'classifieds';

export type NewspaperEdition = {
  id: number;
  editionDate: string;
  editionType: EditionType;
  status: EditionStatus;
  pipelineRunId: number | null;
  heroImagePath: string | null;
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
  imageType: 'portrait' | 'section_header' | 'logo';
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
