import { describe, expect, it } from 'vitest';
import { buildTitlePrompt, parseTitleResponse } from './auto-title.ts';

describe('auto-title', () => {
  describe('buildTitlePrompt', () => {
    it('includes the question and answer in the prompt', () => {
      const prompt = buildTitlePrompt('What is STA?', 'STA stands for Special Temporary Authority.');
      expect(prompt).toContain('What is STA?');
      expect(prompt).toContain('STA stands for Special Temporary Authority.');
    });
  });

  describe('parseTitleResponse', () => {
    it('strips double quotes and trims whitespace', () => {
      expect(parseTitleResponse('"STA Overview"')).toEqual('STA Overview');
      expect(parseTitleResponse('  STA Overview  ')).toEqual('STA Overview');
    });

    it('strips single quotes', () => {
      expect(parseTitleResponse("'STA Overview'")).toEqual('STA Overview');
    });

    it('truncates to 80 characters', () => {
      const long: string = 'A'.repeat(100);
      expect(parseTitleResponse(long).length).toBeLessThanOrEqual(80);
    });

    it('adds ellipsis when truncating', () => {
      const long: string = 'A'.repeat(100);
      expect(parseTitleResponse(long)).toMatch(/\.\.\.$/);
    });
  });
});
