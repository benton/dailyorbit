import {
  BedrockClient as BedrockMgmtClient,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
  type ListFoundationModelsCommandOutput,
  type ListInferenceProfilesCommandOutput,
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

/** Parse Bedrock ListInferenceProfiles output into our ModelInfo type. */
export function parseInferenceProfiles(
  raw: Partial<ListInferenceProfilesCommandOutput>,
): ModelInfo[] {
  const profiles = raw.inferenceProfileSummaries ?? [];
  return profiles
    .filter((p) => p.status === 'ACTIVE' && p.type === 'SYSTEM_DEFINED')
    .map((p) => {
      // Extract provider from the profile name (e.g. "US Anthropic Claude 3 Haiku" -> "Anthropic")
      const nameParts: string[] = (p.inferenceProfileName ?? '').split(' ');
      // Skip the region prefix (US/EU) to get the provider
      const provider: string =
        nameParts.length > 1 ? (nameParts[1] ?? '') : (nameParts[0] ?? '');
      const modelName: string =
        nameParts.slice(2).join(' ') || (p.inferenceProfileName ?? '');
      return {
        modelId: p.inferenceProfileId ?? '',
        modelName,
        provider,
      };
    });
}

/**
 * List models available for inference in the configured region.
 * Returns inference profiles (which include Anthropic and other INFERENCE_PROFILE-only models)
 * plus ON_DEMAND foundation models that don't have inference profiles.
 */
export async function listAvailableModels(
  region: string,
): Promise<ModelInfo[]> {
  const client = new BedrockMgmtClient({ region });

  // Fetch inference profiles — these are the IDs that actually work for invocation
  const profilePages: ModelInfo[] = [];
  let nextToken: string | undefined;
  do {
    const resp: ListInferenceProfilesCommandOutput = await client.send(
      new ListInferenceProfilesCommand({
        maxResults: 100,
        nextToken,
      }),
    );
    profilePages.push(...parseInferenceProfiles(resp));
    nextToken = resp.nextToken;
  } while (nextToken != null);

  // Also fetch ON_DEMAND foundation models for providers not covered by profiles
  const foundationResp = await client.send(
    new ListFoundationModelsCommand({
      byOutputModality: 'TEXT',
      byInferenceType: 'ON_DEMAND',
    }),
  );
  const foundationModels: ModelInfo[] = parseModelList(foundationResp);

  // Deduplicate: prefer inference profile IDs over bare foundation model IDs
  const profileModelIds: Set<string> = new Set(
    profilePages.map((p) => p.modelId.replace(/^[a-z]+\./, '')),
  );
  const uniqueFoundation: ModelInfo[] = foundationModels.filter(
    (m) => !profileModelIds.has(m.modelId),
  );

  return [...profilePages, ...uniqueFoundation];
}
