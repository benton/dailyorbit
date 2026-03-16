import {
  BedrockClient as BedrockMgmtClient,
  ListFoundationModelsCommand,
  type ListFoundationModelsCommandOutput,
} from '@aws-sdk/client-bedrock';
import type { ModelInfo } from './types.ts';

/** Parse Bedrock ListFoundationModels output into our ModelInfo type. */
export function parseModelList(
  raw: Partial<ListFoundationModelsCommandOutput>,
): ModelInfo[] {
  const summaries = raw.modelSummaries ?? [];
  return summaries.map((s) => ({
    modelId: s.modelId ?? '',
    modelName: s.modelName ?? '',
    provider: s.providerName ?? '',
  }));
}

/** List text-generation models available in the configured region. */
export async function listAvailableModels(region: string): Promise<ModelInfo[]> {
  const client = new BedrockMgmtClient({ region });
  const resp = await client.send(
    new ListFoundationModelsCommand({
      byOutputModality: 'TEXT',
    }),
  );
  return parseModelList(resp);
}
