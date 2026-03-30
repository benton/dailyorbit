import type { DuckDBConnection } from '@duckdb/node-api';
import type { NewspaperContentType, GeneratorResult } from './types.ts';
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

// ── Generator registry ──────────────────────────────────────────────

function makeTextGenerator(
  importPath: string,
  fnName: string,
): GeneratorFn {
  return async (ctx: GenerateContext): Promise<GeneratorResult> => {
    const mod = await import(importPath);
    const fn = mod[fnName] as (opts: {
      conn: DuckDBConnection;
      editionId: number;
      editionDate: string;
      inferenceService: InferenceService;
      config: ConfigService;
      log: (level: string, msg: string) => void;
    }) => Promise<GeneratorResult>;
    return fn({
      conn: ctx.conn,
      editionId: ctx.editionId,
      editionDate: ctx.editionDate,
      inferenceService: ctx.inferenceService,
      config: ctx.config,
      log: () => {},
    });
  };
}

const GENERATORS: Record<NewspaperContentType, GeneratorFn> = {
  // Daily types
  daily_digest: makeTextGenerator(
    './generators/daily-digest.ts',
    'generateDailyDigest',
  ),
  hero_image: async (ctx: GenerateContext): Promise<GeneratorResult> => {
    const { generateHeroImage } = await import('./generators/hero-image.ts');
    return generateHeroImage({
      conn: ctx.conn,
      editionId: ctx.editionId,
      editionDate: ctx.editionDate,
      inferenceService: null as never,
      config: ctx.config,
      imageClient: ctx.imageClient,
      log: () => {},
    });
  },
  fake_ad: makeTextGenerator('./generators/fake-ad.ts', 'generateFakeAd'),
  editorial_cartoon: async (
    ctx: GenerateContext,
  ): Promise<GeneratorResult> => {
    const { generateEditorialCartoon } = await import(
      './generators/editorial-cartoon.ts'
    );
    return generateEditorialCartoon({
      conn: ctx.conn,
      editionId: ctx.editionId,
      editionDate: ctx.editionDate,
      inferenceService: ctx.inferenceService,
      config: ctx.config,
      imageClient: ctx.imageClient,
      log: () => {},
    });
  },
  classifieds: makeTextGenerator(
    './generators/classifieds.ts',
    'generateClassifieds',
  ),

  // Slot A types
  orbital_forecast: makeTextGenerator(
    './generators/orbital-forecast.ts',
    'generateOrbitalForecast',
  ),
  the_docket: makeTextGenerator(
    './generators/the-docket.ts',
    'generateTheDocket',
  ),
  spectrum_watch: makeTextGenerator(
    './generators/spectrum-watch.ts',
    'generateSpectrumWatch',
  ),
  competitive_intel: makeTextGenerator(
    './generators/competitive-intel.ts',
    'generateCompetitiveIntel',
  ),

  // Slot B types
  company_spotlight: makeTextGenerator(
    './generators/company-spotlight.ts',
    'generateCompanySpotlight',
  ),
  filing_in_focus: makeTextGenerator(
    './generators/filing-in-focus.ts',
    'generateFilingInFocus',
  ),
  the_applicant: makeTextGenerator(
    './generators/the-applicant.ts',
    'generateTheApplicant',
  ),
  tech_spotlight: makeTextGenerator(
    './generators/tech-spotlight.ts',
    'generateTechSpotlight',
  ),
  from_the_archives: makeTextGenerator(
    './generators/from-the-archives.ts',
    'generateFromTheArchives',
  ),

  // Slot C types
  editorial: makeTextGenerator(
    './generators/editorial.ts',
    'generateEditorial',
  ),
  counsels_brief: makeTextGenerator(
    './generators/counsels-brief.ts',
    'generateCounselsBrief',
  ),
  letters_to_editor: makeTextGenerator(
    './generators/letters-to-editor.ts',
    'generateLettersToEditor',
  ),
  market_signals: makeTextGenerator(
    './generators/market-signals.ts',
    'generateMarketSignals',
  ),
  press_gallery: makeTextGenerator(
    './generators/press-gallery.ts',
    'generatePressGallery',
  ),

  // Weekend only
  week_in_review: makeTextGenerator(
    './generators/week-in-review.ts',
    'generateWeekInReview',
  ),
};

// ── Service function ────────────────────────────────────────────────

async function createImageClient(
  conn: DuckDBConnection,
): Promise<InstrumentedBedrockClient> {
  const config = getConfigService();
  const region: string = config.get('bedrockRegion') as string;
  const { BedrockClient } = await import('../inference/bedrock-client.ts');
  const { InstrumentedBedrockClient: IBC } = await import(
    '../inference/instrumented-client.ts'
  );
  return new IBC(new BedrockClient(region), conn, 'newspaper');
}

export async function generateEdition(
  conn: DuckDBConnection,
  editionDate: string,
  contentTypes?: NewspaperContentType[],
): Promise<GenerateResult> {
  const { ensureEdition, upsertArticle, getArticle, updateEditionStatus } =
    await import('./repository.ts');
  const { ensureNewspaperTables } = await import('./schema.ts');
  const { ensureNewsTables } = await import('../news/schema.ts');
  const { ensureCompanyTables } = await import('../companies/schema.ts');

  await ensureNewspaperTables(conn);
  await ensureNewsTables(conn);
  await ensureCompanyTables(conn);

  const edition = await ensureEdition(conn, editionDate);
  await updateEditionStatus(conn, edition.id, 'generating');

  const config = getConfigService();
  const inferenceService = getInferenceService();
  const imageClient: InstrumentedBedrockClient =
    await createImageClient(conn);

  // Determine types to generate
  let typesToRun: NewspaperContentType[];
  if (contentTypes != null && contentTypes.length > 0) {
    typesToRun = contentTypes;
  } else {
    const { getContentTypesForDay } = await import('./rotation.ts');
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
