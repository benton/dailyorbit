// Mirror of server-side query types (packages/server/src/query/types.ts).
// Duplicated rather than shared across the monorepo boundary.

export type RetrievedSource = {
  id: string;
  score: number;
  snippet: string;
  title: string;
  type: 'filing' | 'attachment' | 'pleading' | 'news';
  url?: string;
};

export type QueryUsage = {
  generateTokens: { input: number; output: number };
  retrievalMs: number;
  rewriteTokens: { input: number; output: number };
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
