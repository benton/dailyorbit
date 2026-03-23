import type { MiddlewareHandler } from 'hono';
import type { AppLogger } from './logger.ts';

export function requestLogger(logger: AppLogger): MiddlewareHandler {
  const log: AppLogger = logger.child({ module: 'http' });

  return async (c, next) => {
    const start: number = Date.now();
    await next();
    const durationMs: number = Date.now() - start;

    log.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      },
      'request',
    );
  };
}
