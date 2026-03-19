import type { DuckDBConnection } from '@duckdb/node-api';
import { createConsultant, getConsultantBySlug } from './repository.ts';

const SEED_CONSULTANTS = [
  {
    name: 'General Analyst',
    slug: 'general-analyst',
    description:
      'Balanced FCC filing Q&A — a good starting point for any question about filings, companies, or regulatory activity.',
    systemPrompt:
      'Your focus is providing clear, well-sourced answers about FCC filings and satellite communications. You cover all aspects of the IBFS dataset: applications, comments, attachments, companies, and news. Provide balanced analysis with citations.',
    icon: '🔍',
    color: '#3B82F6',
    sortOrder: 0,
    enabled: true,
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
  },
  {
    name: 'Regulatory Strategist',
    slug: 'regulatory-strategist',
    description:
      'Focuses on procedural status, approval timelines, legal precedent, and recommended actions.',
    systemPrompt:
      'Your focus is regulatory procedure and legal strategy in FCC satellite licensing. When analyzing filings, emphasize: where the application sits in the approval process, relevant procedural deadlines, precedent from similar filings, potential objections or conditions, and what actions the filer or interested parties should consider. Frame your answers in terms of regulatory risk and strategic positioning.',
    icon: '⚖️',
    color: '#8B5CF6',
    sortOrder: 1,
    enabled: true,
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
  },
  {
    name: 'Competitive Intelligence',
    slug: 'competitive-intelligence',
    description:
      'Focuses on market positioning, company activity patterns, spectrum competition, and M&A implications.',
    systemPrompt:
      "Your focus is market dynamics and corporate strategy in the satellite communications industry. When analyzing filings, emphasize: who is competing for the same spectrum or orbital slots, patterns in a company's filing activity over time, M&A implications from transfer-of-control or assignment filings, and strategic positioning relative to competitors. Frame your answers in terms of competitive advantage and business impact.",
    icon: '📊',
    color: '#059669',
    sortOrder: 2,
    enabled: true,
    modelId: null,
    temperature: null,
    maxResponseTokens: null,
  },
];

export async function seedConsultants(
  conn: DuckDBConnection,
): Promise<{ created: number; skipped: number }> {
  let created: number = 0;
  let skipped: number = 0;

  for (const seed of SEED_CONSULTANTS) {
    const existing = await getConsultantBySlug(conn, seed.slug);
    if (existing != null) {
      skipped++;
      continue;
    }
    await createConsultant(conn, seed);
    created++;
  }

  return { created, skipped };
}
