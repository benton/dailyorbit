import { describe, it, expect } from 'vitest';
import { createLogger, type AppLogger } from './logger.ts';

describe('createLogger', () => {
  it('returns a pino logger with expected methods', () => {
    const log: AppLogger = createLogger({ env: 'test' });
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.child).toBe('function');
  });

  it('outputs JSON when env is production', () => {
    const chunks: string[] = [];
    const dest = { write: (s: string): void => { chunks.push(s); } };
    const log: AppLogger = createLogger({ env: 'production', destination: dest });
    log.info({ event: 'test' }, 'hello');
    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(parsed).toHaveProperty('time');
    expect(parsed).toHaveProperty('msg', 'hello');
    expect(parsed).toHaveProperty('event', 'test');
  });

  it('includes ISO 8601 timestamp in JSON output', () => {
    const chunks: string[] = [];
    const dest = { write: (s: string): void => { chunks.push(s); } };
    const log: AppLogger = createLogger({ env: 'production', destination: dest });
    log.info('timestamp check');
    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(typeof parsed.time).toBe('string');
    expect(parsed.time).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('creates child loggers with bound context', () => {
    const chunks: string[] = [];
    const dest = { write: (s: string): void => { chunks.push(s); } };
    const log: AppLogger = createLogger({ env: 'production', destination: dest });
    const child: AppLogger = log.child({ module: 'pipeline' });
    child.info('stage started');
    const parsed: Record<string, unknown> = JSON.parse(chunks[0]!);
    expect(parsed).toHaveProperty('module', 'pipeline');
  });
});
