import Mustache from 'mustache';

// ---------------------------------------------------------------------------
// Template rendering
// ---------------------------------------------------------------------------

/** Render a Mustache template with the given variables. */
export function renderPrompt(
  template: string,
  vars: Record<string, string>,
): string {
  return Mustache.render(template, vars);
}

// ---------------------------------------------------------------------------
// Variable catalog — shared between server (rendering) and frontend (help UI)
// ---------------------------------------------------------------------------

export type TemplateVariable = {
  /** The variable name used in templates, e.g. "fileNumber" */
  readonly name: string;
  /** Where the value comes from */
  readonly source: string;
  /** Human-readable description */
  readonly description: string;
  /** Representative example value */
  readonly example: string;
};

export const SUMMARIZATION_VARIABLES: readonly TemplateVariable[] = [
  {
    name: 'fileNumber',
    source: 'Filing',
    description: 'FCC file number',
    example: 'SAT-LOA-20060412-00042',
  },
  {
    name: 'applicantName',
    source: 'Filing',
    description: 'Name of the filing signer / applicant',
    example: 'SpaceX Services, Inc.',
  },
  {
    name: 'dateFiled',
    source: 'Filing',
    description: 'Date the application was filed',
    example: '2024-03-15',
  },
  {
    name: 'appTypeCode',
    source: 'Filing',
    description: 'Application type code (LOA, MOD, STA, etc.)',
    example: 'LOA',
  },
  {
    name: 'subsystemCode',
    source: 'Filing',
    description: 'IBFS subsystem code (SAT, SES, ITC, etc.)',
    example: 'SAT',
  },
  {
    name: 'attachmentName',
    source: 'Attachment',
    description: 'Name/title of the attachment document',
    example: 'Technical Narrative Exhibit',
  },
  {
    name: 'fullText',
    source: 'Attachment',
    description: 'Full extracted text of the attachment',
    example: '(document text)',
  },
  {
    name: 'companyName',
    source: 'Company',
    description: 'Canonical company name (if attributed)',
    example: 'Hughes Network Systems',
  },
];

// ---------------------------------------------------------------------------
// Default prompt templates
// ---------------------------------------------------------------------------

export const DEFAULT_SUMMARIZATION_SYSTEM_PROMPT: string = `You are a legal analyst specializing in US telecommunications regulation.
You produce concise, neutral summaries of FCC filings for use in research databases.
Your tone is formal and precise. You focus on what the filing requests or proposes,
the parties involved, and the technical or regulatory specifics.

Context: The FCC International Bureau Filing System (IBFS) — now replaced by ICFS —
processes applications for satellite, earth station, submarine cable, and international
telecommunications authorizations. Filings include license applications, modifications,
transfers of control, and special temporary authorities.`;

export const DEFAULT_SUMMARIZATION_USER_PROMPT: string = `Summarize the following FCC filing attachment in one to two paragraphs.
Focus on: what is being requested or proposed, by whom, and any notable
technical parameters or regulatory conditions. Do not speculate on the
outcome or current status of the filing.

Filing: {{fileNumber}}
Filed by: {{applicantName}}
Date filed: {{dateFiled}}
Application type: {{appTypeCode}}
Subsystem: {{subsystemCode}}

--- Begin extracted text ---
{{fullText}}
--- End extracted text ---`;
