import { getConfigService } from '../lib/config.ts';
import { BedrockClient } from './bedrock-client.ts';
import { InferenceService } from './inference-service.ts';

let _service: InferenceService | null = null;

/** Get or create the singleton InferenceService backed by Bedrock. */
export function getInferenceService(): InferenceService {
  if (_service == null) {
    const config = getConfigService();
    const region: string = config.get('bedrockRegion') as string;
    const client = new BedrockClient(region);
    _service = new InferenceService(client);
  }
  return _service;
}

/** Reset the singleton (used when config changes). */
export function resetInferenceService(): void {
  _service = null;
}

export { InferenceService } from './inference-service.ts';
export type {
  InferenceMessage,
  InferenceParams,
  InferenceRequest,
  InferenceResponse,
  ModelInfo,
  TokenUsage,
} from './types.ts';
