import type { RetrievedSource, QueryUsage } from '../query/types.ts';

export type Conversation = {
  id: string;
  userId: string;
  consultantId: number;
  consultantName: string | null;
  consultantIcon: string | null;
  consultantColor: string | null;
  title: string | null;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostCents: number;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources: RetrievedSource[] | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number;
  modelId: string | null;
  consultantId: number | null;
  sequence: number;
  createdAt: string;
};

export type ConversationWithMessages = Conversation & {
  messages: Message[];
};

export type ChatSSEEvent =
  | {
      type: 'status';
      stage: 'rewriting' | 'retrieving' | 'generating';
      message: string;
    }
  | { type: 'sources'; sources: RetrievedSource[] }
  | { type: 'delta'; text: string }
  | { type: 'usage'; usage: QueryUsage & { costCents: number } }
  | { type: 'title'; title: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
