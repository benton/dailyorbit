import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  InvokeModelCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type ConverseStreamCommandInput,
  type ConverseStreamOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
  ImageGenerationRequest,
  ImageGenerationResponse,
  InferenceRequest,
  InferenceResponse,
} from './types.ts';

/** Build a Bedrock ConverseCommandInput from our internal request type. */
export function buildConverseInput(
  req: InferenceRequest,
): ConverseCommandInput {
  const messages = req.messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: [{ text: m.content }],
  }));

  const input: ConverseCommandInput = {
    modelId: req.modelId,
    messages,
  };

  const params = req.params;
  if (params != null) {
    const inferenceConfig: Record<string, number> = {};
    if (params.maxTokens != null) inferenceConfig.maxTokens = params.maxTokens;
    if (params.temperature != null)
      inferenceConfig.temperature = params.temperature;
    if (params.topP != null) inferenceConfig.topP = params.topP;
    if (Object.keys(inferenceConfig).length > 0) {
      input.inferenceConfig = inferenceConfig;
    }
    if (params.systemPrompt != null) {
      input.system = [{ text: params.systemPrompt }];
    }
  }

  return input;
}

/** Parse a Bedrock ConverseCommandOutput into our internal response type. */
export function parseConverseOutput(
  raw: ConverseCommandOutput,
  modelId: string,
  latencyMs: number,
): InferenceResponse {
  const textBlocks = raw.output?.message?.content ?? [];
  const content: string = textBlocks
    .filter((block) => block.text != null)
    .map((block) => block.text!)
    .join('');

  return {
    content,
    modelId,
    usage: {
      inputTokens: raw.usage?.inputTokens ?? 0,
      outputTokens: raw.usage?.outputTokens ?? 0,
      totalTokens: raw.usage?.totalTokens ?? 0,
    },
    stopReason: raw.stopReason ?? 'unknown',
    latencyMs,
  };
}

/** Common interface for all Bedrock client implementations. */
export type BedrockClientLike = {
  converse(input: ConverseCommandInput): Promise<ConverseCommandOutput>;
  converseStream(
    input: ConverseStreamCommandInput,
  ): AsyncGenerator<ConverseStreamOutput>;
  embed(req: EmbeddingRequest): Promise<EmbeddingResponse>;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResponse>;
};

/** Thin wrapper around BedrockRuntimeClient that calls Converse. */
export class BedrockClient implements BedrockClientLike {
  private readonly client: BedrockRuntimeClient;

  constructor(region: string) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async converse(input: ConverseCommandInput): Promise<ConverseCommandOutput> {
    return this.client.send(new ConverseCommand(input));
  }

  /** Stream a conversation response, yielding raw SDK events. */
  async *converseStream(
    input: ConverseStreamCommandInput,
  ): AsyncGenerator<ConverseStreamOutput> {
    const response = await this.client.send(new ConverseStreamCommand(input));
    if (response.stream == null) return;
    for await (const event of response.stream) {
      yield event;
    }
  }

  /** Embed text using a Titan-compatible embedding model via InvokeModel. */
  async embed(req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const body: string = JSON.stringify({
      inputText: req.inputText,
      dimensions: req.dimensions,
      normalize: req.normalize,
    });

    const start: number = performance.now();
    const command = new InvokeModelCommand({
      modelId: req.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await this.client.send(command);
    const latencyMs: number = Math.round(performance.now() - start);
    const parsed: { embedding: number[]; inputTextTokenCount: number } =
      JSON.parse(new TextDecoder().decode(response.body));

    return {
      embedding: parsed.embedding,
      inputTokenCount: parsed.inputTextTokenCount,
      latencyMs,
    };
  }

  /** Generate images using a Nova Canvas / Titan Image model via InvokeModel. */
  async generateImage(
    req: ImageGenerationRequest,
  ): Promise<ImageGenerationResponse> {
    const body: string = JSON.stringify({
      taskType: 'TEXT_IMAGE',
      textToImageParams: {
        text: req.prompt,
        negativeText:
          req.negativePrompt ?? 'photograph, realistic, color, modern, blurry',
      },
      imageGenerationConfig: {
        numberOfImages: req.numberOfImages ?? 1,
        width: req.width ?? 1024,
        height: req.height ?? 768,
        cfgScale: req.cfgScale ?? 8,
        ...(req.seed != null ? { seed: req.seed } : {}),
      },
    });

    const start: number = performance.now();
    const command = new InvokeModelCommand({
      modelId: req.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await this.client.send(command);
    const latencyMs: number = Math.round(performance.now() - start);
    const parsed: { images?: string[]; error?: string } = JSON.parse(
      new TextDecoder().decode(response.body),
    );

    if (!parsed.images || parsed.images.length === 0) {
      throw new Error(
        parsed.error ?? 'Image generation returned no images',
      );
    }

    return {
      images: parsed.images.map((b64: string) => Buffer.from(b64, 'base64')),
      latencyMs,
    };
  }
}
