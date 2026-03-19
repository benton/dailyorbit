/** Status of the last RSS feed fetch for a news source */
export type FetchStatus = 'success' | 'failed';

/** Status of article text extraction */
export type ExtractStatus = 'pending' | 'extracted' | 'failed';

/** Category of a news source */
export type NewsSourceCategory =
  | 'industry'
  | 'regulatory'
  | 'operator'
  | 'financial'
  | 'community';

/** An RSS/Atom feed endpoint that provides news articles */
export type NewsSource = {
  id: number;
  name: string;
  feedUrl: string;
  category: NewsSourceCategory;
  enabled: boolean;
  fetchIntervalMinutes: number;
  lastFetchedAt: string | null;
  lastFetchStatus: FetchStatus | null;
  lastFetchError: string | null;
  createdAt: string;
  updatedAt: string;
};

/** An individual news article fetched from an RSS feed */
export type NewsItem = {
  id: number;
  newsSourceId: number;
  sourceName: string | null;
  sourceUrl: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  fullText: string | null;
  textLength: number | null;
  textChecksum: string | null;
  summary: string | null;
  summarizedBy: string | null;
  summarizedAt: string | null;
  extractStatus: ExtractStatus;
  companyId: number | null;
  tags: string[];
  createdAt: string;
};

/** Seed data entry for a news source */
export type NewsSourceSeedEntry = {
  name: string;
  feedUrl: string;
  category: NewsSourceCategory;
  enabled: boolean;
};
