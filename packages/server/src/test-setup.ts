import type pino from 'pino';
import { createLogger, setLogger } from './lib/logger.ts';

/**
 * Vitest per-worker setup — silence the singleton application logger so
 * repository/pipeline log output doesn't drown the test reporter.
 * Set LOG_LEVEL (e.g. LOG_LEVEL=info) to get logs back while debugging.
 */
const level: pino.LevelWithSilent =
  (process.env.LOG_LEVEL as pino.LevelWithSilent | undefined) ?? 'silent';
setLogger(createLogger({ level }));
