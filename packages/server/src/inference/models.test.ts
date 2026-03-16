import { describe, expect, it } from 'vitest';
import { parseInferenceProfiles, parseModelList } from './models.ts';

describe('parseModelList', () => {
  it('maps Bedrock ListFoundationModels output to ModelInfo array', () => {
    const raw = {
      modelSummaries: [
        {
          modelArn:
            'arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
          modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
          modelName: 'Claude Haiku 4.5',
          providerName: 'Anthropic',
        },
        {
          modelArn:
            'arn:aws:bedrock:us-east-2::foundation-model/amazon.nova-micro-v1:0',
          modelId: 'amazon.nova-micro-v1:0',
          modelName: 'Nova Micro',
          providerName: 'Amazon',
        },
      ],
    };

    const models = parseModelList(raw);
    expect(models).toEqual([
      {
        modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0',
        modelName: 'Claude Haiku 4.5',
        provider: 'Anthropic',
      },
      {
        modelId: 'amazon.nova-micro-v1:0',
        modelName: 'Nova Micro',
        provider: 'Amazon',
      },
    ]);
  });

  it('returns empty array when no model summaries', () => {
    expect(parseModelList({})).toEqual([]);
    expect(parseModelList({ modelSummaries: [] })).toEqual([]);
  });
});

describe('parseInferenceProfiles', () => {
  it('maps active system-defined profiles to ModelInfo with provider extracted from name', () => {
    const raw = {
      inferenceProfileSummaries: [
        {
          inferenceProfileArn:
            'arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-3-haiku-20240307-v1:0',
          inferenceProfileName: 'US Anthropic Claude 3 Haiku',
          inferenceProfileId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
          status: 'ACTIVE' as const,
          type: 'SYSTEM_DEFINED' as const,
          models: [],
        },
        {
          inferenceProfileArn:
            'arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.meta.llama3-2-1b-instruct-v1:0',
          inferenceProfileName: 'US Meta Llama 3.2 1B Instruct',
          inferenceProfileId: 'us.meta.llama3-2-1b-instruct-v1:0',
          status: 'ACTIVE' as const,
          type: 'SYSTEM_DEFINED' as const,
          models: [],
        },
      ],
    };

    const models = parseInferenceProfiles(raw);
    expect(models).toEqual([
      {
        modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
        modelName: 'Claude 3 Haiku',
        provider: 'Anthropic',
      },
      {
        modelId: 'us.meta.llama3-2-1b-instruct-v1:0',
        modelName: 'Llama 3.2 1B Instruct',
        provider: 'Meta',
      },
    ]);
  });

  it('filters out inactive and non-system-defined profiles', () => {
    // Use type assertion: the SDK types status as literal 'ACTIVE' only,
    // but the runtime API can return 'INACTIVE' — we need to test that filtering.
    const raw = {
      inferenceProfileSummaries: [
        {
          inferenceProfileArn:
            'arn:aws:bedrock:us-east-2:123456789012:inference-profile/us.anthropic.claude-3-haiku-v1:0',
          inferenceProfileName: 'US Anthropic Claude 3 Haiku',
          inferenceProfileId: 'us.anthropic.claude-3-haiku-v1:0',
          status: 'INACTIVE',
          type: 'SYSTEM_DEFINED',
          models: [],
        },
        {
          inferenceProfileArn:
            'arn:aws:bedrock:us-east-2:123456789012:inference-profile/custom.profile-v1:0',
          inferenceProfileName: 'Custom Profile',
          inferenceProfileId: 'custom.profile-v1:0',
          status: 'ACTIVE',
          type: 'APPLICATION',
          models: [],
        },
      ] as unknown as import('@aws-sdk/client-bedrock').InferenceProfileSummary[],
    };

    expect(parseInferenceProfiles(raw)).toEqual([]);
  });

  it('returns empty array when no profiles', () => {
    expect(parseInferenceProfiles({})).toEqual([]);
    expect(parseInferenceProfiles({ inferenceProfileSummaries: [] })).toEqual(
      [],
    );
  });
});
