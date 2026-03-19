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
      message: string;
      stage: 'rewriting' | 'retrieving' | 'generating';
      type: 'status';
    }
  | { sources: Array<RetrievedSource>; type: 'sources' }
  | { text: string; type: 'delta' }
  | { type: 'usage'; usage: QueryUsage }
  | { type: 'done' }
  | { message: string; type: 'error' };
