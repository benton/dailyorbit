export type FilingStatusCategory =
  | 'closed'
  | 'active'
  | 'accepted'
  | 'action_taken'
  | 'pending'
  | 'review'
  | 'denied'
  | 'transferred'
  | 'blocked'
  | 'hearing'
  | 'other';

export type FilingStatusInfo = {
  category: FilingStatusCategory;
  label: string;
  bg: string;
  text: string;
  terminal: boolean;
};

type StatusStyle = Omit<FilingStatusInfo, 'label'>;

/** Map of exact status codes/text → category. Transfers are matched by prefix below. */
const EXACT_STATUS_MAP: Record<string, StatusStyle> = {
  // ICFS free-text statuses
  Closed: {
    category: 'closed',
    bg: 'bg-neutral-200 dark:bg-neutral-700',
    text: 'text-neutral-700 dark:text-neutral-300',
    terminal: true,
  },
  Current: {
    category: 'active',
    bg: 'bg-green-100 dark:bg-green-900',
    text: 'text-green-800 dark:text-green-200',
    terminal: false,
  },
  'Pending Review': {
    category: 'pending',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  'Pending Payment': {
    category: 'pending',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  'Pending Consummation': {
    category: 'pending',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  // IBFS lookup-table codes
  'A/C': {
    category: 'action_taken',
    bg: 'bg-blue-100 dark:bg-blue-900',
    text: 'text-blue-800 dark:text-blue-200',
    terminal: true,
  },
  ATPN: {
    category: 'action_taken',
    bg: 'bg-blue-100 dark:bg-blue-900',
    text: 'text-blue-800 dark:text-blue-200',
    terminal: false,
  },
  AFPN: {
    category: 'accepted',
    bg: 'bg-sky-100 dark:bg-sky-900',
    text: 'text-sky-800 dark:text-sky-200',
    terminal: false,
  },
  AFSL: {
    category: 'accepted',
    bg: 'bg-sky-100 dark:bg-sky-900',
    text: 'text-sky-800 dark:text-sky-200',
    terminal: false,
  },
  AFP: {
    category: 'accepted',
    bg: 'bg-sky-100 dark:bg-sky-900',
    text: 'text-sky-800 dark:text-sky-200',
    terminal: false,
  },
  INP: {
    category: 'other',
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    text: 'text-neutral-600 dark:text-neutral-400',
    terminal: false,
  },
  BLOK: {
    category: 'blocked',
    bg: 'bg-red-100 dark:bg-red-900',
    text: 'text-red-800 dark:text-red-200',
    terminal: false,
  },
  UNBLK: {
    category: 'active',
    bg: 'bg-green-100 dark:bg-green-900',
    text: 'text-green-800 dark:text-green-200',
    terminal: false,
  },
  DREC: {
    category: 'denied',
    bg: 'bg-red-100 dark:bg-red-900',
    text: 'text-red-800 dark:text-red-200',
    terminal: true,
  },
  DSTAY: {
    category: 'denied',
    bg: 'bg-red-100 dark:bg-red-900',
    text: 'text-red-800 dark:text-red-200',
    terminal: true,
  },
  GREC: {
    category: 'action_taken',
    bg: 'bg-green-100 dark:bg-green-900',
    text: 'text-green-800 dark:text-green-200',
    terminal: false,
  },
  GSTAY: {
    category: 'action_taken',
    bg: 'bg-green-100 dark:bg-green-900',
    text: 'text-green-800 dark:text-green-200',
    terminal: false,
  },
  HEAR: {
    category: 'hearing',
    bg: 'bg-purple-100 dark:bg-purple-900',
    text: 'text-purple-800 dark:text-purple-200',
    terminal: false,
  },
  SFH: {
    category: 'hearing',
    bg: 'bg-purple-100 dark:bg-purple-900',
    text: 'text-purple-800 dark:text-purple-200',
    terminal: false,
  },
  RFH: {
    category: 'hearing',
    bg: 'bg-purple-100 dark:bg-purple-900',
    text: 'text-purple-800 dark:text-purple-200',
    terminal: false,
  },
  SUSP: {
    category: 'blocked',
    bg: 'bg-red-100 dark:bg-red-900',
    text: 'text-red-800 dark:text-red-200',
    terminal: false,
  },
  RECON: {
    category: 'review',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  AREV: {
    category: 'review',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  TREV: {
    category: 'review',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  TRC: {
    category: 'review',
    bg: 'bg-blue-100 dark:bg-blue-900',
    text: 'text-blue-800 dark:text-blue-200',
    terminal: false,
  },
  LRC: {
    category: 'review',
    bg: 'bg-blue-100 dark:bg-blue-900',
    text: 'text-blue-800 dark:text-blue-200',
    terminal: false,
  },
  LREV: {
    category: 'review',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  INFO: {
    category: 'review',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  COR: {
    category: 'other',
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    text: 'text-neutral-600 dark:text-neutral-400',
    terminal: false,
  },
  DFT: {
    category: 'other',
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    text: 'text-neutral-600 dark:text-neutral-400',
    terminal: false,
  },
  COOR: {
    category: 'review',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
  STAY: {
    category: 'blocked',
    bg: 'bg-red-100 dark:bg-red-900',
    text: 'text-red-800 dark:text-red-200',
    terminal: false,
  },
  RMD: {
    category: 'review',
    bg: 'bg-amber-100 dark:bg-amber-900',
    text: 'text-amber-800 dark:text-amber-200',
    terminal: false,
  },
};

const TRANSFERRED_STYLE: StatusStyle = {
  category: 'transferred',
  bg: 'bg-violet-100 dark:bg-violet-900',
  text: 'text-violet-800 dark:text-violet-200',
  terminal: false,
};

const FALLBACK_STYLE: StatusStyle = {
  category: 'other',
  bg: 'bg-neutral-100 dark:bg-neutral-800',
  text: 'text-neutral-600 dark:text-neutral-400',
  terminal: false,
};

/**
 * Resolve status info from a status code and/or status text.
 * Uses statusCode for lookup-table matches; falls back to statusText for ICFS free-text statuses.
 */
export function getFilingStatus(
  statusCode: string | null,
  statusText: string | null,
): FilingStatusInfo | null {
  if (statusCode == null && statusText == null) return null;

  // Try exact match on statusCode first
  if (statusCode != null) {
    const exact: StatusStyle | undefined = EXACT_STATUS_MAP[statusCode];
    if (exact != null) {
      return { ...exact, label: statusText ?? statusCode };
    }
    // Transfer codes: F* (from) and T* (to) prefixes, plus TRN
    if (/^F[A-Z]/.test(statusCode) || /^T[A-Z]/.test(statusCode) || statusCode === 'TRN') {
      return { ...TRANSFERRED_STYLE, label: statusText ?? 'Transferred' };
    }
  }

  // Try exact match on statusText (ICFS free-text)
  if (statusText != null) {
    const exact: StatusStyle | undefined = EXACT_STATUS_MAP[statusText];
    if (exact != null) {
      return { ...exact, label: statusText };
    }
    // "Pending *" catch-all
    if (statusText.startsWith('Pending')) {
      return { ...EXACT_STATUS_MAP['Pending Review']!, label: statusText };
    }
  }

  // Fallback: show whatever we have
  return { ...FALLBACK_STYLE, label: statusText ?? statusCode ?? '' };
}
