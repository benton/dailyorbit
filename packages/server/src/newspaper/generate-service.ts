import type { DuckDBConnection } from '@duckdb/node-api';
import type {
  NewspaperContentType,
  GeneratorResult,
  GenerateOptions,
} from './types.ts';
import type { ConfigService } from '../lib/config-service.ts';
import type { InferenceService } from '../inference/inference-service.ts';
import type { InstrumentedBedrockClient } from '../inference/instrumented-client.ts';
import { getConfigService } from '../lib/config.ts';
import { getInferenceService } from '../inference/index.ts';
import {
  SLUG_MAP,
  DISPLAY_ORDER_MAP,
  MODEL_KEY_MAP,
} from './slot-dispatcher.ts';
import { BedrockClient } from '../inference/bedrock-client.ts';
import { InstrumentedBedrockClient as IBC } from '../inference/instrumented-client.ts';
import {
  ensureEdition,
  upsertArticle,
  getArticle,
  updateEditionStatus,
} from './repository.ts';
import { ensureNewspaperTables } from './schema.ts';
import { ensureNewsTables } from '../news/schema.ts';
import { ensureCompanyTables } from '../companies/schema.ts';
import { getContentTypesForDay } from './rotation.ts';
import { generateDailyDigest } from './generators/daily-digest.ts';
import { generateHeroImage } from './generators/hero-image.ts';
import { generateFakeAd } from './generators/fake-ad.ts';
import { generateEditorialCartoon } from './generators/editorial-cartoon.ts';
import { generateClassifieds } from './generators/classifieds.ts';
import { generateOrbitalForecast } from './generators/orbital-forecast.ts';
import { generateTheDocket } from './generators/the-docket.ts';
import { generateSpectrumWatch } from './generators/spectrum-watch.ts';
import { generateCompetitiveIntel } from './generators/competitive-intel.ts';
import { generateCompanySpotlight } from './generators/company-spotlight.ts';
import { generateFilingInFocus } from './generators/filing-in-focus.ts';
import { generateTheApplicant } from './generators/the-applicant.ts';
import { generateTechSpotlight } from './generators/tech-spotlight.ts';
import { generateFromTheArchives } from './generators/from-the-archives.ts';
import { generateEditorial } from './generators/editorial.ts';
import { generateCounselsBrief } from './generators/counsels-brief.ts';
import { generateLettersToEditor } from './generators/letters-to-editor.ts';
import { generateMarketSignals } from './generators/market-signals.ts';
import { generatePressGallery } from './generators/press-gallery.ts';
import { generateWeekInReview } from './generators/week-in-review.ts';

// ── Types ───────────────────────────────────────────────────────────

const DAILY_TYPES: NewspaperContentType[] = [
  'daily_digest',
  'hero_image',
  'fake_ad',
  'editorial_cartoon',
  'classifieds',
];

export type GenerateResult = {
  editionId: number;
  date: string;
  generated: string[];
  skipped: string[];
  failed: Array<{ slug: string; error: string }>;
};

type GenerateContext = {
  conn: DuckDBConnection;
  editionId: number;
  editionDate: string;
  inferenceService: InferenceService;
  config: ConfigService;
  imageClient: InstrumentedBedrockClient;
};

type GeneratorFn = (ctx: GenerateContext) => Promise<GeneratorResult>;

/** Build GenerateOptions from the internal GenerateContext */
function toOpts(ctx: GenerateContext): GenerateOptions {
  return {
    conn: ctx.conn,
    editionId: ctx.editionId,
    editionDate: ctx.editionDate,
    inferenceService: ctx.inferenceService,
    config: ctx.config,
    log: () => {},
  };
}

// ── Generator registry ──────────────────────────────────────────────

const GENERATORS: Record<NewspaperContentType, GeneratorFn> = {
  // Daily types
  daily_digest: (ctx) => generateDailyDigest(toOpts(ctx)),
  hero_image: (ctx) =>
    generateHeroImage({
      ...toOpts(ctx),
      inferenceService: null as never,
      imageClient: ctx.imageClient,
    }),
  fake_ad: (ctx) => generateFakeAd(toOpts(ctx)),
  editorial_cartoon: (ctx) =>
    generateEditorialCartoon({ ...toOpts(ctx), imageClient: ctx.imageClient }),
  classifieds: (ctx) => generateClassifieds(toOpts(ctx)),

  // Slot A types
  orbital_forecast: (ctx) => generateOrbitalForecast(toOpts(ctx)),
  the_docket: (ctx) => generateTheDocket(toOpts(ctx)),
  spectrum_watch: (ctx) => generateSpectrumWatch(toOpts(ctx)),
  competitive_intel: (ctx) => generateCompetitiveIntel(toOpts(ctx)),

  // Slot B types
  company_spotlight: (ctx) => generateCompanySpotlight(toOpts(ctx)),
  filing_in_focus: (ctx) => generateFilingInFocus(toOpts(ctx)),
  the_applicant: (ctx) => generateTheApplicant(toOpts(ctx)),
  tech_spotlight: (ctx) => generateTechSpotlight(toOpts(ctx)),
  from_the_archives: (ctx) => generateFromTheArchives(toOpts(ctx)),

  // Slot C types
  editorial: (ctx) => generateEditorial(toOpts(ctx)),
  counsels_brief: (ctx) => generateCounselsBrief(toOpts(ctx)),
  letters_to_editor: (ctx) => generateLettersToEditor(toOpts(ctx)),
  market_signals: (ctx) => generateMarketSignals(toOpts(ctx)),
  press_gallery: (ctx) => generatePressGallery(toOpts(ctx)),

  // Weekend only
  week_in_review: (ctx) => generateWeekInReview(toOpts(ctx)),
};

// ── Service function ────────────────────────────────────────────────

async function createImageClient(
  conn: DuckDBConnection,
): Promise<InstrumentedBedrockClient> {
  const config = getConfigService();
  const region: string = config.get('bedrockRegion') as string;
  return new IBC(new BedrockClient(region), conn, 'newspaper');
}

export async function generateEdition(
  conn: DuckDBConnection,
  editionDate: string,
  contentTypes?: NewspaperContentType[],
): Promise<GenerateResult> {
  await ensureNewspaperTables(conn);
  await ensureNewsTables(conn);
  await ensureCompanyTables(conn);

  const edition = await ensureEdition(conn, editionDate);
  await updateEditionStatus(conn, edition.id, 'generating');

  const config = getConfigService();
  const inferenceService = getInferenceService();
  const imageClient: InstrumentedBedrockClient = await createImageClient(conn);

  // Determine types to generate
  let typesToRun: NewspaperContentType[];
  if (contentTypes != null && contentTypes.length > 0) {
    typesToRun = contentTypes;
  } else {
    const dayOfWeek = new Date(editionDate + 'T12:00:00Z').getUTCDay() as
      | 0
      | 1
      | 2
      | 3
      | 4
      | 5
      | 6;
    const slots = getContentTypesForDay(dayOfWeek);
    const rotationTypes: NewspaperContentType[] = [
      slots.slotA,
      slots.slotB,
      slots.slotC,
    ].filter((t): t is NewspaperContentType => t != null);
    typesToRun = [...DAILY_TYPES, ...rotationTypes];
  }

  const result: GenerateResult = {
    editionId: edition.id,
    date: editionDate,
    generated: [],
    skipped: [],
    failed: [],
  };

  for (const contentType of typesToRun) {
    const slug: string = SLUG_MAP[contentType];

    // Idempotency check
    const existing = await getArticle(conn, edition.id, slug);
    if (existing?.status === 'generated') {
      result.skipped.push(slug);
      continue;
    }

    try {
      const generator: GeneratorFn = GENERATORS[contentType];
      const genResult: GeneratorResult = await generator({
        conn,
        editionId: edition.id,
        editionDate,
        inferenceService,
        config,
        imageClient,
      });

      const modelKey: string = MODEL_KEY_MAP[contentType];
      await upsertArticle(conn, edition.id, {
        contentType,
        slug,
        headline: genResult.headline,
        body: genResult.body,
        imagePath: genResult.imagePath ?? null,
        imagePrompt: genResult.imagePrompt ?? null,
        sourceData: JSON.stringify(genResult.sourceData),
        generatedBy: config.get(modelKey) as string,
        displayOrder: DISPLAY_ORDER_MAP[contentType],
        status: 'generated',
      });

      result.generated.push(slug);
    } catch (err) {
      result.failed.push({
        slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Mark complete if no failures
  if (result.failed.length === 0) {
    await updateEditionStatus(conn, edition.id, 'complete');
  }

  return result;
}
