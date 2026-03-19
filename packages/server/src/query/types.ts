export type RetrievedSource = {
  type: 'filing' | 'attachment' | 'pleading' | 'news';
  id: string;
  title: string;
  snippet: string;
  score: number;
  url?: string;
};

export type QueryUsage = {
  rewriteTokens: { input: number; output: number };
  generateTokens: { input: number; output: number };
  retrievalMs: number;
  totalMs: number;
};

export type QuerySSEEvent =
  | {
      type: 'status';
      stage: 'rewriting' | 'retrieving' | 'generating';
      message: string;
    }
  | { type: 'sources'; sources: RetrievedSource[] }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: QueryUsage }
  | { type: 'done' }
  | { type: 'error'; message: string };

export type RewrittenQuery = {
  text: string;
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    subsystems?: string[];
    company?: string;
    docTypes?: Array<'filing' | 'attachment' | 'pleading' | 'news'>;
  };
};
