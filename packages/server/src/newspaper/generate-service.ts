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
// Each import() uses a static string literal so the bundler can resolve it.

const GENERATORS: Record<NewspaperContentType, GeneratorFn> = {
  // Daily types
  daily_digest: async (ctx) => {
    const { generateDailyDigest } =
      await import('./generators/daily-digest.ts');
    return generateDailyDigest(toOpts(ctx));
  },
  hero_image: async (ctx) => {
    const { generateHeroImage } = await import('./generators/hero-image.ts');
    return generateHeroImage({
      ...toOpts(ctx),
      inferenceService: null as never,
      imageClient: ctx.imageClient,
    });
  },
  fake_ad: async (ctx) => {
    const { generateFakeAd } = await import('./generators/fake-ad.ts');
    return generateFakeAd(toOpts(ctx));
  },
  editorial_cartoon: async (ctx) => {
    const { generateEditorialCartoon } =
      await import('./generators/editorial-cartoon.ts');
    return generateEditorialCartoon({
      ...toOpts(ctx),
      imageClient: ctx.imageClient,
    });
  },
  classifieds: async (ctx) => {
    const { generateClassifieds } = await import('./generators/classifieds.ts');
    return generateClassifieds(toOpts(ctx));
  },

  // Slot A types
  orbital_forecast: async (ctx) => {
    const { generateOrbitalForecast } =
      await import('./generators/orbital-forecast.ts');
    return generateOrbitalForecast(toOpts(ctx));
  },
  the_docket: async (ctx) => {
    const { generateTheDocket } = await import('./generators/the-docket.ts');
    return generateTheDocket(toOpts(ctx));
  },
  spectrum_watch: async (ctx) => {
    const { generateSpectrumWatch } =
      await import('./generators/spectrum-watch.ts');
    return generateSpectrumWatch(toOpts(ctx));
  },
  competitive_intel: async (ctx) => {
    const { generateCompetitiveIntel } =
      await import('./generators/competitive-intel.ts');
    return generateCompetitiveIntel(toOpts(ctx));
  },

  // Slot B types
  company_spotlight: async (ctx) => {
    const { generateCompanySpotlight } =
      await import('./generators/company-spotlight.ts');
    return generateCompanySpotlight(toOpts(ctx));
  },
  filing_in_focus: async (ctx) => {
    const { generateFilingInFocus } =
      await import('./generators/filing-in-focus.ts');
    return generateFilingInFocus(toOpts(ctx));
  },
  the_applicant: async (ctx) => {
    const { generateTheApplicant } =
      await import('./generators/the-applicant.ts');
    return generateTheApplicant(toOpts(ctx));
  },
  tech_spotlight: async (ctx) => {
    const { generateTechSpotlight } =
      await import('./generators/tech-spotlight.ts');
    return generateTechSpotlight(toOpts(ctx));
  },
  from_the_archives: async (ctx) => {
    const { generateFromTheArchives } =
      await import('./generators/from-the-archives.ts');
    return generateFromTheArchives(toOpts(ctx));
  },

  // Slot C types
  editorial: async (ctx) => {
    const { generateEditorial } = await import('./generators/editorial.ts');
    return generateEditorial(toOpts(ctx));
  },
  counsels_brief: async (ctx) => {
    const { generateCounselsBrief } =
      await import('./generators/counsels-brief.ts');
    return generateCounselsBrief(toOpts(ctx));
  },
  letters_to_editor: async (ctx) => {
    const { generateLettersToEditor } =
      await import('./generators/letters-to-editor.ts');
    return generateLettersToEditor(toOpts(ctx));
  },
  market_signals: async (ctx) => {
    const { generateMarketSignals } =
      await import('./generators/market-signals.ts');
    return generateMarketSignals(toOpts(ctx));
  },
  press_gallery: async (ctx) => {
    const { generatePressGallery } =
      await import('./generators/press-gallery.ts');
    return generatePressGallery(toOpts(ctx));
  },

  // Weekend only
  week_in_review: async (ctx) => {
    const { generateWeekInReview } =
      await import('./generators/week-in-review.ts');
    return generateWeekInReview(toOpts(ctx));
  },
};

// ── Service function ────────────────────────────────────────────────

async function createImageClient(
  conn: DuckDBConnection,
): Promise<InstrumentedBedrockClient> {
  const config = getConfigService();
  const region: string = config.get('bedrockRegion') as string;
  const { BedrockClient } = await import('../inference/bedrock-client.ts');
  const { InstrumentedBedrockClient: IBC } =
    await import('../inference/instrumented-client.ts');
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
  const imageClient: InstrumentedBedrockClient = await createImageClient(conn);

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
