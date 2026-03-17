import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  EmbeddingRequest,
  EmbeddingResponse,
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

/** Thin wrapper around BedrockRuntimeClient that calls Converse. */
export class BedrockClient {
  private readonly client: BedrockRuntimeClient;

  constructor(region: string) {
    this.client = new BedrockRuntimeClient({ region });
  }

  async converse(input: ConverseCommandInput): Promise<ConverseCommandOutput> {
    return this.client.send(new ConverseCommand(input));
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
}
