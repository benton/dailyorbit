import { htmlToMarkdown } from '../lib/html-to-markdown.ts';
import type {
  IcfsAttachment,
  IcfsAttachmentLink,
  IcfsFilingDetail,
  IcfsFilingSummary,
  IcfsPleading,
  IcfsSearchResult,
  IcfsServiceType,
  IcfsTransferParties,
} from './types.ts';

/** Extract a display_value from a summary-style field object, defaulting to '' */
function dv(field: unknown): string {
  if (field != null && typeof field === 'object' && 'display_value' in field) {
    return String((field as { display_value: unknown }).display_value);
  }
  return '';
}

/** Safely access nested object properties */
function get(obj: unknown, ...keys: (string | number)[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

function parseResultItem(r: unknown): IcfsSearchResult {
  const fields: unknown[] = Array.isArray(get(r, 'fields'))
    ? (get(r, 'fields') as unknown[])
    : [];

  let applicantName: string = '';
  let subsystem: string = '';

  for (const f of fields) {
    const label: string = String(get(f, 'label') ?? '');
    const value: string = String(get(f, 'display_value') ?? '');
    if (label === 'Applicant Name') applicantName = value;
    if (label === 'Subsystem') subsystem = value;
  }

  return {
    sysId: String(get(r, 'sys_id') ?? ''),
    fileNumber: String(get(r, 'label') ?? ''),
    applicantName,
    subsystem,
  };
}

export function parseSearchResponse(json: unknown): IcfsSearchResult[] {
  const results: unknown = get(json, 'result', 'results');
  const additionalResults: unknown = get(json, 'result', 'additionalResults');

  const items: IcfsSearchResult[] = [];

  if (Array.isArray(results)) {
    for (const r of results) {
      items.push(parseResultItem(r));
    }
  }
  if (Array.isArray(additionalResults)) {
    for (const r of additionalResults) {
      items.push(parseResultItem(r));
    }
  }

  return items;
}

/** Navigate to the widget data within the SP page response */
function getWidgetData(json: unknown): unknown {
  return get(
    json,
    'result',
    'containers',
    2,
    'rows',
    0,
    'columns',
    0,
    'widgets',
    0,
    'widget',
    'data',
  );
}

export function parseFilingDetail(json: unknown): IcfsFilingDetail {
  const data: unknown = getWidgetData(json);
  const NOT_FOUND: IcfsFilingDetail = {
    found: false,
    summary: null,
    transferParties: null,
    serviceTypes: [],
    attachments: [],
    pleadings: [],
  };

  if (!get(data, 'found')) return NOT_FOUND;

  const summary: IcfsFilingSummary = parseSummary(data);
  const transferParties: IcfsTransferParties | null =
    parseTransferParties(data);
  const serviceTypes: IcfsServiceType[] = parseServiceTypes(data);
  const attachments: IcfsAttachment[] = parseAttachments(data);
  const pleadings: IcfsPleading[] = parsePleadings(data);

  return {
    found: true,
    summary,
    transferParties,
    serviceTypes,
    attachments,
    pleadings,
  };
}

function parseSummary(data: unknown): IcfsFilingSummary {
  const s: unknown = get(data, 'summary');
  return {
    fileNumber: dv(get(s, 'number')),
    sysId: String(get(data, 'record_id') ?? ''),
    callSign: dv(get(s, 'call_sign')),
    applicantName: dv(get(s, 'applicant_name')),
    applicantFrn: dv(get(s, 'applicant_frn')),
    applicantStreet: dv(get(s, 'applicant_street')),
    applicantCity: dv(get(s, 'applicant_city')),
    applicantState: dv(get(s, 'applicant_state')),
    applicantZipCode: dv(get(s, 'applicant_zip_code')),
    applicantCountry: dv(get(s, 'applicant_country')),
    contactName: dv(get(s, 'contact_name')),
    contactStreet: dv(get(s, 'contact_street')),
    contactCity: dv(get(s, 'contact_city')),
    contactState: dv(get(s, 'contact_state')),
    contactZipCode: dv(get(s, 'contact_zip_code')),
    contactCountry: dv(get(s, 'contact_country')),
    briefDescription: dv(get(s, 'brief_application_description')),
    natureOfService: dv(get(s, 'nature_of_service')),
    status: dv(get(s, 'state')),
    statusDate: dv(get(s, 'status_date')),
    submissionDate: dv(get(s, 'submission_date')),
    grantDate: dv(get(s, 'grant_date')),
    beginDate: dv(get(s, 'begin_date')),
    expirationDate: dv(get(s, 'expiration_date')),
    lastAction: dv(get(s, 'last_action')),
    lastActionDate: dv(get(s, 'action_taken_date')),
    afpnDate: dv(get(s, 'afpn_date')),
    actionPnDate: dv(get(s, 'action_pn_date')),
    daNumber: dv(get(s, 'da_number')),
    redLightStatus: dv(get(s, 'red_light_status')),
    streamlined: dv(get(s, 'streamlined')),
    environmentalImpact: dv(get(s, 'environmental_impact')),
    legacyFilingKey: dv(get(s, 'legacy_filing_key')),
    releaseDate: dv(get(s, 'release_date')),
    adoptedDate: dv(get(s, 'adopted_date')),
    acceptedPnDaNumber: dv(get(s, 'accepted_pn_da_number')),
    actionPnDaNumber: dv(get(s, 'action_pn_da_number')),
  };
}

function parseTransferParties(data: unknown): IcfsTransferParties | null {
  const tc: unknown = get(data, 'tc_asg_summary');
  if (
    tc == null ||
    typeof tc !== 'object' ||
    Object.keys(tc as object).length === 0
  ) {
    return null;
  }

  return {
    transferorName: dv(get(tc, 'transferor_name')),
    transferorStreet: dv(get(tc, 'transferor_street')),
    transferorCity: dv(get(tc, 'transferor_city')),
    transferorZipCode: dv(get(tc, 'transferor_zip_code')),
    transfereeName: dv(get(tc, 'transferee_name')),
    transfereeStreet: dv(get(tc, 'transferee_street')),
    transfereeCity: dv(get(tc, 'transferee_city')),
    transfereeZipCode: dv(get(tc, 'transferee_zip_code')),
  };
}

function parseServiceTypes(data: unknown): IcfsServiceType[] {
  const types: unknown = get(data, 'itc214ServiceTypes');
  if (!Array.isArray(types)) return [];

  return types.map(
    (t: unknown): IcfsServiceType => ({
      fieldName: String(get(t, 'field_name') ?? ''),
      label: String(get(t, 'label') ?? ''),
      value: String(get(t, 'value') ?? ''),
    }),
  );
}

function parseAttachments(data: unknown): IcfsAttachment[] {
  const items: unknown = get(
    data,
    'tabs',
    'data',
    'widgets',
    0,
    'widgets',
    0,
    'data',
    'all_data',
  );
  if (!Array.isArray(items)) return [];

  return items.map((item: unknown): IcfsAttachment => {
    const rawLinks: unknown = get(item, 'actions', 'links');
    const links: IcfsAttachmentLink[] = Array.isArray(rawLinks)
      ? rawLinks.map(
          (l: unknown): IcfsAttachmentLink => ({
            displayValue: String(get(l, 'display_value') ?? ''),
            url: String(get(l, 'url') ?? ''),
          }),
        )
      : [];

    return {
      sysId: String(get(item, 'sys_id') ?? ''),
      documentName: dv(get(item, 'document_name')),
      attachmentType: String(get(item, 'actions', 'value') ?? ''),
      links,
    };
  });
}

function parsePleadings(data: unknown): IcfsPleading[] {
  const items: unknown = get(
    data,
    'tabs',
    'data',
    'widgets',
    1,
    'widgets',
    0,
    'data',
    'all_data',
  );
  if (!Array.isArray(items)) return [];

  return items.map(
    (item: unknown): IcfsPleading => ({
      number: dv(get(item, 'number')),
      sysId: String(get(item, 'sys_id') ?? ''),
      pleadingType: dv(get(item, 'pleading_type')),
      filerName: dv(get(item, 'filer_name')),
      createdOn: dv(get(item, 'sys_created_on')),
      exhibitAttachmentHtml: htmlToMarkdown(dv(get(item, 'extra_exhibit_attachment_list'))),
    }),
  );
}
