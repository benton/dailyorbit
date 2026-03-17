import { describe, it, expect } from 'vitest';
import { EmbeddingService } from './embedding-service.ts';
import type { EmbeddingRequest, EmbeddingResponse } from './types.ts';

/** Create a mock embed function that returns a deterministic embedding. */
function createMockEmbedFn(expectedDimensions: number = 512): {
  embedFn: (req: EmbeddingRequest) => Promise<EmbeddingResponse>;
  calls: EmbeddingRequest[];
} {
  const calls: EmbeddingRequest[] = [];
  const embedFn = async (req: EmbeddingRequest): Promise<EmbeddingResponse> => {
    calls.push(req);
    // Deterministic embedding: hash-like pattern from input text length
    const embedding: number[] = Array.from(
      { length: expectedDimensions },
      (_, i: number) => Math.sin(req.inputText.length + i) * 0.5,
    );
    return {
      embedding,
      inputTokenCount: Math.ceil(req.inputText.length / 4),
      latencyMs: 10,
    };
  };
  return { embedFn, calls };
}

describe('EmbeddingService', () => {
  describe('embedQuery', () => {
    it('passes correct parameters to the embed function', async () => {
      const { embedFn, calls } = createMockEmbedFn();
      const service = new EmbeddingService({ embed: embedFn });

      const resp: EmbeddingResponse = await service.embedQuery(
        'satellite interference analysis',
        'amazon.titan-embed-text-v2:0',
        512,
        true,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        modelId: 'amazon.titan-embed-text-v2:0',
        inputText: 'satellite interference analysis',
        dimensions: 512,
        normalize: true,
      });
      expect(resp.embedding).toHaveLength(512);
      expect(resp.inputTokenCount).toEqual(
        Math.ceil('satellite interference analysis'.length / 4),
      );
    });
  });

  describe('embedTexts', () => {
    it('embeds multiple texts preserving order', async () => {
      const texts: readonly string[] = [
        'first document about Ka-band',
        'second document about C-band',
        'third document about Ku-band',
      ];
      const { embedFn, calls } = createMockEmbedFn();
      const service = new EmbeddingService({ embed: embedFn });

      const responses: EmbeddingResponse[] = await service.embedTexts(
        texts,
        'amazon.titan-embed-text-v2:0',
        512,
        true,
        2,
      );

      expect(responses).toHaveLength(3);
      expect(calls).toHaveLength(3);
      // Each response should have the correct token count matching its input
      for (let i = 0; i < texts.length; i++) {
        expect(responses[i]!.inputTokenCount).toEqual(
          Math.ceil(texts[i]!.length / 4),
        );
        expect(responses[i]!.embedding).toHaveLength(512);
      }
    });

    it('respects concurrency limit', async () => {
      let maxConcurrent: number = 0;
      let currentConcurrent: number = 0;

      const embedFn = async (
        _req: EmbeddingRequest,
      ): Promise<EmbeddingResponse> => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 10));
        currentConcurrent--;
        return {
          embedding: Array.from({ length: 512 }, () => 0),
          inputTokenCount: 1,
          latencyMs: 10,
        };
      };

      const service = new EmbeddingService({ embed: embedFn });
      const texts: string[] = Array.from(
        { length: 10 },
        (_, i) => `text ${String(i)}`,
      );

      await service.embedTexts(texts, 'model', 512, true, 3);

      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(maxConcurrent).toBeGreaterThan(1);
    });

    it('returns empty array for empty input', async () => {
      const { embedFn, calls } = createMockEmbedFn();
      const service = new EmbeddingService({ embed: embedFn });

      const responses: EmbeddingResponse[] = await service.embedTexts(
        [],
        'model',
        512,
        true,
        5,
      );

      expect(responses).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it('works with different dimension sizes', async () => {
      const { embedFn } = createMockEmbedFn(256);
      const service = new EmbeddingService({ embed: embedFn });

      const responses: EmbeddingResponse[] = await service.embedTexts(
        ['test text'],
        'model',
        256,
        false,
        1,
      );

      expect(responses[0]!.embedding).toHaveLength(256);
    });
  });
});
