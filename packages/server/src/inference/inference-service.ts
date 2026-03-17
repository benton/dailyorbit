import type {
  ConverseCommandInput,
  ConverseCommandOutput,
} from '@aws-sdk/client-bedrock-runtime';
import { getConfigService } from '../lib/config.ts';
import { buildConverseInput, parseConverseOutput } from './bedrock-client.ts';
import type { InferenceRequest, InferenceResponse } from './types.ts';

/** Interface for the Bedrock converse call — real client or mock. */
export type ConverseFunction = {
  converse(input: ConverseCommandInput): Promise<ConverseCommandOutput>;
};

export class InferenceService {
  private readonly backend: ConverseFunction;

  constructor(backend: ConverseFunction) {
    this.backend = backend;
  }

  /** Run a completion request through Bedrock Converse. */
  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    let modelId: string | undefined = req.modelId;
    if (!modelId) {
      const config = getConfigService();
      modelId = config.get('bedrockDefaultModel') as string;
    }

    const input: ConverseCommandInput = buildConverseInput({ ...req, modelId });

    const start: number = performance.now();
    const raw: ConverseCommandOutput = await this.backend.converse(input);
    const latencyMs: number = Math.round(performance.now() - start);

    return parseConverseOutput(raw, modelId, latencyMs);
  }
}
