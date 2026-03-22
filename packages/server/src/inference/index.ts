import { DuckDBConnection } from '@duckdb/node-api';
import { getConfigService } from '../lib/config.ts';
import { getDb } from '../lib/db.ts';
import { trackConnection } from '../lib/graceful-shutdown.ts';
import { BedrockClient } from './bedrock-client.ts';
import { InstrumentedBedrockClient } from './instrumented-client.ts';
import { InferenceService } from './inference-service.ts';
import { ensureInferenceLogTable } from './schema.ts';

let _service: InferenceService | null = null;
let _logConn: DuckDBConnection | null = null;

/** Get or create a dedicated connection for inference logging. */
async function getLogConnection(): Promise<DuckDBConnection> {
  if (_logConn == null) {
    const db = await getDb();
    _logConn = await DuckDBConnection.create(db);
    trackConnection(_logConn);
    await ensureInferenceLogTable(_logConn);
  }
  return _logConn;
}

/** Get or create the singleton InferenceService backed by Bedrock. */
export function getInferenceService(): InferenceService {
  if (_service == null) {
    const config = getConfigService();
    const region: string = config.get('bedrockRegion') as string;
    const raw = new BedrockClient(region);
    // Wrap with instrumented client — logging connection is set lazily
    const client = new InstrumentedBedrockClient(raw, null);
    // Kick off async connection setup (non-blocking)
    getLogConnection()
      .then((conn) => {
        client.setConnection(conn);
      })
      .catch(() => {
        // Logging unavailable — inference still works
      });
    _service = new InferenceService(client);
  }
  return _service;
}

/** Reset the singleton (used when config changes). */
export function resetInferenceService(): void {
  _service = null;
  _logConn = null;
}

export { InferenceService } from './inference-service.ts';
export { InstrumentedBedrockClient } from './instrumented-client.ts';
export type {
  InferenceMessage,
  InferenceParams,
  InferenceRequest,
  InferenceResponse,
  ModelInfo,
  TokenUsage,
} from './types.ts';
