import type { BedrockClientLike } from './bedrock-client.ts';
import type { EmbeddingRequest, EmbeddingResponse } from './types.ts';

/** Function signature for embedding a single text — allows test injection. */
export type EmbedFunction = (
  req: EmbeddingRequest,
) => Promise<EmbeddingResponse>;

/**
 * Service for generating text embeddings via Bedrock.
 * Wraps BedrockClient.embed() with batch concurrency control.
 */
export class EmbeddingService {
  private readonly embedFn: EmbedFunction;

  constructor(client: { embed: EmbedFunction } | BedrockClientLike) {
    this.embedFn = (req: EmbeddingRequest) => client.embed(req);
  }

  /** Embed a single query string (for search-time). */
  async embedQuery(
    query: string,
    modelId: string,
    dimensions: number,
    normalize: boolean,
  ): Promise<EmbeddingResponse> {
    return this.embedFn({ modelId, inputText: query, dimensions, normalize });
  }

  /**
   * Embed multiple texts with configurable concurrency.
   * Returns responses in the same order as the input texts.
   */
  async embedTexts(
    texts: readonly string[],
    modelId: string,
    dimensions: number,
    normalize: boolean,
    concurrency: number,
  ): Promise<EmbeddingResponse[]> {
    const results: EmbeddingResponse[] = Array.from<EmbeddingResponse>({
      length: texts.length,
    });
    let nextIndex: number = 0;

    async function worker(fn: EmbedFunction): Promise<void> {
      while (nextIndex < texts.length) {
        const idx: number = nextIndex++;
        results[idx] = await fn({
          modelId,
          inputText: texts[idx]!,
          dimensions,
          normalize,
        });
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(concurrency, texts.length); i++) {
      workers.push(worker(this.embedFn));
    }
    await Promise.all(workers);
    return results;
  }
}
