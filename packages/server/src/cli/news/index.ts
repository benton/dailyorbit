import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

export const newsCommand = defineCommand({
  meta: {
    name: 'news',
    description: 'News article ingestion and processing',
  },
  subCommands: {
    seed: defineCommand({
      meta: {
        name: 'seed',
        description: 'Seed default RSS feed sources',
      },
      args: { database: databaseArg },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewsTables } = await import('../../news/schema.ts');
          await ensureNewsTables(conn);

          const { seedNewsSources } = await import('../../news/repository.ts');
          const { NEWS_SOURCE_SEED_DATA } =
            await import('../../news/seed-data.ts');
          const result = await seedNewsSources(conn, NEWS_SOURCE_SEED_DATA);

          console.log('Seed complete:');
          console.log(`  Sources created: ${String(result.created)}`);
          console.log(`  Sources skipped: ${String(result.skipped)}`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    fetch: defineCommand({
      meta: {
        name: 'fetch',
        description: 'Fetch RSS feeds and store new items',
      },
      args: {
        database: databaseArg,
        limit: {
          type: 'string',
          description: 'Max sources to fetch (0 = all due)',
          default: '0',
        },
      },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewsTables } = await import('../../news/schema.ts');
          await ensureNewsTables(conn);

          const { fetchAllDueSources } =
            await import('../../news/rss-fetcher.ts');
          const { results, totalInserted } = await fetchAllDueSources(
            conn,
            1,
            (result) => {
              if (result.error != null) {
                console.log(`  [FAIL] ${result.sourceName}: ${result.error}`);
              } else {
                console.log(
                  `  [OK]   ${result.sourceName}: ${String(result.itemsInserted)} new, ${String(result.itemsSkipped)} skipped`,
                );
              }
            },
          );

          console.log('\nFetch complete:');
          console.log(`  Sources processed: ${String(results.length)}`);
          console.log(`  New items:         ${String(totalInserted)}`);
          const errors: number = results.filter((r) => r.error != null).length;
          if (errors > 0) {
            console.log(`  Errors:            ${String(errors)}`);
          }
        } finally {
          conn.closeSync();
        }
      },
    }),

    extract: defineCommand({
      meta: {
        name: 'extract',
        description: 'Download and extract article text from news items',
      },
      args: {
        database: databaseArg,
        limit: {
          type: 'string',
          description: 'Max articles to extract',
          default: '100',
        },
        concurrency: {
          type: 'string',
          description: 'Concurrent extraction requests',
          default: '3',
        },
      },
      async run({ args }) {
        const limit: number = parseInt(args.limit, 10);
        const concurrency: number = parseInt(args.concurrency, 10);
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewsTables } = await import('../../news/schema.ts');
          await ensureNewsTables(conn);

          const { extractArticles } =
            await import('../../news/article-extractor.ts');
          const result = await extractArticles(conn, limit, concurrency);

          console.log('Extraction complete:');
          console.log(`  Extracted: ${String(result.extracted)}`);
          console.log(`  Failed:    ${String(result.failed)}`);
          console.log(`  Skipped:   ${String(result.skipped)}`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    summarize: defineCommand({
      meta: {
        name: 'summarize',
        description: 'Summarize extracted news articles',
      },
      args: {
        database: databaseArg,
        region: {
          type: 'string',
          description: 'AWS region for Bedrock',
          default: 'us-east-2',
        },
        model: {
          type: 'string',
          description: 'Bedrock model ID for summarization',
          default: 'us.amazon.nova-pro-v1:0',
        },
        concurrency: {
          type: 'string',
          description: 'Number of concurrent Bedrock requests',
          default: '5',
        },
        limit: {
          type: 'string',
          description: 'Max articles to summarize (0 = unlimited)',
          default: '0',
        },
        'dry-run': {
          type: 'boolean',
          description: 'Count remaining work without calling Bedrock',
          default: false,
        },
      },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewsTables } = await import('../../news/schema.ts');
          await ensureNewsTables(conn);

          const { summarizeNewsItems } =
            await import('../../news/summarize-news.ts');
          await summarizeNewsItems(conn, {
            region: args.region,
            modelId: args.model,
            concurrency: parseInt(args.concurrency, 10),
            limit: parseInt(args.limit, 10),
            dryRun: args['dry-run'] as boolean,
          });
        } finally {
          conn.closeSync();
        }
      },
    }),

    attribute: defineCommand({
      meta: {
        name: 'attribute',
        description: 'Match news items to companies',
      },
      args: {
        database: databaseArg,
        limit: {
          type: 'string',
          description: 'Max items to process',
          default: '500',
        },
      },
      async run({ args }) {
        const limit: number = parseInt(args.limit, 10);
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureNewsTables } = await import('../../news/schema.ts');
          await ensureNewsTables(conn);
          const { ensureCompanyTables } =
            await import('../../companies/schema.ts');
          await ensureCompanyTables(conn);

          const { attributeNewsItems } =
            await import('../../news/attribute-news.ts');
          const result = await attributeNewsItems(conn, limit);

          console.log('Attribution complete:');
          console.log(`  Attributed: ${String(result.attributed)}`);
          console.log(`  Skipped:    ${String(result.skipped)}`);
        } finally {
          conn.closeSync();
        }
      },
    }),
  },
});
