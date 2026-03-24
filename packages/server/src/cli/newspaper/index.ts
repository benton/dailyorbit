import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

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
        date: {
          type: 'string',
          description: 'Edition date (YYYY-MM-DD, default: today)',
          default: '',
        },
        type: {
          type: 'string',
          description: 'Content type to generate (default: daily_digest)',
          default: 'daily_digest',
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
          const { ensureNewspaperTables } = await import(
            '../../newspaper/schema.ts'
          );
          const { ensureNewsTables } = await import('../../news/schema.ts');
          await ensureNewspaperTables(conn);
          await ensureNewsTables(conn);

          const { ensureEdition, upsertArticle } = await import(
            '../../newspaper/repository.ts'
          );
          const edition = await ensureEdition(conn, editionDate);
          log.info(`Edition: ${edition.editionDate} (id=${String(edition.id)})`);

          if (args.type === 'daily_digest') {
            const { generateDailyDigest } = await import(
              '../../newspaper/generators/daily-digest.ts'
            );
            const { ConfigService } = await import(
              '../../lib/config-service.ts'
            );
            const { setConfigService } = await import('../../lib/config.ts');
            const { BedrockClient } = await import(
              '../../inference/bedrock-client.ts'
            );
            const { InstrumentedBedrockClient } = await import(
              '../../inference/instrumented-client.ts'
            );
            const { InferenceService } = await import(
              '../../inference/inference-service.ts'
            );

            const config = new ConfigService(
              dbInstance,
              Buffer.from(
                process.env.ENCRYPTION_KEY ?? 'dev-key-not-for-production',
              ),
            );
            await config.load();
            setConfigService(config);

            const region: string = config.get('bedrockRegion') as string;
            const client = new InstrumentedBedrockClient(
              new BedrockClient(region),
              conn,
              'newspaper',
            );
            const inferenceService = new InferenceService(client);

            const result = await generateDailyDigest({
              conn,
              editionId: edition.id,
              editionDate,
              inferenceService,
              config,
              log: (level: string, message: string) =>
                log[level === 'error' ? 'error' : 'info'](message),
            });

            await upsertArticle(conn, edition.id, {
              contentType: 'daily_digest',
              slug: 'three-miles-up',
              headline: result.headline,
              body: result.body,
              sourceData: JSON.stringify(result.sourceData),
              generatedBy: config.get('newspaperCopyModel') as string,
              displayOrder: 1,
              status: 'generated',
            });

            log.info(`Generated: "${result.headline}"`);
            log.info(
              `Body length: ${String(result.body.length)} characters`,
            );
          } else {
            log.error(`Unknown content type: ${args.type}`);
          }
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
          const { ensureNewspaperTables } = await import(
            '../../newspaper/schema.ts'
          );
          await ensureNewspaperTables(conn);

          const { getEditionByDate, resetArticle } = await import(
            '../../newspaper/repository.ts'
          );
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
          const { ensureNewspaperTables } = await import(
            '../../newspaper/schema.ts'
          );
          await ensureNewspaperTables(conn);

          const { listEditions } = await import('../../newspaper/repository.ts');
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
          const { ensureNewspaperTables } = await import(
            '../../newspaper/schema.ts'
          );
          await ensureNewspaperTables(conn);

          const { getEditionByDate, getArticlesByEdition } = await import(
            '../../newspaper/repository.ts'
          );
          const edition = await getEditionByDate(conn, args.date);
          if (!edition) {
            log.info(`No edition found for ${args.date}`);
            return;
          }

          log.info(`\n=== The Daily Orbit — ${edition.editionDate} ===`);
          log.info(
            `Type: ${edition.editionType}  Status: ${edition.status}\n`,
          );

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
  },
});
