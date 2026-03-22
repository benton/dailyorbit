import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DuckDBConnection, DuckDBInstance } from '@duckdb/node-api';
import { ensureConsultantTables } from '../consultant/schema.ts';
import { createConsultant } from '../consultant/repository.ts';
import { ensureInferenceLogTable } from '../inference/schema.ts';
import { ensureChatTables } from './schema.ts';
import {
  createConversation,
  getConversationById,
  listConversations,
  updateConversationTitle,
  deleteConversation,
  createMessage,
  listMessages,
  getNextSequence,
  updateConversationTotals,
} from './repository.ts';

describe('chat repository', () => {
  let db: DuckDBInstance;
  let conn: DuckDBConnection;
  let consultantId: number;

  beforeEach(async () => {
    db = await DuckDBInstance.create(':memory:');
    conn = await DuckDBConnection.create(db);
    await ensureConsultantTables(conn);
    await ensureChatTables(conn);
    await ensureInferenceLogTable(conn);

    const consultant = await createConsultant(conn, {
      name: 'Test Consultant',
      slug: 'test-consultant',
      description: 'For testing',
      systemPrompt: 'You are a test consultant.',
      modelId: null,
      temperature: null,
      maxResponseTokens: null,
      icon: '🧪',
      color: '#FF0000',
      sortOrder: 0,
      enabled: true,
    });
    consultantId = consultant.id;
  });

  afterEach(() => {
    conn.closeSync();
  });

  describe('createConversation', () => {
    it('creates a conversation with generated UUID', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });

      expect(conv.id).toBeTruthy();
      expect(conv.userId).toEqual('user-1');
      expect(conv.consultantId).toEqual(consultantId);
      expect(conv.title).toBeNull();
      expect(conv.totalInputTokens).toEqual(0);
      expect(conv.totalCostCents).toEqual(0);
    });
  });

  describe('listConversations', () => {
    it('returns only conversations for the specified user', async () => {
      await createConversation(conn, { userId: 'user-1', consultantId });
      await createConversation(conn, { userId: 'user-2', consultantId });

      const result = await listConversations(conn, 'user-1');
      expect(result).toHaveLength(1);
      expect(result[0]!.userId).toEqual('user-1');
    });
  });

  describe('updateConversationTitle', () => {
    it('updates the title', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });
      const updated = await updateConversationTitle(conn, conv.id, 'New Title');
      expect(updated!.title).toEqual('New Title');
    });
  });

  describe('deleteConversation', () => {
    it('deletes conversation and its messages', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });
      await createMessage(conn, {
        conversationId: conv.id,
        role: 'user',
        content: 'Hello',
        sequence: 1,
      });

      const deleted = await deleteConversation(conn, conv.id);
      expect(deleted).toEqual(true);

      const found = await getConversationById(conn, conv.id);
      expect(found).toBeNull();

      const messages = await listMessages(conn, conv.id);
      expect(messages).toHaveLength(0);
    });
  });

  describe('messages', () => {
    it('creates and lists messages in sequence order', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });

      await createMessage(conn, {
        conversationId: conv.id,
        role: 'user',
        content: 'What is STA?',
        sequence: 1,
      });
      await createMessage(conn, {
        conversationId: conv.id,
        role: 'assistant',
        content: 'STA stands for Special Temporary Authority.',
        sources: [
          {
            type: 'filing',
            id: 'SAT-STA-123',
            title: 'Test',
            snippet: 'test',
            score: 1.0,
          },
        ],
        inputTokens: 100,
        outputTokens: 50,
        costCents: 0.02,
        modelId: 'us.amazon.nova-pro-v1:0',
        consultantId,
        sequence: 2,
      });

      const messages = await listMessages(conn, conv.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]!.role).toEqual('user');
      expect(messages[0]!.sequence).toEqual(1);
      expect(messages[1]!.role).toEqual('assistant');
      expect(messages[1]!.sources).toHaveLength(1);
    });
  });

  describe('getNextSequence', () => {
    it('returns 1 for empty conversation', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });
      const seq = await getNextSequence(conn, conv.id);
      expect(seq).toEqual(1);
    });

    it('returns max + 1 after messages exist', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });
      await createMessage(conn, {
        conversationId: conv.id,
        role: 'user',
        content: 'Hi',
        sequence: 1,
      });
      const seq = await getNextSequence(conn, conv.id);
      expect(seq).toEqual(2);
    });
  });

  describe('updateConversationTotals', () => {
    it('increments token and cost totals', async () => {
      const conv = await createConversation(conn, {
        userId: 'user-1',
        consultantId,
      });
      await updateConversationTotals(conn, conv.id, {
        inputTokens: 100,
        outputTokens: 50,
        costCents: 0.5,
        consultantId,
      });
      const updated = await getConversationById(conn, conv.id);
      expect(updated!.totalInputTokens).toEqual(100);
      expect(updated!.totalOutputTokens).toEqual(50);
      expect(updated!.totalCostCents).toBeCloseTo(0.5);
    });
  });
});
