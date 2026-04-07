import { defineCommand } from 'citty';
import type { DuckDBInstance } from '@duckdb/node-api';
import { DuckDBConnection } from '@duckdb/node-api';
import { getLogger } from '../../lib/logger.ts';
import { readKeyFile } from '../../lib/encryption.ts';
import type { ConfigService as ConfigServiceType } from '../../lib/config-service.ts';
import type { InferenceService as InferenceServiceType } from '../../inference/inference-service.ts';
import type { InstrumentedBedrockClient as InstrumentedBedrockClientType } from '../../inference/instrumented-client.ts';
import type {
  GeneratorResult,
  NewspaperContentType,
} from '../../newspaper/types.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb, resolveFromRoot } from '../shared/context.ts';

const keyFileArg = {
  type: 'string',
  description: 'Path to encryption key file',
  default: 'data/daily-orbit.key',
} as const;

// ── Shared setup for generators ─────────────────────────────────
type GenerateContext = {
  config: ConfigServiceType;
  inferenceService: InferenceServiceType;
  imageClient: InstrumentedBedrockClientType;
  conn: DuckDBConnection;
};

async function setupGenerateContext(
  dbInstance: DuckDBInstance,
  conn: DuckDBConnection,
  keyFilePath: string,
  regionOverride: string,
): Promise<GenerateContext> {
  const { ConfigService } = await import('../../lib/config-service.ts');
  const { setConfigService } = await import('../../lib/config.ts');
  const { BedrockClient } = await import('../../inference/bedrock-client.ts');
  const { InstrumentedBedrockClient } =
    await import('../../inference/instrumented-client.ts');
  const { InferenceService } =
    await import('../../inference/inference-service.ts');

  const key: Buffer = readKeyFile(resolveFromRoot(keyFilePath));
  const config = new ConfigService(dbInstance, key);
  await config.load();
  setConfigService(config);

  const region: string =
    regionOverride || (config.get('bedrockRegion') as string);
  const imageClient = new InstrumentedBedrockClient(
    new BedrockClient(region),
    conn,
    'newspaper',
  );
  const inferenceService = new InferenceService(imageClient);

  return { config, inferenceService, imageClient, conn };
}

// ── Content type definitions ────────────────────────────────────
type ContentTypeDef = {
  contentType: NewspaperContentType;
  slug: string;
  displayOrder: number;
  generatedByKey: 'newspaperCopyModel' | 'newspaperImageModel';
  generate: (
    ctx: GenerateContext,
    editionId: number,
    editionDate: string,
    log: (level: string, message: string) => void,
  ) => Promise<GeneratorResult>;
  extraSchemas?: () => Promise<void>;
};

async function ensureCompanySchema(conn: DuckDBConnection): Promise<void> {
  const { ensureCompanyTables } = await import('../../companies/schema.ts');
  await ensureCompanyTables(conn);
}

/** Helper to create a standard text generator entry */
function makeTextDef(
  contentType: NewspaperContentType,
  slug: string,
  displayOrder: number,
  importPath: string,
  fnName: string,
): ContentTypeDef {
  return {
    contentType,
    slug,
    displayOrder,
    generatedByKey: 'newspaperCopyModel',
    generate: async (ctx, editionId, editionDate, log) => {
      const mod = await import(importPath);
      const fn = mod[fnName] as (opts: {
        conn: DuckDBConnection;
        editionId: number;
        editionDate: string;
        inferenceService: InferenceServiceType;
        config: ConfigServiceType;
        log: (level: string, msg: string) => void;
      }) => Promise<GeneratorResult>;
      return fn({
        conn: ctx.conn,
        editionId,
        editionDate,
        inferenceService: ctx.inferenceService,
        config: ctx.config,
        log: (level: string, msg: string) => log(level, msg),
      });
    },
  };
}

const CONTENT_TYPES: Record<string, ContentTypeDef> = {
  // ── Daily types ────────────────────────────────────────────
  daily_digest: makeTextDef(
    'daily_digest',
    'three-miles-up',
    1,
    '../../newspaper/generators/daily-digest.ts',
    'generateDailyDigest',
  ),
  hero_image: {
    contentType: 'hero_image',
    slug: 'hero-image',
    displayOrder: 0,
    generatedByKey: 'newspaperImageModel',
    generate: async (ctx, editionId, editionDate, log) => {
      const { generateHeroImage } =
        await import('../../newspaper/generators/hero-image.ts');
      return generateHeroImage({
        conn: ctx.conn,
        editionId,
        editionDate,
        inferenceService: null as never,
        config: ctx.config,
        imageClient: ctx.imageClient,
        log: (level: string, msg: string) => log(level, msg),
      });
    },
  },
  fake_ad: makeTextDef(
    'fake_ad',
    'fake-ad',
    90,
    '../../newspaper/generators/fake-ad.ts',
    'generateFakeAd',
  ),
  editorial_cartoon: {
    contentType: 'editorial_cartoon',
    slug: 'editorial-cartoon',
    displayOrder: 11,
    generatedByKey: 'newspaperImageModel',
    generate: async (ctx, editionId, editionDate, log) => {
      const { generateEditorialCartoon } =
        await import('../../newspaper/generators/editorial-cartoon.ts');
      return generateEditorialCartoon({
        conn: ctx.conn,
        editionId,
        editionDate,
        inferenceService: ctx.inferenceService,
        config: ctx.config,
        imageClient: ctx.imageClient,
        log: (level: string, msg: string) => log(level, msg),
      });
    },
  },
  classifieds: makeTextDef(
    'classifieds',
    'classifieds',
    80,
    '../../newspaper/generators/classifieds.ts',
    'generateClassifieds',
  ),

  // ── Slot A types ───────────────────────────────────────────
  orbital_forecast: makeTextDef(
    'orbital_forecast',
    'orbital-forecast',
    30,
    '../../newspaper/generators/orbital-forecast.ts',
    'generateOrbitalForecast',
  ),
  the_docket: makeTextDef(
    'the_docket',
    'the-docket',
    30,
    '../../newspaper/generators/the-docket.ts',
    'generateTheDocket',
  ),
  spectrum_watch: makeTextDef(
    'spectrum_watch',
    'spectrum-watch',
    30,
    '../../newspaper/generators/spectrum-watch.ts',
    'generateSpectrumWatch',
  ),
  competitive_intel: makeTextDef(
    'competitive_intel',
    'competitive-intel',
    30,
    '../../newspaper/generators/competitive-intel.ts',
    'generateCompetitiveIntel',
  ),

  // ── Slot B types ───────────────────────────────────────────
  company_spotlight: makeTextDef(
    'company_spotlight',
    'company-spotlight',
    20,
    '../../newspaper/generators/company-spotlight.ts',
    'generateCompanySpotlight',
  ),
  filing_in_focus: makeTextDef(
    'filing_in_focus',
    'filing-in-focus',
    20,
    '../../newspaper/generators/filing-in-focus.ts',
    'generateFilingInFocus',
  ),
  the_applicant: makeTextDef(
    'the_applicant',
    'the-applicant',
    20,
    '../../newspaper/generators/the-applicant.ts',
    'generateTheApplicant',
  ),
  tech_spotlight: makeTextDef(
    'tech_spotlight',
    'tech-spotlight',
    20,
    '../../newspaper/generators/tech-spotlight.ts',
    'generateTechSpotlight',
  ),
  from_the_archives: makeTextDef(
    'from_the_archives',
    'from-the-archives',
    20,
    '../../newspaper/generators/from-the-archives.ts',
    'generateFromTheArchives',
  ),

  // ── Slot C types ───────────────────────────────────────────
  editorial: makeTextDef(
    'editorial',
    'over-the-horizon',
    10,
    '../../newspaper/generators/editorial.ts',
    'generateEditorial',
  ),
  counsels_brief: makeTextDef(
    'counsels_brief',
    'counsels-brief',
    10,
    '../../newspaper/generators/counsels-brief.ts',
    'generateCounselsBrief',
  ),
  letters_to_editor: makeTextDef(
    'letters_to_editor',
    'letters-to-the-editor',
    10,
    '../../newspaper/generators/letters-to-editor.ts',
    'generateLettersToEditor',
  ),
  market_signals: makeTextDef(
    'market_signals',
    'market-signals',
    10,
    '../../newspaper/generators/market-signals.ts',
    'generateMarketSignals',
  ),
  press_gallery: makeTextDef(
    'press_gallery',
    'press-gallery',
    10,
    '../../newspaper/generators/press-gallery.ts',
    'generatePressGallery',
  ),
};

// Daily types always generated
const DAILY_TYPES: string[] = [
  'daily_digest',
  'hero_image',
  'fake_ad',
  'editorial_cartoon',
  'classifieds',
];
/**
 * Determine which rotation types to generate for a given date.
 * Returns the 3 slot types scheduled for that day of the week.
 */
async function getRotationTypesForDate(editionDate: string): Promise<string[]> {
  const dayOfWeek: number = new Date(editionDate + 'T12:00:00Z').getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return [];

  const { getContentTypesForDay } = await import('../../newspaper/rotation.ts');
  const slots = getContentTypesForDay(dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6);
  const result: string[] = [];
  if (slots.slotA) result.push(slots.slotA);
  if (slots.slotB) result.push(slots.slotB);
  if (slots.slotC) result.push(slots.slotC);
  return result;
}

const VALID_TYPES: string = [...Object.keys(CONTENT_TYPES), 'all'].join(', ');

export const newspaperCommand = defineCommand({
  meta: {
    name: 'newspaper',
    description: 'Newspaper edition generation and management',
  },
  subCommands: {
    generate: defineCommand({
      meta: {
        name: 'generate',
        description: 'Generate newspaper content for a given date',
      },
      args: {
        database: databaseArg,
        keyFile: keyFileArg,
        date: {
          type: 'string',
          description: 'Edition date (YYYY-MM-DD, default: today)',
          default: '',
        },
        type: {
          type: 'string',
          description: `Content type (${VALID_TYPES}). Default: all`,
          default: 'all',
        },
        region: {
          type: 'string',
          description:
            'AWS region override (default: from bedrockRegion config)',
          default: '',
        },
      },
      async run({ args }) {
        const log = getLogger();
        const editionDate: string =
          args.date || new Date().toISOString().split('T')[0]!;
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewspaperTables } =
            await import('../../newspaper/schema.ts');
          const { ensureNewsTables } = await import('../../news/schema.ts');
          await ensureNewspaperTables(conn);
          await ensureNewsTables(conn);
          await ensureCompanySchema(conn);

          const { ensureEdition, upsertArticle, getArticle } =
            await import('../../newspaper/repository.ts');
          const edition = await ensureEdition(conn, editionDate);
          log.info(
            `Edition: ${edition.editionDate} (id=${String(edition.id)})`,
          );

          const ctx: GenerateContext = await setupGenerateContext(
            dbInstance,
            conn,
            args.keyFile,
            args.region,
          );

          let typesToRun: string[];
          if (args.type === 'all') {
            const rotationTypes: string[] =
              await getRotationTypesForDate(editionDate);
            typesToRun = [...DAILY_TYPES, ...rotationTypes];
          } else {
            typesToRun = [args.type];
          }

          for (const typeName of typesToRun) {
            const def: ContentTypeDef | undefined = CONTENT_TYPES[typeName];
            if (!def) {
              log.error(`Unknown content type: ${typeName}`);
              continue;
            }

            // Skip if already generated
            const existing = await getArticle(conn, edition.id, def.slug);
            if (existing?.status === 'generated') {
              log.info(`[${def.slug}] already generated — skipping`);
              continue;
            }

            try {
              log.info(`[${def.slug}] generating...`);
              const result: GeneratorResult = await def.generate(
                ctx,
                edition.id,
                editionDate,
                (level: string, msg: string) =>
                  log[level === 'error' ? 'error' : 'info'](msg),
              );

              await upsertArticle(conn, edition.id, {
                contentType: def.contentType,
                slug: def.slug,
                headline: result.headline,
                body: result.body,
                imagePath: result.imagePath ?? null,
                imagePrompt: result.imagePrompt ?? null,
                sourceData: JSON.stringify(result.sourceData),
                generatedBy: ctx.config.get(def.generatedByKey) as string,
                displayOrder: def.displayOrder,
                status: 'generated',
              });

              const label: string = result.headline || def.slug;
              log.info(`[${def.slug}] done: "${label}"`);
            } catch (err) {
              log.error(`[${def.slug}] failed: ${(err as Error).message}`);
            }
          }

          // Mark edition as complete and auto-publish
          const { updateEditionStatus, publishEdition } =
            await import('../../newspaper/repository.ts');
          await updateEditionStatus(conn, edition.id, 'complete');
          const published: boolean = await publishEdition(conn, editionDate);
          log.info(
            `Edition ${editionDate} marked complete${published ? ' and published' : ''}`,
          );
        } finally {
          conn.closeSync();
        }
      },
    }),

    regenerate: defineCommand({
      meta: {
        name: 'regenerate',
        description: 'Regenerate a specific article for a given date',
      },
      args: {
        database: databaseArg,
        date: {
          type: 'string',
          description: 'Edition date (YYYY-MM-DD)',
          required: true,
        },
        article: {
          type: 'string',
          description: 'Article slug to regenerate (default: three-miles-up)',
          default: 'three-miles-up',
        },
      },
      async run({ args }) {
        const log = getLogger();
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewspaperTables } =
            await import('../../newspaper/schema.ts');
          await ensureNewspaperTables(conn);

          const { getEditionByDate, resetArticle } =
            await import('../../newspaper/repository.ts');
          const edition = await getEditionByDate(conn, args.date);
          if (!edition) {
            log.error(`No edition found for ${args.date}`);
            return;
          }

          await resetArticle(conn, edition.id, args.article);
          log.info(
            `Reset article "${args.article}" to pending for ${args.date}`,
          );
          log.info('Run "newspaper generate" to regenerate.');
        } finally {
          conn.closeSync();
        }
      },
    }),

    list: defineCommand({
      meta: {
        name: 'list',
        description: 'List recent newspaper editions',
      },
      args: {
        database: databaseArg,
        limit: {
          type: 'string',
          description: 'Number of editions to show',
          default: '10',
        },
      },
      async run({ args }) {
        const log = getLogger();
        const limit: number = parseInt(args.limit, 10);
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewspaperTables } =
            await import('../../newspaper/schema.ts');
          await ensureNewspaperTables(conn);

          const { listEditions } =
            await import('../../newspaper/repository.ts');
          const editions = await listEditions(conn, limit, 0);

          if (editions.length === 0) {
            log.info('No editions found.');
            return;
          }

          for (const ed of editions) {
            log.info(
              `${ed.editionDate}  ${ed.editionType.padEnd(6)}  ${ed.status.padEnd(10)}  id=${String(ed.id)}`,
            );
          }
        } finally {
          conn.closeSync();
        }
      },
    }),

    show: defineCommand({
      meta: {
        name: 'show',
        description: 'Show a newspaper edition with its articles',
      },
      args: {
        database: databaseArg,
        date: {
          type: 'string',
          description: 'Edition date (YYYY-MM-DD)',
          required: true,
        },
      },
      async run({ args }) {
        const log = getLogger();
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewspaperTables } =
            await import('../../newspaper/schema.ts');
          await ensureNewspaperTables(conn);

          const { getEditionByDate, getArticlesByEdition } =
            await import('../../newspaper/repository.ts');
          const edition = await getEditionByDate(conn, args.date);
          if (!edition) {
            log.info(`No edition found for ${args.date}`);
            return;
          }

          log.info(`\n=== The Daily Orbit — ${edition.editionDate} ===`);
          log.info(`Type: ${edition.editionType}  Status: ${edition.status}\n`);

          const articles = await getArticlesByEdition(conn, edition.id);
          if (articles.length === 0) {
            log.info('No articles yet.');
            return;
          }

          for (const article of articles) {
            log.info(`--- ${article.headline ?? article.slug} ---`);
            log.info(`[${article.contentType}] status=${article.status}\n`);
            log.info(article.body);
            log.info('');
          }
        } finally {
          conn.closeSync();
        }
      },
    }),

    'generate-library': defineCommand({
      meta: {
        name: 'generate-library',
        description:
          'Generate the static image library (portraits and section headers)',
      },
      args: {
        database: databaseArg,
        keyFile: keyFileArg,
        type: {
          type: 'string',
          description:
            'What to generate: portraits, headers, house-ads, or all (default: all)',
          default: 'all',
        },
        region: {
          type: 'string',
          description:
            'AWS region for image model (default: from bedrockRegion config)',
          default: '',
        },
        start: {
          type: 'string',
          description: 'Start index for portrait generation (default: 0)',
          default: '0',
        },
        limit: {
          type: 'string',
          description:
            'Max portraits to generate in this run (default: unlimited)',
          default: '',
        },
        seed: {
          type: 'string',
          description: 'Base seed for image generation (default: index * 42)',
          default: '',
        },
      },
      async run({ args }) {
        const log = getLogger();
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewspaperTables } =
            await import('../../newspaper/schema.ts');
          await ensureNewspaperTables(conn);

          const { ConfigService } = await import('../../lib/config-service.ts');
          const { setConfigService } = await import('../../lib/config.ts');
          const { BedrockClient } =
            await import('../../inference/bedrock-client.ts');
          const { InstrumentedBedrockClient } =
            await import('../../inference/instrumented-client.ts');

          const key: Buffer = readKeyFile(resolveFromRoot(args.keyFile));
          const config = new ConfigService(dbInstance, key);
          await config.load();
          setConfigService(config);

          const region: string =
            args.region || (config.get('bedrockRegion') as string);
          const imageClient = new InstrumentedBedrockClient(
            new BedrockClient(region),
            conn,
            'newspaper',
          );

          const genType: string = args.type;

          if (genType === 'portraits' || genType === 'all') {
            const { generatePortraitLibrary } =
              await import('../../newspaper/generators/portrait-library.ts');
            const startIndex: number = parseInt(args.start, 10);
            const opts: {
              startIndex: number;
              limit?: number;
              baseSeed?: number;
            } = { startIndex };
            if (args.limit) {
              opts.limit = parseInt(args.limit, 10);
            }
            if (args.seed) {
              opts.baseSeed = parseInt(args.seed, 10);
            }

            log.info('Generating portrait library...');
            const result = await generatePortraitLibrary(
              conn,
              imageClient,
              config,
              (msg: string) => log.info(msg),
              opts,
            );
            log.info(
              `Portraits: ${String(result.generated)} generated, ${String(result.skipped)} skipped, ${String(result.failed)} failed`,
            );
          }

          if (genType === 'headers' || genType === 'all') {
            const { generateSectionHeaders } =
              await import('../../newspaper/generators/section-headers.ts');

            log.info('Generating section headers...');
            const headerOpts: { baseSeed?: number } = {};
            if (args.seed) {
              headerOpts.baseSeed = parseInt(args.seed, 10);
            }
            const result = await generateSectionHeaders(
              conn,
              imageClient,
              config,
              (msg: string) => log.info(msg),
              headerOpts,
            );
            log.info(
              `Headers: ${String(result.generated)} generated, ${String(result.skipped)} skipped, ${String(result.failed)} failed`,
            );
          }

          if (genType === 'house-ads' || genType === 'all') {
            const { InferenceService } =
              await import('../../inference/inference-service.ts');
            const { BedrockClient: BC } =
              await import('../../inference/bedrock-client.ts');
            const {
              generateHouseAdCopy,
              generateHouseAdImages,
              insertHouseAdEntries,
            } = await import('../../newspaper/generators/house-ad-library.ts');

            const bedrockRegion: string =
              args.region || (config.get('bedrockRegion') as string);
            const inferenceService = new InferenceService(
              new BC(bedrockRegion),
            );

            const adCount: number = args.limit ? parseInt(args.limit, 10) : 30;
            log.info(
              `Generating house ad copy (${String(adCount)} tagline/image pairs)...`,
            );
            const entries = await generateHouseAdCopy(
              inferenceService,
              config,
              adCount,
            );
            log.info(`Got ${String(entries.length)} house ad entries`);

            log.info('Generating house ad images...');
            const imageOpts: { baseSeed?: number } = {};
            if (args.seed) {
              imageOpts.baseSeed = parseInt(args.seed, 10);
            }
            const imgResult = await generateHouseAdImages(
              entries,
              conn,
              imageClient,
              config,
              (msg: string) => log.info(msg),
              imageOpts,
            );
            log.info(
              `House ad images: ${String(imgResult.generated)} generated, ${String(imgResult.skipped)} skipped, ${String(imgResult.failed)} failed`,
            );

            log.info('Inserting house ad DB rows...');
            const copyModel: string = config.get(
              'newspaperCopyModel',
            ) as string;
            const dbResult = await insertHouseAdEntries(
              entries,
              conn,
              copyModel,
              (msg: string) => log.info(msg),
            );
            log.info(
              `House ad rows: ${String(dbResult.inserted)} inserted, ${String(dbResult.skipped)} skipped`,
            );
          }

          if (
            genType !== 'portraits' &&
            genType !== 'headers' &&
            genType !== 'house-ads' &&
            genType !== 'all'
          ) {
            log.error(
              `Unknown type: ${genType}. Use portraits, headers, house-ads, or all.`,
            );
          }
        } finally {
          conn.closeSync();
        }
      },
    }),

    'check-images': defineCommand({
      meta: {
        name: 'check-images',
        description: 'Check that newspaper images are reachable on the CDN',
      },
      args: {
        database: databaseArg,
        keyFile: keyFileArg,
        days: {
          type: 'string',
          description: 'Number of recent editions to check (default: 7)',
          default: '7',
        },
        'base-url': {
          type: 'string',
          description:
            'Base URL override (default: from appBaseUrl config + /newspaper)',
          default: '',
        },
      },
      async run({ args }) {
        const log = getLogger();
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ConfigService } = await import('../../lib/config-service.ts');
          const { setConfigService } = await import('../../lib/config.ts');

          const key: Buffer = readKeyFile(resolveFromRoot(args.keyFile));
          const config = new ConfigService(dbInstance, key);
          await config.load();
          setConfigService(config);

          const daysBack: number = parseInt(args.days, 10);
          const baseUrl: string =
            args['base-url'] ||
            `${config.get('appBaseUrl') as string}/newspaper`;

          const { runImageHealthCheck } =
            await import('../../newspaper/image-health.ts');
          const report = await runImageHealthCheck(conn, baseUrl, daysBack);

          log.info(
            `Checked ${String(report.totalChecked)} images: ${String(report.totalOk)} OK, ${String(report.totalMissing)} missing/broken`,
          );

          for (const r of report.results) {
            if (r.status !== 'ok') {
              log.warn(`  ${r.status}: ${r.label} → ${r.url}`);
            }
          }

          if (report.totalMissing > 0) {
            process.exitCode = 1;
          }
        } finally {
          conn.closeSync();
        }
      },
    }),

    'sync-images': defineCommand({
      meta: {
        name: 'sync-images',
        description:
          'Upload all local newspaper images to the configured S3 bucket',
      },
      args: {
        database: databaseArg,
        keyFile: keyFileArg,
      },
      async run({ args }) {
        const log = getLogger();
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ConfigService } = await import('../../lib/config-service.ts');
          const { setConfigService } = await import('../../lib/config.ts');
          const { readKeyFile: readKey } =
            await import('../../lib/encryption.ts');
          const { uploadNewspaperImage } =
            await import('../../newspaper/image-upload.ts');
          const { resolve } = await import('node:path');
          const { glob } = await import('node:fs/promises');

          const key: Buffer = readKey(resolveFromRoot(args.keyFile));
          const config = new ConfigService(dbInstance, key);
          await config.load();
          setConfigService(config);

          const bucket: string = String(
            config.get('newspaperImagesBucket') ?? '',
          );
          const region: string = process.env.AWS_REGION ?? 'us-east-2';

          if (!bucket) {
            log.error(
              'newspaperImagesBucket is not configured — set it via: ./daily-orbit config set newspaperImagesBucket <bucket-name>',
            );
            process.exit(1);
          }

          const imagesRoot: string = resolve('data', 'newspaper', 'images');
          let uploaded: number = 0;
          let failed: number = 0;

          for await (const filePath of glob(
            resolve(imagesRoot, '**/*.{webp,png,jpg,jpeg}'),
          )) {
            try {
              await uploadNewspaperImage(filePath, bucket, region);
              uploaded++;
            } catch (err: unknown) {
              const msg: string =
                err instanceof Error ? err.message : String(err);
              log.warn({ error: msg, filePath }, 'Failed to upload');
              failed++;
            }
          }

          log.info({ uploaded, failed, bucket }, 'Image sync complete');
        } finally {
          conn.closeSync();
        }
      },
    }),

    'pull-images': defineCommand({
      meta: {
        name: 'pull-images',
        description:
          'Download all newspaper images from the configured S3 bucket to data/newspaper/images',
      },
      args: {
        database: databaseArg,
        keyFile: keyFileArg,
      },
      async run({ args }) {
        const log = getLogger();
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ConfigService } = await import('../../lib/config-service.ts');
          const { setConfigService } = await import('../../lib/config.ts');
          const { readKeyFile: readKey } =
            await import('../../lib/encryption.ts');
          const { S3Client, ListObjectsV2Command, GetObjectCommand } =
            await import('@aws-sdk/client-s3');
          const { resolve, dirname } = await import('node:path');
          const { mkdir, writeFile, stat } = await import('node:fs/promises');

          const key: Buffer = readKey(resolveFromRoot(args.keyFile));
          const config = new ConfigService(dbInstance, key);
          await config.load();
          setConfigService(config);

          const bucket: string = String(
            config.get('newspaperImagesBucket') ?? '',
          );
          const region: string = process.env.AWS_REGION ?? 'us-east-2';

          if (!bucket) {
            log.error(
              'newspaperImagesBucket is not configured — set it via: ./daily-orbit config set newspaperImagesBucket <bucket-name>',
            );
            process.exit(1);
          }

          const imagesRoot: string = resolve('data', 'newspaper', 'images');
          const prefix: string = 'newspaper/images/';
          const client = new S3Client({ region });

          let downloaded: number = 0;
          let skipped: number = 0;
          let failed: number = 0;
          let continuationToken: string | undefined;

          do {
            const listResp = await client.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
              }),
            );

            for (const obj of listResp.Contents ?? []) {
              const s3Key: string | undefined = obj.Key;
              if (s3Key == null || s3Key.endsWith('/')) continue;
              if (s3Key.endsWith('.DS_Store')) continue;

              // s3Key is like "newspaper/images/library/masthead.webp"
              // strip the prefix to get a path relative to imagesRoot
              const relative: string = s3Key.slice(prefix.length);
              const localPath: string = resolve(imagesRoot, relative);

              // Skip if a local file already matches the S3 size
              try {
                const info = await stat(localPath);
                if (info.isFile() && info.size === obj.Size) {
                  skipped++;
                  continue;
                }
              } catch {
                // File missing — fall through and download
              }

              try {
                const getResp = await client.send(
                  new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
                );
                const body = getResp.Body;
                if (body == null) {
                  throw new Error('Empty response body');
                }
                const bytes: Uint8Array = await (
                  body as { transformToByteArray: () => Promise<Uint8Array> }
                ).transformToByteArray();

                await mkdir(dirname(localPath), { recursive: true });
                await writeFile(localPath, bytes);
                downloaded++;
              } catch (err: unknown) {
                const msg: string =
                  err instanceof Error ? err.message : String(err);
                log.warn({ error: msg, s3Key }, 'Failed to download');
                failed++;
              }
            }

            continuationToken = listResp.IsTruncated
              ? listResp.NextContinuationToken
              : undefined;
          } while (continuationToken != null);

          log.info(
            { downloaded, skipped, failed, bucket, imagesRoot },
            'Image pull complete',
          );
        } finally {
          conn.closeSync();
        }
      },
    }),
  },
});
