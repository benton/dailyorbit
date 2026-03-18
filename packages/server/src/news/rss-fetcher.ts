import RssParser from 'rss-parser';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { NewsSource } from './types.ts';
import {
  getSourcesDueForFetch,
  updateSourceFetchStatus,
  upsertNewsItem,
} from './repository.ts';

type FetchResult = {
  sourceName: string;
  itemsInserted: number;
  itemsSkipped: number;
  error: string | null;
};

/**
 * Fetch RSS feeds for all sources that are due, inserting new items into the database.
 * Sequential per-source to be polite to publishers.
 */
export async function fetchAllDueSources(
  conn: DuckDBConnection,
  onProgress?: (result: FetchResult) => void,
): Promise<{ results: FetchResult[]; totalInserted: number }> {
  const sources: NewsSource[] = await getSourcesDueForFetch(conn);
  const results: FetchResult[] = [];
  let totalInserted: number = 0;

  for (const source of sources) {
    const result: FetchResult = await fetchSingleSource(conn, source);
    results.push(result);
    totalInserted += result.itemsInserted;
    if (onProgress != null) {
      onProgress(result);
    }
  }

  return { results, totalInserted };
}

/**
 * Fetch a single RSS feed source and upsert new items.
 */
export async function fetchSingleSource(
  conn: DuckDBConnection,
  source: NewsSource,
): Promise<FetchResult> {
  const parser = new RssParser();

  try {
    const feed = await parser.parseURL(source.feedUrl);
    let inserted: number = 0;
    let skipped: number = 0;

    for (const item of feed.items) {
      const sourceUrl: string | undefined = item.link;
      const title: string | undefined = item.title;

      // Skip items without a URL or title — they can't be tracked
      if (sourceUrl == null || title == null) {
        skipped++;
        continue;
      }

      const publishedAt: string | null = item.isoDate ?? item.pubDate ?? null;
      const author: string | null = item.creator ?? item.author ?? null;
      const tags: string[] = (item.categories ?? []).map((c: string) =>
        String(c),
      );

      const wasInserted: boolean = await upsertNewsItem(conn, {
        newsSourceId: source.id,
        sourceUrl,
        title,
        author,
        publishedAt,
        tags,
      });

      if (wasInserted) {
        inserted++;
      } else {
        skipped++;
      }
    }

    await updateSourceFetchStatus(conn, source.id, 'success', null);

    return {
      sourceName: source.name,
      itemsInserted: inserted,
      itemsSkipped: skipped,
      error: null,
    };
  } catch (err: unknown) {
    const msg: string = err instanceof Error ? err.message : String(err);
    await updateSourceFetchStatus(conn, source.id, 'failed', msg);

    return {
      sourceName: source.name,
      itemsInserted: 0,
      itemsSkipped: 0,
      error: msg,
    };
  }
}
