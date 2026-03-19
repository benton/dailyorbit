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
  bg: string;
  category: FilingStatusCategory;
  label: string;
  terminal: boolean;
  text: string;
};

type StatusStyle = Omit<FilingStatusInfo, 'label'>;

/** Map of exact status codes/text → category. Transfers are matched by prefix below. */
const EXACT_STATUS_MAP: Record<string, StatusStyle> = {
  // ICFS free-text statuses
  Closed: {
    bg: 'bg-neutral-200 dark:bg-neutral-700',
    category: 'closed',
    terminal: true,
    text: 'text-neutral-700 dark:text-neutral-300',
  },
  Current: {
    bg: 'bg-green-100 dark:bg-green-900',
    category: 'active',
    terminal: false,
    text: 'text-green-800 dark:text-green-200',
  },
  'Pending Consummation': {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'pending',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  'Pending Payment': {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'pending',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  'Pending Review': {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'pending',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  // IBFS lookup-table codes
  'A/C': {
    bg: 'bg-blue-100 dark:bg-blue-900',
    category: 'action_taken',
    terminal: true,
    text: 'text-blue-800 dark:text-blue-200',
  },
  AFP: {
    bg: 'bg-sky-100 dark:bg-sky-900',
    category: 'accepted',
    terminal: false,
    text: 'text-sky-800 dark:text-sky-200',
  },
  AFPN: {
    bg: 'bg-sky-100 dark:bg-sky-900',
    category: 'accepted',
    terminal: false,
    text: 'text-sky-800 dark:text-sky-200',
  },
  AFSL: {
    bg: 'bg-sky-100 dark:bg-sky-900',
    category: 'accepted',
    terminal: false,
    text: 'text-sky-800 dark:text-sky-200',
  },
  AREV: {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'review',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  ATPN: {
    bg: 'bg-blue-100 dark:bg-blue-900',
    category: 'action_taken',
    terminal: false,
    text: 'text-blue-800 dark:text-blue-200',
  },
  BLOK: {
    bg: 'bg-red-100 dark:bg-red-900',
    category: 'blocked',
    terminal: false,
    text: 'text-red-800 dark:text-red-200',
  },
  COOR: {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'review',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  COR: {
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    category: 'other',
    terminal: false,
    text: 'text-neutral-600 dark:text-neutral-400',
  },
  DFT: {
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    category: 'other',
    terminal: false,
    text: 'text-neutral-600 dark:text-neutral-400',
  },
  DREC: {
    bg: 'bg-red-100 dark:bg-red-900',
    category: 'denied',
    terminal: true,
    text: 'text-red-800 dark:text-red-200',
  },
  DSTAY: {
    bg: 'bg-red-100 dark:bg-red-900',
    category: 'denied',
    terminal: true,
    text: 'text-red-800 dark:text-red-200',
  },
  GREC: {
    bg: 'bg-green-100 dark:bg-green-900',
    category: 'action_taken',
    terminal: false,
    text: 'text-green-800 dark:text-green-200',
  },
  GSTAY: {
    bg: 'bg-green-100 dark:bg-green-900',
    category: 'action_taken',
    terminal: false,
    text: 'text-green-800 dark:text-green-200',
  },
  HEAR: {
    bg: 'bg-purple-100 dark:bg-purple-900',
    category: 'hearing',
    terminal: false,
    text: 'text-purple-800 dark:text-purple-200',
  },
  INFO: {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'review',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  INP: {
    bg: 'bg-neutral-100 dark:bg-neutral-800',
    category: 'other',
    terminal: false,
    text: 'text-neutral-600 dark:text-neutral-400',
  },
  LRC: {
    bg: 'bg-blue-100 dark:bg-blue-900',
    category: 'review',
    terminal: false,
    text: 'text-blue-800 dark:text-blue-200',
  },
  LREV: {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'review',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  RECON: {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'review',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  RFH: {
    bg: 'bg-purple-100 dark:bg-purple-900',
    category: 'hearing',
    terminal: false,
    text: 'text-purple-800 dark:text-purple-200',
  },
  RMD: {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'review',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  SFH: {
    bg: 'bg-purple-100 dark:bg-purple-900',
    category: 'hearing',
    terminal: false,
    text: 'text-purple-800 dark:text-purple-200',
  },
  STAY: {
    bg: 'bg-red-100 dark:bg-red-900',
    category: 'blocked',
    terminal: false,
    text: 'text-red-800 dark:text-red-200',
  },
  SUSP: {
    bg: 'bg-red-100 dark:bg-red-900',
    category: 'blocked',
    terminal: false,
    text: 'text-red-800 dark:text-red-200',
  },
  TRC: {
    bg: 'bg-blue-100 dark:bg-blue-900',
    category: 'review',
    terminal: false,
    text: 'text-blue-800 dark:text-blue-200',
  },
  TREV: {
    bg: 'bg-amber-100 dark:bg-amber-900',
    category: 'review',
    terminal: false,
    text: 'text-amber-800 dark:text-amber-200',
  },
  UNBLK: {
    bg: 'bg-green-100 dark:bg-green-900',
    category: 'active',
    terminal: false,
    text: 'text-green-800 dark:text-green-200',
  },
};

const TRANSFERRED_STYLE: StatusStyle = {
  bg: 'bg-violet-100 dark:bg-violet-900',
  category: 'transferred',
  terminal: false,
  text: 'text-violet-800 dark:text-violet-200',
};

const FALLBACK_STYLE: StatusStyle = {
  bg: 'bg-neutral-100 dark:bg-neutral-800',
  category: 'other',
  terminal: false,
  text: 'text-neutral-600 dark:text-neutral-400',
};

/**
 * Resolve status info from a status code and/or status text.
 * Uses statusCode for lookup-table matches; falls back to statusText for ICFS free-text statuses.
 */
export function getFilingStatus(
  statusCode: string | null,
  statusText: string | null,
): FilingStatusInfo | null {
  if (statusCode == null && statusText == null) {
    return null;
  }

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
