// Mirror of server-side chat types (packages/server/src/chat/).
// Duplicated rather than shared across the monorepo boundary.

import type { QueryUsage, RetrievedSource } from '../query/types.ts';

export type Consultant = {
  archivedAt: string | null;
  color: string | null;
  description: string | null;
  enabled: boolean;
  icon: string | null;
  id: number;
  maxResponseTokens: number | null;
  modelId: string | null;
  name: string;
  slug: string;
  sortOrder: number;
  systemPrompt: string;
  temperature: number | null;
};

export type Conversation = {
  consultantColor: string | null;
  consultantIcon: string | null;
  consultantId: number;
  consultantName: string | null;
  createdAt: string;
  id: string;
  title: string | null;
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  updatedAt: string;
  userId: string;
};

export type Message = {
  consultantId: number | null;
  content: string;
  conversationId: string;
  costCents: number;
  createdAt: string;
  id: string;
  inputTokens: number | null;
  modelId: string | null;
  outputTokens: number | null;
  role: 'assistant' | 'user';
  sequence: number;
  sources: RetrievedSource[] | null;
};

export type ConversationWithMessages = Conversation & {
  messages: Array<Message>;
};

export type ChatSSEEvent =
  | {
      message: string;
      stage: 'generating' | 'retrieving' | 'rewriting';
      type: 'status';
    }
  | { sources: Array<RetrievedSource>; type: 'sources' }
  | { text: string; type: 'delta' }
  | { type: 'usage'; usage: QueryUsage & { costCents: number } }
  | { title: string; type: 'title' }
  | { type: 'done' }
  | { message: string; type: 'error' };
