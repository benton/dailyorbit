import { describe, expect, it } from 'vitest';
import { parseInferenceProfiles, parseModelList } from './models.ts';

describe('parseModelList', () => {
  it('maps Bedrock ListFoundationModels output to ModelInfo array', () => {
    const raw = {
      modelSummaries: [
        { modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0', modelName: 'Claude Haiku 4.5', providerName: 'Anthropic' },
        { modelId: 'amazon.nova-micro-v1:0', modelName: 'Nova Micro', providerName: 'Amazon' },
      ],
    };

    const models = parseModelList(raw);
    expect(models).toEqual([
      { modelId: 'anthropic.claude-haiku-4-5-20251001-v1:0', modelName: 'Claude Haiku 4.5', provider: 'Anthropic' },
      { modelId: 'amazon.nova-micro-v1:0', modelName: 'Nova Micro', provider: 'Amazon' },
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
          inferenceProfileName: 'US Anthropic Claude 3 Haiku',
          inferenceProfileId: 'us.anthropic.claude-3-haiku-20240307-v1:0',
          status: 'ACTIVE',
          type: 'SYSTEM_DEFINED',
        },
        {
          inferenceProfileName: 'US Meta Llama 3.2 1B Instruct',
          inferenceProfileId: 'us.meta.llama3-2-1b-instruct-v1:0',
          status: 'ACTIVE',
          type: 'SYSTEM_DEFINED',
        },
      ],
    };

    const models = parseInferenceProfiles(raw);
    expect(models).toEqual([
      { modelId: 'us.anthropic.claude-3-haiku-20240307-v1:0', modelName: 'Claude 3 Haiku', provider: 'Anthropic' },
      { modelId: 'us.meta.llama3-2-1b-instruct-v1:0', modelName: 'Llama 3.2 1B Instruct', provider: 'Meta' },
    ]);
  });

  it('filters out inactive and non-system-defined profiles', () => {
    const raw = {
      inferenceProfileSummaries: [
        {
          inferenceProfileName: 'US Anthropic Claude 3 Haiku',
          inferenceProfileId: 'us.anthropic.claude-3-haiku-v1:0',
          status: 'INACTIVE',
          type: 'SYSTEM_DEFINED',
        },
        {
          inferenceProfileName: 'Custom Profile',
          inferenceProfileId: 'custom.profile-v1:0',
          status: 'ACTIVE',
          type: 'APPLICATION',
        },
      ],
    };

    expect(parseInferenceProfiles(raw)).toEqual([]);
  });

  it('returns empty array when no profiles', () => {
    expect(parseInferenceProfiles({})).toEqual([]);
    expect(parseInferenceProfiles({ inferenceProfileSummaries: [] })).toEqual([]);
  });
});
