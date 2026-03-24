/**
 * Static pricing table for Bedrock models in use.
 * Prices are in USD per 1,000 tokens.
 * Source: AWS Bedrock pricing page (as of 2025-03).
 */
type ModelPricing = {
  readonly inputPer1k: number;
  readonly outputPer1k: number;
};

const PRICING: Record<string, ModelPricing> = {
  // Amazon Nova
  'us.amazon.nova-pro-v1:0': { inputPer1k: 0.0008, outputPer1k: 0.0032 },
  'amazon.nova-pro-v1:0': { inputPer1k: 0.0008, outputPer1k: 0.0032 },
  'us.amazon.nova-micro-v1:0': { inputPer1k: 0.000035, outputPer1k: 0.00014 },
  'amazon.nova-micro-v1:0': { inputPer1k: 0.000035, outputPer1k: 0.00014 },
  'us.amazon.nova-lite-v1:0': { inputPer1k: 0.00006, outputPer1k: 0.00024 },
  'amazon.nova-lite-v1:0': { inputPer1k: 0.00006, outputPer1k: 0.00024 },

  // Anthropic Claude (Haiku)
  'us.anthropic.claude-3-haiku-20240307-v1:0': {
    inputPer1k: 0.00025,
    outputPer1k: 0.00125,
  },
  'anthropic.claude-3-haiku-20240307-v1:0': {
    inputPer1k: 0.00025,
    outputPer1k: 0.00125,
  },

  // Amazon Titan Embed
  'amazon.titan-embed-text-v2:0': { inputPer1k: 0.00002, outputPer1k: 0 },

  // Image generation (outputTokens tracks image count, so outputPer1k = cost per 1k images)
  'amazon.nova-canvas-v1:0': { inputPer1k: 0, outputPer1k: 8.0 },
  'amazon.titan-image-generator-v2:0': { inputPer1k: 0, outputPer1k: 8.0 },
};

/**
 * Compute cost in cents for a given model and token counts.
 * Returns 0 if the model is not in the pricing table.
 */
export function computeCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing: ModelPricing | undefined = PRICING[modelId];
  if (pricing == null) return 0;

  const inputCostUsd: number = (inputTokens / 1000) * pricing.inputPer1k;
  const outputCostUsd: number = (outputTokens / 1000) * pricing.outputPer1k;
  // Convert to cents
  return (inputCostUsd + outputCostUsd) * 100;
}

/** Return the set of model IDs that have pricing data. */
export function pricedModelIds(): string[] {
  return Object.keys(PRICING);
}
