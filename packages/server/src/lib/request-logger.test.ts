import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { requestLogger } from './request-logger.ts';
import { createLogger, type AppLogger } from './logger.ts';

describe('requestLogger middleware', () => {
  it('logs method, path, status, and duration', async () => {
    const chunks: string[] = [];
    const dest = {
      write: (s: string): void => {
        chunks.push(s);
      },
    };
    const log: AppLogger = createLogger({
      env: 'production',
      destination: dest,
    });

    const app: Hono = new Hono();
    app.use('*', requestLogger(log));
    app.get('/api/test', (c) => c.json({ ok: true }));

    const res: Response = await app.request('/api/test');
    expect(res.status).toBe(200);
    expect(chunks.length).toBe(1);

    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(parsed).toHaveProperty('method', 'GET');
    expect(parsed).toHaveProperty('path', '/api/test');
    expect(parsed).toHaveProperty('status', 200);
    expect(parsed).toHaveProperty('durationMs');
    expect(typeof parsed.durationMs).toBe('number');
  });
});
