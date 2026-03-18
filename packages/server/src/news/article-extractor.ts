import { extract } from '@extractus/article-extractor';
import type { DuckDBConnection } from '@duckdb/node-api';
import { computeTextChecksum } from '../lib/text-utils.ts';
import { htmlToMarkdown } from '../lib/html-to-markdown.ts';
import { processWithConcurrency } from '../lib/concurrency.ts';
import type { NewsItem } from './types.ts';
import {
  getNewsItemsNeedingExtraction,
  markExtractionFailed,
  updateNewsItemExtraction,
} from './repository.ts';

type ExtractionResult = {
  extracted: number;
  failed: number;
  skipped: number;
};

/**
 * Fetch article URLs and extract clean text content for pending news items.
 */
export async function extractArticles(
  conn: DuckDBConnection,
  limit: number = 100,
  concurrency: number = 3,
): Promise<ExtractionResult> {
  const items: NewsItem[] = await getNewsItemsNeedingExtraction(conn, limit);

  if (items.length === 0) {
    return { extracted: 0, failed: 0, skipped: 0 };
  }

  let extracted: number = 0;
  let failed: number = 0;
  let skipped: number = 0;

  await processWithConcurrency(items, concurrency, async (item: NewsItem) => {
    try {
      const article = await extract(item.sourceUrl);

      if (article == null || article.content == null) {
        await markExtractionFailed(conn, item.id);
        failed++;
        return;
      }

      // Convert HTML to markdown using the existing pipeline logic
      const fullText: string = htmlToMarkdown(article.content);
      const textLength: number = fullText.length;

      if (textLength === 0) {
        await markExtractionFailed(conn, item.id);
        skipped++;
        return;
      }

      const textChecksum: string = computeTextChecksum(fullText);

      await updateNewsItemExtraction(conn, item.id, {
        fullText,
        textLength,
        textChecksum,
        extractStatus: 'extracted',
      });
      extracted++;
    } catch (err: unknown) {
      const msg: string = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\nExtraction failed [${item.sourceUrl}]: ${msg}\n`);
      await markExtractionFailed(conn, item.id);
      failed++;
    }
  });

  return { extracted, failed, skipped };
}
