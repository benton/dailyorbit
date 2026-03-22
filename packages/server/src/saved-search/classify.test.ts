import { describe, it, expect } from 'vitest';
import { classifySearchType } from './types.ts';
import type { FilingSearchFilters } from '../search/types.ts';
import type { NewsSearchFilters } from './types.ts';

describe('classifySearchType', () => {
  it('classifies filing search with only structured filters as metadata', () => {
    const filters: FilingSearchFilters = {
      subsystem_code: ['SAT'],
      applicant: 'SpaceX',
    };
    expect(classifySearchType('filing', filters)).toEqual('metadata');
  });

  it('classifies filing search with empty filters as metadata', () => {
    const filters: FilingSearchFilters = {};
    expect(classifySearchType('filing', filters)).toEqual('metadata');
  });

  it('classifies news search with keyword query as keyword', () => {
    const filters: NewsSearchFilters = { q: 'satellite launch' };
    expect(classifySearchType('news', filters)).toEqual('keyword');
  });

  it('classifies news search with explicit keyword mode as keyword', () => {
    const filters: NewsSearchFilters = {
      q: 'satellite launch',
      mode: 'keyword',
    };
    expect(classifySearchType('news', filters)).toEqual('keyword');
  });

  it('classifies news search with semantic mode as semantic', () => {
    const filters: NewsSearchFilters = {
      q: 'companies competing for LEO spectrum',
      mode: 'semantic',
    };
    expect(classifySearchType('news', filters)).toEqual('semantic');
  });

  it('classifies news search with hybrid mode as semantic', () => {
    const filters: NewsSearchFilters = {
      q: 'orbital debris',
      mode: 'hybrid',
    };
    expect(classifySearchType('news', filters)).toEqual('semantic');
  });

  it('classifies news search with empty query as metadata', () => {
    const filters: NewsSearchFilters = { q: '' };
    expect(classifySearchType('news', filters)).toEqual('metadata');
  });

  it('classifies news search with whitespace-only query as metadata', () => {
    const filters: NewsSearchFilters = { q: '   ' };
    expect(classifySearchType('news', filters)).toEqual('metadata');
  });
});
