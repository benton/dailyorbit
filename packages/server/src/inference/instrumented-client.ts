import type {
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommandInput,
  ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { BedrockClientLike } from './bedrock-client.ts';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
} from './types.ts';
import { logInference } from './log-repository.ts';

/**
 * Wraps a BedrockClient and transparently logs every call to inference_log.
 * Matches the BedrockClient interface so consumers don't need to change.
 */
export class InstrumentedBedrockClient implements BedrockClientLike {
  private readonly inner: BedrockClientLike;
  private conn: DuckDBConnection | null;

  /** Optional caller tag written to each log entry (e.g. 'chat', 'summarize'). */
  caller: string | undefined;

  /** Optional user ID for user-attributed cost tracking. */
  userId: string | undefined;

  /** Optional conversation ID for chat cost tracking. */
  conversationId: string | undefined;

  constructor(
    inner: BedrockClientLike,
    conn: DuckDBConnection | null,
    caller?: string,
  ) {
    this.inner = inner;
    this.conn = conn;
    this.caller = caller;
  }

  /** Set the logging connection (used for lazy initialization). */
  setConnection(conn: DuckDBConnection): void {
    this.conn = conn;
  }

  async converse(input: ConverseCommandInput): Promise<ConverseCommandOutput> {
    const start: number = performance.now();
    const result: ConverseCommandOutput = await this.inner.converse(input);
    const latencyMs: number = Math.round(performance.now() - start);

    this.logEntry({
      modelId: input.modelId ?? 'unknown',
      operation: 'converse',
      caller: this.caller,
      userId: this.userId,
      conversationId: this.conversationId,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      latencyMs,
    });

    return result;
  }

  async *converseStream(
    input: ConverseStreamCommandInput,
  ): AsyncGenerator<ConverseStreamOutput> {
    const start: number = performance.now();
    let inputTokens: number = 0;
    let outputTokens: number = 0;

    for await (const event of this.inner.converseStream(input)) {
      if (event.metadata?.usage != null) {
        inputTokens = event.metadata.usage.inputTokens ?? 0;
        outputTokens = event.metadata.usage.outputTokens ?? 0;
      }
      yield event;
    }

    const latencyMs: number = Math.round(performance.now() - start);
    this.logEntry({
      modelId: input.modelId ?? 'unknown',
      operation: 'converse_stream',
      caller: this.caller,
      userId: this.userId,
      conversationId: this.conversationId,
      inputTokens,
      outputTokens,
      latencyMs,
    });
  }

  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const result: EmbeddingResponse = await this.inner.embed(req);

    this.logEntry({
      modelId: req.modelId,
      operation: 'embed',
      caller: this.caller,
      userId: this.userId,
      conversationId: this.conversationId,
      inputTokens: result.inputTokenCount,
      outputTokens: 0,
      latencyMs: result.latencyMs,
    });

    return result;
  }

  async generateImage(
    req: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse> {
    const start: number = performance.now();
    const result: ImageGenerationResponse = await this.inner.generateImage(req);
    const latencyMs: number = Math.round(performance.now() - start);

    this.logEntry({
      modelId: req.modelId,
      operation: 'generate_image',
      caller: this.caller,
      userId: this.userId,
      conversationId: this.conversationId,
      inputTokens: 0,
      outputTokens: req.numberOfImages ?? 1,
      latencyMs,
    });

    return result;
  }

  /** Fire-and-forget log write. Errors are swallowed to avoid breaking the caller. */
  private logEntry(entry: {
    modelId: string;
    operation: 'converse' | 'converse_stream' | 'embed' | 'generate_image';
    caller?: string | undefined;
    userId?: string | undefined;
    conversationId?: string | undefined;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }): void {
    if (this.conn == null) return;
    logInference(this.conn, entry).catch(() => {
      // Logging failures must not break inference calls
    });
  }
}
