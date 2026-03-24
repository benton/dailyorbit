import type { NewsSourceSeedEntry } from './types.ts';

/**
 * Default RSS feed sources for satellite industry news.
 * Tier 1 sources are enabled by default; others start disabled.
 */
export const NEWS_SOURCE_SEED_DATA: ReadonlyArray<NewsSourceSeedEntry> = [
  // ── Tier 1 — Core Satellite Industry ────────────────────────────
  {
    name: 'SpaceNews',
    feedUrl: 'https://spacenews.com/feed/',
    category: 'industry',
    enabled: true,
  },
  {
    name: 'Via Satellite',
    feedUrl: 'https://www.satellitetoday.com/feed/',
    category: 'industry',
    enabled: true,
  },
  {
    name: 'SatNews',
    feedUrl: 'https://news.satnews.com/feed/',
    category: 'industry',
    enabled: true,
  },
  {
    name: 'FCC Public Notices (IBFS)',
    feedUrl: 'https://fcc.report/IBFS/Filing-List/Public-Notices.rss',
    category: 'regulatory',
    enabled: true,
  },
  {
    name: 'FCC Federal Register',
    feedUrl:
      'https://www.federalregister.gov/api/v1/documents.rss?conditions[agencies][]=federal-communications-commission',
    category: 'regulatory',
    enabled: false, // federalregister.gov blocks automated article extraction
  },

  // ── Tier 2 — Operator Press Releases ────────────────────────────
  {
    name: 'Viasat Investor',
    feedUrl: 'https://investors.viasat.com/rss-news-feeds',
    category: 'operator',
    enabled: false,
  },
  {
    name: 'EchoStar / Hughes',
    feedUrl: 'https://ir.echostar.com/rss-news-feeds',
    category: 'operator',
    enabled: false,
  },
  {
    name: 'Eutelsat / OneWeb',
    feedUrl: 'https://www.mynewsdesk.com/eutelsat/rss',
    category: 'operator',
    enabled: false,
  },

  // ── Tier 3 — M&A / Telecom Analysis ────────────────────────────
  {
    name: 'Telecom Ramblings',
    feedUrl: 'http://feeds2.feedburner.com/TelecomRamblings',
    category: 'financial',
    enabled: false,
  },
  {
    name: 'Ars Technica Space',
    feedUrl: 'https://arstechnica.com/space/feed/',
    category: 'community',
    enabled: false,
  },
  {
    name: 'Spaceflight Now',
    feedUrl: 'https://spaceflightnow.com/feed/',
    category: 'community',
    enabled: false,
  },
];
