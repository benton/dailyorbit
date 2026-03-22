import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../lib/api.ts';
import { getFilingStatus } from '../lib/filing-status.ts';
import { getSubsystem } from '../lib/subsystems.ts';
import { markRead } from '../lib/viewing-history.ts';
import { Badge } from '../ui/badge.tsx';
import { FlagToggle } from '../ui/FlagToggle.tsx';
import { SummaryTooltip } from '../ui/SummaryTooltip.tsx';
import { FilingTimeline } from './FilingTimeline.tsx';

// ── Types mirroring server-side FilingDetail ────────────────────────

type FilingAttachment = {
  attachmentKey: number;
  attachmentName: string;
  contentType: string | null;
  description: string;
  downloadStatus: string;
  downloadUrl: string;
  fileSizeBytes: number | null;
  source: string;
  summary: string | null;
};

type FilingPetition = {
  dateFiled: string | null;
  description: string | null;
  filingKey: number;
  partyName: string | null;
  pleadingNumber: string | null;
  pleadingType: string | null;
};

type RelatedSpaceStation = {
  ituName: string | null;
  orbitLocation: string | null;
  spaceStationKey: number;
  usName: string;
};

type TimelineEvent = {
  actor: string | null;
  date: string;
  label: string;
  source: 'filing_field' | 'pleading';
  type: string;
};

type DataSource = 'icfs' | 'ibfs-legacy';

type FilingDetail = {
  applicantFrn: string | null;
  applicantName: string | null;
  appTypeCode: string;
  appTypeLabel: string | null;
  attachments: Array<FilingAttachment>;
  briefDescription: string | null;
  callsign: string | null;
  companyId: number | null;
  companyName: string | null;
  daNumber: string | null;
  dataSource: DataSource;
  dateBegin: string | null;
  dateExpire: string | null;
  dateFiled: string | null;
  dateGrant: string | null;
  dateSigned: string | null;
  description: string | null;
  environmentalImpact: string | null;
  fileNumber: string;
  filingKey: number;
  lastAction: string | null;
  lastActionDate: string | null;
  natureOfService: string | null;
  petitions: Array<FilingPetition>;
  redLightStatus: string | null;
  relatedEarthStationCallsign: string | null;
  relatedSpaceStation: RelatedSpaceStation | null;
  statusCode: string | null;
  statusText: string | null;
  streamlined: string | null;
  subsystemCode: string;
  subsystemLabel: string | null;
  summary: string | null;
  timeline: Array<TimelineEvent>;
  transfereeName: string | null;
  transferorName: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (iso == null) {
    return '';
  }
  return new Date(iso).toLocaleDateString();
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Sidebar detail row — renders nothing when value is null/empty. */
function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (value == null || value.trim() === '') {
    return null;
  }
  return (
    <div>
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="font-medium text-neutral-900 dark:text-neutral-100">{value}</dd>
    </div>
  );
}

const PLEADING_TYPE_STYLES: Record<string, string> = {
  COMMENT: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300',
  DECISION: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  LETTER: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  PETITION: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
  SUPPLEMENT: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
};

function PleadingTypeBadge({ type }: { type: string | null }) {
  if (type == null || type === '') {
    return null;
  }
  const style: string =
    PLEADING_TYPE_STYLES[type] ??
    'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {type}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────────────

export default function FilingDetailPage() {
  const params = useParams();
  const fileNumber: string | undefined = params['*'];

  const [filing, setFiling] = useState<FilingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    let cancelled: boolean = false;
    // eslint-disable-next-line react-hooks-js/set-state-in-effect
    setLoading(true);
    setError(null);
    setNotFound(false);

    apiFetch<FilingDetail>(`/api/filings/${encodeURIComponent(fileNumber ?? '')}`)
      .then((data: FilingDetail) => {
        if (cancelled) {
          return;
        }
        setFiling(data);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setNotFound(true);
        } else {
          const message: string = error instanceof Error ? error.message : 'Failed to load filing';
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileNumber]);

  // Auto-mark as read after 10 seconds on the page
  useEffect(() => {
    if (filing == null) {
      return;
    }
    const timer = setTimeout(() => {
      void markRead(filing.fileNumber);
    }, 10_000);
    return () => clearTimeout(timer);
  }, [filing]);

  // Check if this filing is flagged
  const [isFlagged, setIsFlagged] = useState<boolean>(false);
  useEffect(() => {
    if (filing == null) {
      return;
    }
    apiFetch<{ flagged: Array<string> }>('/api/user/flags/bulk-check', {
      body: JSON.stringify({ content_keys: [filing.fileNumber], content_type: 'filing' }),
      method: 'POST',
    })
      .then((result) => setIsFlagged(result.flagged.includes(filing.fileNumber)))
      .catch(() => {});
  }, [filing]);

  // ── Attachment sort (hooks must be before early returns) ────────

  const [attSort, setAttSort] = useState<{
    col: 'attachmentName' | 'description' | 'fileSizeBytes';
    dir: 'asc' | 'desc';
  }>({ col: 'attachmentName', dir: 'asc' });

  const sortedAttachments = useMemo(() => {
    if (filing == null) {
      return [];
    }
    const sorted: Array<FilingAttachment> = [...filing.attachments];
    sorted.sort((a: FilingAttachment, b: FilingAttachment) => {
      const aVal = a[attSort.col];
      const bVal = b[attSort.col];
      if (aVal == null && bVal == null) {
        return 0;
      }
      if (aVal == null) {
        return 1;
      }
      if (bVal == null) {
        return -1;
      }
      const cmp: number =
        typeof aVal === 'string'
          ? aVal.localeCompare(bVal as string)
          : (aVal as number) - (bVal as number);
      return attSort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filing, attSort]);

  const toggleAttSort = (col: 'attachmentName' | 'description' | 'fileSizeBytes'): void => {
    setAttSort((prev) =>
      prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    );
  };

  const sortIndicator = (col: string): string =>
    attSort.col === col ? (attSort.dir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  // ── Loading state ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-neutral-500 dark:text-neutral-400">
        Loading filing data...
      </div>
    );
  }

  // ── 404 state ───────────────────────────────────────────────────

  if (notFound) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-2">
        <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Filing not found
        </span>
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          No filing exists with file number {fileNumber}
        </span>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────

  if (error != null || filing == null) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-red-600 dark:text-red-400">
        {error ?? 'An unexpected error occurred'}
      </div>
    );
  }

  const subsystem = getSubsystem(filing.subsystemCode);
  const hasTransferInfo: boolean = filing.transferorName != null || filing.transfereeName != null;

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {filing.fileNumber}
          </h1>
          <FlagToggle
            contentKey={filing.fileNumber}
            contentType="filing"
            initialFlagged={isFlagged}
            onToggle={setIsFlagged}
          />
          <Badge className={`${subsystem.bg} ${subsystem.text} border-transparent`}>
            {subsystem.label}
          </Badge>
          {filing.appTypeLabel != null && (
            <span className="text-sm text-neutral-600 dark:text-neutral-300">
              {filing.appTypeLabel} ({filing.appTypeCode})
            </span>
          )}
          {(() => {
            const status = getFilingStatus(filing.statusCode, filing.statusText);
            if (status != null) {
              return (
                <span
                  className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${status.bg} ${status.text}`}
                >
                  {status.label}
                </span>
              );
            }
            return null;
          })()}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500 dark:text-neutral-400">
          {filing.applicantName != null && (
            <span>
              Applicant:{' '}
              <Link
                className="text-blue-600 hover:underline dark:text-blue-400"
                to={`/search?applicant=${encodeURIComponent(filing.applicantName)}`}
              >
                {filing.applicantName}
              </Link>
            </span>
          )}
          {filing.companyId != null && filing.companyName != null && (
            <span>
              Company:{' '}
              <Link
                className="text-blue-600 hover:underline dark:text-blue-400"
                to={`/companies/${filing.companyId}`}
              >
                {filing.companyName}
              </Link>
            </span>
          )}
          {filing.dateFiled != null && <span>Filed: {formatDate(filing.dateFiled)}</span>}
        </div>
      </div>

      {/* ── Legacy data banner ─────────────────────────────────── */}
      {filing.dataSource === 'ibfs-legacy' && (
        <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <svg
            className="mt-0.5 h-5 w-5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <p className="font-medium">Legacy IBFS data only</p>
            <p className="mt-1 text-amber-700 dark:text-amber-300">
              This filing was imported from the FCC&apos;s legacy IBFS bulk export and has not been
              found on the current ICFS system. Some fields may be incomplete or outdated.
            </p>
          </div>
        </div>
      )}

      {/* ── Two-column layout ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column (2/3 width) */}
        <div className="space-y-6 lg:col-span-2">
          {/* Brief description */}
          {(filing.briefDescription != null || filing.description != null) && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Description
              </h2>
              <div className="rounded-md border border-neutral-200 bg-white p-4 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
                {filing.briefDescription ?? filing.description}
              </div>
            </section>
          )}

          {/* Filing Summary */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Summary
            </h2>
            <div className="rounded-md border border-neutral-200 bg-white p-4 text-sm leading-relaxed text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              {filing.summary != null ? (
                filing.summary
              ) : (
                <span className="text-neutral-400 italic dark:text-neutral-500">
                  [content unavailable]
                </span>
              )}
            </div>
          </section>

          {/* Timeline */}
          <FilingTimeline events={filing.timeline} />

          {/* Attachments */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Attachments
              <span className="ml-2 text-sm font-normal text-neutral-500 dark:text-neutral-400">
                ({filing.attachments.length})
              </span>
            </h2>
            {(() => {
              const appPdf: FilingAttachment | undefined = filing.attachments.find(
                (a: FilingAttachment) =>
                  a.attachmentName === 'Attachment Application' && a.downloadUrl,
              );
              if (appPdf != null) {
                return (
                  <a
                    className="mb-4 inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                    href={appPdf.downloadUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Download Application Filing
                    {appPdf.fileSizeBytes != null && (
                      <span className="text-xs font-normal text-blue-500 dark:text-blue-400">
                        ({formatBytes(appPdf.fileSizeBytes)})
                      </span>
                    )}
                  </a>
                );
              }
              return null;
            })()}
            {filing.attachments.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No attachments on file.
              </p>
            ) : (
              <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700">
                      <th
                        className="cursor-pointer px-4 py-2 text-left font-medium text-neutral-500 select-none hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                        onClick={() => toggleAttSort('attachmentName')}
                      >
                        Name{sortIndicator('attachmentName')}
                      </th>
                      <th
                        className="cursor-pointer px-4 py-2 text-left font-medium text-neutral-500 select-none hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                        onClick={() => toggleAttSort('description')}
                      >
                        Description{sortIndicator('description')}
                      </th>
                      <th
                        className="cursor-pointer px-4 py-2 text-right font-medium text-neutral-500 select-none hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                        onClick={() => toggleAttSort('fileSizeBytes')}
                      >
                        Size{sortIndicator('fileSizeBytes')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAttachments.map((att: FilingAttachment) => (
                      <tr
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                        key={att.attachmentKey}
                      >
                        <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                          <SummaryTooltip summary={att.summary}>
                            {att.downloadUrl ? (
                              <a
                                className="text-blue-600 hover:underline dark:text-blue-400"
                                href={att.downloadUrl}
                                rel="noopener noreferrer"
                                target="_blank"
                              >
                                {att.attachmentName}
                              </a>
                            ) : (
                              att.attachmentName
                            )}
                          </SummaryTooltip>
                        </td>
                        <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                          {att.description}
                        </td>
                        <td className="px-4 py-2 text-right text-neutral-500 dark:text-neutral-400">
                          {formatBytes(att.fileSizeBytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Petitions / Comments */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Comments &amp; Petitions
              <span className="ml-2 text-sm font-normal text-neutral-500 dark:text-neutral-400">
                ({filing.petitions.length})
              </span>
            </h2>
            {filing.petitions.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No comments or petitions on file.
              </p>
            ) : (
              <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700">
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Type
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Number
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Party
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Date Filed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filing.petitions.map((pet: FilingPetition, idx: number) => (
                      <tr
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                        key={`${pet.filingKey}-${idx}`}
                      >
                        <td className="px-4 py-2">
                          <PleadingTypeBadge type={pet.pleadingType} />
                        </td>
                        <td className="px-4 py-2 font-mono text-xs text-neutral-600 dark:text-neutral-400">
                          {pet.pleadingNumber ?? ''}
                        </td>
                        <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                          {pet.partyName ?? 'Unknown'}
                        </td>
                        <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
                          {formatDate(pet.dateFiled)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right sidebar (1/3 width) */}
        <div className="space-y-6">
          {/* Filing details card */}
          <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
              Filing Details
            </h3>
            <dl className="space-y-3 text-sm">
              <DetailRow label="Callsign" value={filing.callsign} />
              <DetailRow label="DA Number" value={filing.daNumber} />
              <DetailRow label="Red Light Status" value={filing.redLightStatus} />
              <DetailRow label="Streamlined" value={filing.streamlined} />
              <DetailRow label="Environmental Impact" value={filing.environmentalImpact} />
              <DetailRow label="Nature of Service" value={filing.natureOfService} />
              <DetailRow label="Status Code" value={filing.statusCode} />
              {filing.applicantFrn != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Applicant FRN</dt>
                  <dd className="font-mono text-neutral-900 dark:text-neutral-100">
                    {filing.applicantFrn}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Related entities card */}
          {(filing.relatedSpaceStation != null || filing.relatedEarthStationCallsign != null) && (
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
                Related Entities
              </h3>
              <dl className="space-y-3 text-sm">
                {filing.relatedSpaceStation != null && (
                  <div>
                    <dt className="text-neutral-500 dark:text-neutral-400">Space Station</dt>
                    <dd>
                      <Link
                        className="text-blue-600 hover:underline dark:text-blue-400"
                        to={`/satellites/${filing.relatedSpaceStation.spaceStationKey}`}
                      >
                        {filing.relatedSpaceStation.usName}
                      </Link>
                      {filing.relatedSpaceStation.orbitLocation != null && (
                        <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                          ({filing.relatedSpaceStation.orbitLocation})
                        </span>
                      )}
                    </dd>
                  </div>
                )}
                {filing.relatedEarthStationCallsign != null && (
                  <div>
                    <dt className="text-neutral-500 dark:text-neutral-400">Earth Station</dt>
                    <dd>
                      <Link
                        className="text-blue-600 hover:underline dark:text-blue-400"
                        to={`/earth-stations/${filing.relatedEarthStationCallsign}`}
                      >
                        {filing.relatedEarthStationCallsign}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Dates card */}
          <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
              Key Dates
            </h3>
            <dl className="space-y-3 text-sm">
              <DetailRow label="Date Filed" value={formatDate(filing.dateFiled)} />
              <DetailRow label="Date Signed" value={formatDate(filing.dateSigned)} />
              <DetailRow label="Date Granted" value={formatDate(filing.dateGrant)} />
              <DetailRow label="Effective Date" value={formatDate(filing.dateBegin)} />
              <DetailRow label="Expiration Date" value={formatDate(filing.dateExpire)} />
              {filing.lastAction != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Last Action</dt>
                  <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                    {filing.lastAction}
                    {filing.lastActionDate != null && (
                      <span className="ml-2 text-xs text-neutral-500 dark:text-neutral-400">
                        ({formatDate(filing.lastActionDate)})
                      </span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Transfer info card (conditional) */}
          {hasTransferInfo && (
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
                Transfer Information
              </h3>
              <dl className="space-y-3 text-sm">
                {filing.transferorName != null && (
                  <div>
                    <dt className="text-neutral-500 dark:text-neutral-400">Transferor</dt>
                    <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                      {filing.transferorName}
                    </dd>
                  </div>
                )}
                {filing.transfereeName != null && (
                  <div>
                    <dt className="text-neutral-500 dark:text-neutral-400">Transferee</dt>
                    <dd className="font-medium text-neutral-900 dark:text-neutral-100">
                      {filing.transfereeName}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
