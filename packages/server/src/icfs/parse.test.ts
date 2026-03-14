import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFilingDetail, parseSearchResponse } from './parse.ts';
import type {
  IcfsAttachment,
  IcfsFilingDetail,
  IcfsPleading,
  IcfsSearchResult,
} from './types.ts';

const FIXTURES_DIR: string = resolve(import.meta.dirname, 'fixtures');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(FIXTURES_DIR, name), 'utf8'));
}

describe('parseSearchResponse', () => {
  it('extracts file numbers and applicant names from search results', () => {
    const json: unknown = loadFixture('search-sat-loa-2025.json');
    const results: IcfsSearchResult[] = parseSearchResponse(json);

    expect(results.length).toEqual(2);
    expect(results[0]).toEqual({
      sysId:
        'DRAFT-SAT-LOA-20250915-00277' === results[0]!.fileNumber
          ? results[0]!.sysId
          : results[0]!.sysId,
      fileNumber: expect.stringContaining('SAT-LOA-2025') as string,
      applicantName: expect.any(String) as string,
      subsystem: 'SAT',
    });
  });

  it('returns empty array for zero results', () => {
    const json: unknown = { result: { results: [] } };
    const results: IcfsSearchResult[] = parseSearchResponse(json);
    expect(results).toEqual([]);
  });

  it('returns empty array for missing results key', () => {
    const json: unknown = { result: {} };
    const results: IcfsSearchResult[] = parseSearchResponse(json);
    expect(results).toEqual([]);
  });
});

describe('parseFilingDetail', () => {
  it('extracts summary fields from a real response', () => {
    const json: unknown = loadFixture(
      'filing-detail-sat-loa-20250221-00050.json',
    );
    const detail: IcfsFilingDetail = parseFilingDetail(json);

    expect(detail.found).toEqual(true);
    expect(detail.summary).not.toBeNull();
    expect(detail.summary!.fileNumber).toEqual('SAT-LOA-20250221-00050');
    expect(detail.summary!.applicantName).toEqual('ICEYE US, Inc.');
    expect(detail.summary!.applicantFrn).toEqual('0030543268');
    expect(detail.summary!.callSign).toEqual('S3224');
    expect(detail.summary!.status).toEqual('Current');
    expect(detail.summary!.grantDate).toEqual('2025-04-14');
    expect(detail.summary!.daNumber).toEqual('25-346');
    expect(detail.summary!.redLightStatus).toEqual('No');
    expect(detail.summary!.applicantCity).toEqual('Irvine');
    expect(detail.summary!.applicantState).toEqual('CA');
    expect(detail.summary!.contactName).toEqual('George V. John');
    expect(detail.summary!.sysId).toEqual('0e294fa41bdea6104c2b877ae54bcb6f');
  });

  it('returns found: false for a missing filing', () => {
    const json: unknown = loadFixture('filing-detail-not-found.json');
    const detail: IcfsFilingDetail = parseFilingDetail(json);

    expect(detail.found).toEqual(false);
    expect(detail.summary).toBeNull();
    expect(detail.transferParties).toBeNull();
    expect(detail.serviceTypes).toEqual([]);
    expect(detail.attachments).toEqual([]);
    expect(detail.pleadings).toEqual([]);
  });

  it('extracts transfer parties from tc_asg_summary', () => {
    const json: unknown = loadFixture(
      'filing-detail-sat-tc-20250917-00287.json',
    );
    const detail: IcfsFilingDetail = parseFilingDetail(json);

    expect(detail.found).toEqual(true);
    expect(detail.transferParties).not.toBeNull();
    expect(detail.transferParties!.transfereeName).toEqual(
      'Eutelsat do Brasil Ltda',
    );
    expect(detail.transferParties!.transferorName).toEqual(
      'Eutelsat do Brasil Ltda',
    );
    expect(detail.transferParties!.transferorCity).toEqual('Rio de Janeiro');
    expect(detail.transferParties!.transfereeCity).toEqual('Rio de Janeiro');
  });

  it('returns null transfer parties when tc_asg_summary is empty', () => {
    const json: unknown = loadFixture(
      'filing-detail-sat-loa-20250221-00050.json',
    );
    const detail: IcfsFilingDetail = parseFilingDetail(json);
    expect(detail.transferParties).toBeNull();
  });

  it('extracts service types from itc214ServiceTypes', () => {
    const json: unknown = loadFixture(
      'filing-detail-sat-loa-20250221-00050.json',
    );
    const detail: IcfsFilingDetail = parseFilingDetail(json);

    expect(detail.serviceTypes.length).toEqual(8);
    expect(detail.serviceTypes[0]).toEqual({
      fieldName: 'service_type_gfba',
      label: 'Global Facilities-Based Authority',
      value: '',
    });
  });

  it('extracts attachment metadata from Filing Documents tab', () => {
    const json: unknown = loadFixture(
      'filing-detail-sat-loa-20250221-00050.json',
    );
    const detail: IcfsFilingDetail = parseFilingDetail(json);

    expect(detail.attachments.length).toEqual(2);
    const first: IcfsAttachment = detail.attachments[0]!;
    expect(first.documentName).toEqual('Schedule S Link');
    expect(first.sysId).toEqual('0e294fa41bdea6104c2b877ae54bcb6f');
    expect(first.attachmentType).toEqual('html_and_pdf');
    expect(first.links.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts pleading metadata from Pleadings & Comments tab', () => {
    const json: unknown = loadFixture(
      'filing-detail-sat-loa-20250221-00050.json',
    );
    const detail: IcfsFilingDetail = parseFilingDetail(json);

    expect(detail.pleadings.length).toEqual(2);
    const first: IcfsPleading = detail.pleadings[0]!;
    expect(first.number).toEqual('PC0106846');
    expect(first.sysId).toEqual('14f75dbe97393e108031b22de053afb5');
    expect(first.pleadingType).toEqual('LETTER');
    expect(first.filerName).toEqual('Nate Woodford');
    expect(first.createdOn).toEqual('2025-12-17 07:23:47');
    expect(first.exhibitAttachmentHtml).toContain('sys_attachment.do');
  });
});
