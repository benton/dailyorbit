import { describe, expect, it } from 'vitest';
import { parseGleifEntity } from './gleif.ts';

describe('GLEIF response parsing', () => {
  it('parses a complete GLEIF entity from API data', () => {
    const apiData: Record<string, unknown> = {
      id: '5493006MHB84DD0ZWV18',
      attributes: {
        entity: {
          legalName: { name: 'SES S.A.', language: 'en' },
          legalJurisdiction: { id: 'LU' },
          category: 'FUND',
          status: 'ACTIVE',
        },
      },
    };

    const entity = parseGleifEntity(apiData);
    expect(entity).toEqual({
      lei: '5493006MHB84DD0ZWV18',
      legalName: 'SES S.A.',
      legalJurisdiction: 'LU',
      category: 'FUND',
      status: 'ACTIVE',
    });
  });

  it('handles missing optional fields gracefully', () => {
    const apiData: Record<string, unknown> = {
      id: 'ABC123',
      attributes: {
        entity: {
          legalName: { name: 'Test Corp' },
          legalJurisdiction: null,
          category: null,
          status: 'ACTIVE',
        },
      },
    };

    const entity = parseGleifEntity(apiData);
    expect(entity.lei).toEqual('ABC123');
    expect(entity.legalName).toEqual('Test Corp');
    expect(entity.legalJurisdiction).toBeNull();
    expect(entity.category).toBeNull();
  });
});
