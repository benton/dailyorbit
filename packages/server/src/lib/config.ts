import type { ConfigService } from './config-service.ts';

let instance: ConfigService | null = null;

export function setConfigService(service: ConfigService): void {
  instance = service;
}

export function getConfigService(): ConfigService {
  if (instance == null) {
    throw new Error(
      'ConfigService not initialized. Call setConfigService() during startup.',
    );
  }
  return instance;
}
