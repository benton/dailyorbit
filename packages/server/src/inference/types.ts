/** Role for a message in a conversation. */
export type MessageRole = 'user' | 'assistant';

/** A single message in a conversation. */
export type InferenceMessage = {
  readonly role: MessageRole;
  readonly content: string;
};

/** Parameters controlling generation behavior. */
export type InferenceParams = {
  /** Maximum tokens to generate. */
  readonly maxTokens?: number;
  /** Sampling temperature (0–1). */
  readonly temperature?: number;
  /** Top-p nucleus sampling (0–1). */
  readonly topP?: number;
  /** Optional system prompt prepended to the conversation. */
  readonly systemPrompt?: string;
};

/** A request to the internal inference API. */
export type InferenceRequest = {
  /** Bedrock model ID. If omitted, uses bedrockDefaultModel config. */
  readonly modelId?: string;
  /** Conversation messages. Must contain at least one user message. */
  readonly messages: readonly InferenceMessage[];
  /** Generation parameters. */
  readonly params?: InferenceParams;
};

/** Token usage from a single inference call. */
export type TokenUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
};

/** The normalized response from an inference call. */
export type InferenceResponse = {
  /** The model's generated text. */
  readonly content: string;
  /** The model ID that actually served the request. */
  readonly modelId: string;
  /** Token usage statistics. */
  readonly usage: TokenUsage;
  /** Bedrock stop reason (end_turn, max_tokens, etc.). */
  readonly stopReason: string;
  /** Wall-clock latency in milliseconds. */
  readonly latencyMs: number;
};

/** Describes a model available for inference. */
export type ModelInfo = {
  readonly modelId: string;
  readonly modelName: string;
  readonly provider: string;
};
