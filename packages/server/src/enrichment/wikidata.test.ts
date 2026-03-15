import { describe, expect, it } from 'vitest';
import { parseWikidataBinding } from './wikidata.ts';

describe('Wikidata response parsing', () => {
  it('parses a complete SPARQL binding into WikidataEntity', () => {
    const binding: Record<string, unknown> = {
      item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q184395' },
      itemLabel: { type: 'literal', value: 'SpaceX' },
      itemDescription: { type: 'literal', value: 'American aerospace company' },
      parentOrg: {
        type: 'uri',
        value: 'http://www.wikidata.org/entity/Q123456',
      },
      parentOrgLabel: { type: 'literal', value: 'Elon Musk Holdings' },
      stockExchangeLabel: { type: 'literal', value: 'NASDAQ' },
      ticker: { type: 'literal', value: 'SPACEX' },
      industryLabel: { type: 'literal', value: 'Aerospace' },
    };

    const entity = parseWikidataBinding(binding, 'SpaceX');
    expect(entity).toEqual({
      wikidataId: 'Q184395',
      label: 'SpaceX',
      description: 'American aerospace company',
      parentOrgId: 'Q123456',
      parentOrgLabel: 'Elon Musk Holdings',
      stockExchange: 'NASDAQ',
      stockTicker: 'SPACEX',
      industry: 'Aerospace',
    });
  });

  it('handles missing optional fields with nulls', () => {
    const binding: Record<string, unknown> = {
      item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q999999' },
      itemLabel: { type: 'literal', value: 'Test Corp' },
    };

    const entity = parseWikidataBinding(binding, 'Test Corp');
    expect(entity.wikidataId).toEqual('Q999999');
    expect(entity.label).toEqual('Test Corp');
    expect(entity.description).toBeNull();
    expect(entity.parentOrgId).toBeNull();
    expect(entity.stockExchange).toBeNull();
    expect(entity.stockTicker).toBeNull();
    expect(entity.industry).toBeNull();
  });

  it('uses fallback name when label is missing', () => {
    const binding: Record<string, unknown> = {
      item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q111' },
    };

    const entity = parseWikidataBinding(binding, 'Fallback Name');
    expect(entity.label).toEqual('Fallback Name');
  });
});
