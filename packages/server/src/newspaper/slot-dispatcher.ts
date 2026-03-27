import type { DuckDBConnection } from '@duckdb/node-api';
import type { ConfigService } from '../lib/config-service.ts';
import type { InferenceService } from '../inference/inference-service.ts';
import type {
  GenerateOptions,
  GeneratorResult,
  NewspaperContentType,
} from './types.ts';
import {
  getContentTypesForDay,
  type DayOfWeek,
  type DaySlots,
} from './rotation.ts';

// ── Slug + display order registry ───────────────────────────────

export const SLUG_MAP: Record<NewspaperContentType, string> = {
  daily_digest: 'three-miles-up',
  hero_image: 'hero-image',
  fake_ad: 'fake-ad',
  editorial_cartoon: 'editorial-cartoon',
  classifieds: 'classifieds',
  orbital_forecast: 'orbital-forecast',
  the_docket: 'the-docket',
  spectrum_watch: 'spectrum-watch',
  competitive_intel: 'competitive-intel',
  company_spotlight: 'company-spotlight',
  filing_in_focus: 'filing-in-focus',
  the_applicant: 'the-applicant',
  tech_spotlight: 'tech-spotlight',
  from_the_archives: 'from-the-archives',
  editorial: 'over-the-horizon',
  counsels_brief: 'counsels-brief',
  letters_to_editor: 'letters-to-the-editor',
  market_signals: 'market-signals',
  press_gallery: 'press-gallery',
};

export const DISPLAY_ORDER_MAP: Record<NewspaperContentType, number> = {
  hero_image: 0,
  daily_digest: 1,
  editorial: 10,
  editorial_cartoon: 11,
  company_spotlight: 20,
  filing_in_focus: 20,
  the_applicant: 20,
  tech_spotlight: 20,
  from_the_archives: 20,
  orbital_forecast: 30,
  the_docket: 30,
  spectrum_watch: 30,
  competitive_intel: 30,
  counsels_brief: 10,
  letters_to_editor: 10,
  market_signals: 10,
  press_gallery: 10,
  classifieds: 80,
  fake_ad: 90,
};

// ── Generator type + registry ───────────────────────────────────

type GeneratorFn = (opts: GenerateOptions) => Promise<GeneratorResult>;

/**
 * Lazily imports and returns the generator function for a content type.
 * Uses dynamic imports to avoid loading all generators upfront.
 */
async function loadGenerator(
  contentType: NewspaperContentType,
): Promise<GeneratorFn> {
  switch (contentType) {
    case 'orbital_forecast': {
      const m = await import('./generators/orbital-forecast.ts');
      return m.generateOrbitalForecast;
    }
    case 'the_docket': {
      const m = await import('./generators/the-docket.ts');
      return m.generateTheDocket;
    }
    case 'spectrum_watch': {
      const m = await import('./generators/spectrum-watch.ts');
      return m.generateSpectrumWatch;
    }
    case 'competitive_intel': {
      const m = await import('./generators/competitive-intel.ts');
      return m.generateCompetitiveIntel;
    }
    case 'company_spotlight': {
      const m = await import('./generators/company-spotlight.ts');
      return m.generateCompanySpotlight;
    }
    case 'filing_in_focus': {
      const m = await import('./generators/filing-in-focus.ts');
      return m.generateFilingInFocus;
    }
    case 'the_applicant': {
      const m = await import('./generators/the-applicant.ts');
      return m.generateTheApplicant;
    }
    case 'tech_spotlight': {
      const m = await import('./generators/tech-spotlight.ts');
      return m.generateTechSpotlight;
    }
    case 'from_the_archives': {
      const m = await import('./generators/from-the-archives.ts');
      return m.generateFromTheArchives;
    }
    case 'editorial': {
      const m = await import('./generators/editorial.ts');
      return m.generateEditorial;
    }
    case 'counsels_brief': {
      const m = await import('./generators/counsels-brief.ts');
      return m.generateCounselsBrief;
    }
    case 'letters_to_editor': {
      const m = await import('./generators/letters-to-editor.ts');
      return m.generateLettersToEditor;
    }
    case 'market_signals': {
      const m = await import('./generators/market-signals.ts');
      return m.generateMarketSignals;
    }
    case 'press_gallery': {
      const m = await import('./generators/press-gallery.ts');
      return m.generatePressGallery;
    }
    default:
      throw new Error(`No generator for content type: ${contentType}`);
  }
}

// ── Model key mapping ───────────────────────────────────────────

const MODEL_KEY_MAP: Record<NewspaperContentType, string> = {
  daily_digest: 'newspaperCopyModel',
  hero_image: 'newspaperImageModel',
  fake_ad: 'newspaperCopyModel',
  editorial_cartoon: 'newspaperImageModel',
  classifieds: 'newspaperCopyModel',
  orbital_forecast: 'newspaperCopyModel',
  the_docket: 'newspaperCopyModel',
  spectrum_watch: 'newspaperCopyModel',
  competitive_intel: 'newspaperCopyModel',
  company_spotlight: 'newspaperCopyModel',
  filing_in_focus: 'newspaperCopyModel',
  the_applicant: 'newspaperCopyModel',
  tech_spotlight: 'newspaperCopyModel',
  from_the_archives: 'newspaperCopyModel',
  editorial: 'newspaperCopyModel',
  counsels_brief: 'newspaperCopyModel',
  letters_to_editor: 'newspaperCopyModel',
  market_signals: 'newspaperCopyModel',
  press_gallery: 'newspaperCopyModel',
};

// ── Slot dispatcher ─────────────────────────────────────────────

export type SlotName = 'slotA' | 'slotB' | 'slotC';

export type DispatchResult = {
  contentType: NewspaperContentType;
  slug: string;
  result: GeneratorResult;
} | null;

/**
 * Dispatch a single slot for the given edition date.
 *
 * 1. Determine day of week from editionDate
 * 2. Look up content type via getContentTypesForDay()
 * 3. If null (weekend), skip
 * 4. Check if article already exists (idempotent)
 * 5. Load and call the generator
 * 6. Upsert the article
 */
export async function dispatchSlot(
  slotName: SlotName,
  conn: DuckDBConnection,
  editionId: number,
  editionDate: string,
  inferenceService: InferenceService,
  config: ConfigService,
  log: (level: 'info' | 'error', message: string) => void,
): Promise<DispatchResult> {
  const dayOfWeek: DayOfWeek = new Date(
    editionDate + 'T12:00:00Z',
  ).getUTCDay() as DayOfWeek;
  const slots: DaySlots = getContentTypesForDay(dayOfWeek);
  const contentType: NewspaperContentType | null = slots[slotName];

  if (contentType == null) {
    log('info', `${slotName}: weekend — no content type`);
    return null;
  }

  const slug: string = SLUG_MAP[contentType];
  log('info', `${slotName}: ${contentType} (${slug})`);

  // Check if already generated (idempotent)
  const { getArticle } = await import('./repository.ts');
  const existing = await getArticle(conn, editionId, slug);
  if (existing?.status === 'generated') {
    log('info', `${slotName}: ${slug} already generated — skipping`);
    return null;
  }

  // Load and run the generator
  const generator: GeneratorFn = await loadGenerator(contentType);
  const result: GeneratorResult = await generator({
    conn,
    editionId,
    editionDate,
    inferenceService,
    config,
    log,
  });

  // Upsert the article
  const { upsertArticle } = await import('./repository.ts');
  const modelKey: string = MODEL_KEY_MAP[contentType];
  await upsertArticle(conn, editionId, {
    contentType,
    slug,
    headline: result.headline,
    body: result.body,
    imagePath: result.imagePath ?? null,
    imagePrompt: result.imagePrompt ?? null,
    sourceData: JSON.stringify(result.sourceData),
    generatedBy: config.get(modelKey) as string,
    displayOrder: DISPLAY_ORDER_MAP[contentType],
    status: 'generated',
  });

  log('info', `${slotName}: ${slug} done — "${result.headline}"`);
  return { contentType, slug, result };
}
