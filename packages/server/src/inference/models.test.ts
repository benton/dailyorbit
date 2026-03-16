import { describe, expect, it } from 'vitest';
import { parseModelList } from './models.ts';

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
