import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../lib/api.ts';
import { getSubsystem } from '../lib/subsystems.ts';
import { Badge } from '../ui/badge.tsx';

// ── Types mirroring server-side FilingDetail ────────────────────────

type FilingAttachment = {
  attachmentKey: number;
  attachmentName: string;
  description: string;
  source: string;
  downloadUrl: string;
  downloadStatus: string;
  contentType: string | null;
  fileSizeBytes: number | null;
};

type FilingPetition = {
  filingKey: number;
  partyName: string | null;
  dateFiled: string | null;
  description: string | null;
};

type RelatedSpaceStation = {
  spaceStationKey: number;
  usName: string;
  ituName: string | null;
  orbitLocation: string | null;
};

type FilingDetail = {
  filingKey: number;
  fileNumber: string;
  subsystemCode: string;
  subsystemLabel: string | null;
  appTypeCode: string;
  appTypeLabel: string | null;
  statusCode: string | null;
  statusText: string | null;
  callsign: string | null;
  applicantName: string | null;
  applicantFrn: string | null;
  dateFiled: string | null;
  dateSigned: string | null;
  dateGrant: string | null;
  dateBegin: string | null;
  dateEnd: string | null;
  dateExpire: string | null;
  lastAction: string | null;
  lastActionDate: string | null;
  briefDescription: string | null;
  description: string | null;
  daNumber: string | null;
  redLightStatus: string | null;
  streamlined: string | null;
  environmentalImpact: string | null;
  natureOfService: string | null;
  transferorName: string | null;
  transfereeName: string | null;
  attachments: FilingAttachment[];
  petitions: FilingPetition[];
  relatedSpaceStation: RelatedSpaceStation | null;
  relatedEarthStationCallsign: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (iso == null) return '';
  return new Date(iso).toLocaleDateString();
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Sidebar detail row — renders nothing when value is null/empty. */
function DetailRow({ label, value }: { label: string; value: string | null }) {
  if (value == null || value.trim() === '') return null;
  return (
    <div>
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="font-medium text-neutral-900 dark:text-neutral-100">{value}</dd>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────

export default function FilingDetailPage() {
  const { fileNumber } = useParams<{ fileNumber: string }>();

  const [filing, setFiling] = useState<FilingDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    let cancelled: boolean = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

    apiFetch<FilingDetail>(`/api/filings/${fileNumber}`)
      .then((data: FilingDetail) => {
        if (cancelled) return;
        setFiling(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          const message: string = err instanceof Error ? err.message : 'Failed to load filing';
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fileNumber]);

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
  const hasTransferInfo: boolean =
    filing.transferorName != null || filing.transfereeName != null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            {filing.fileNumber}
          </h1>
          <Badge className={`${subsystem.bg} ${subsystem.text} border-transparent`}>
            {subsystem.label}
          </Badge>
          {filing.appTypeLabel != null && (
            <span className="text-sm text-neutral-600 dark:text-neutral-300">
              {filing.appTypeLabel} ({filing.appTypeCode})
            </span>
          )}
          {filing.statusText != null && (
            <Badge variant="secondary">{filing.statusText}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500 dark:text-neutral-400">
          {filing.applicantName != null && (
            <span>
              Applicant:{' '}
              <Link
                to={`/search?applicant=${encodeURIComponent(filing.applicantName)}`}
                className="text-blue-600 hover:underline dark:text-blue-400"
              >
                {filing.applicantName}
              </Link>
            </span>
          )}
          {filing.dateFiled != null && (
            <span>Filed: {formatDate(filing.dateFiled)}</span>
          )}
        </div>
      </div>

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

          {/* Attachments */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
              Attachments
              <span className="ml-2 text-sm font-normal text-neutral-500 dark:text-neutral-400">
                ({filing.attachments.length})
              </span>
            </h2>
            {filing.attachments.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No attachments on file.
              </p>
            ) : (
              <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700">
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Name
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Description
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-neutral-500 dark:text-neutral-400">
                        Size
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filing.attachments.map((att: FilingAttachment) => (
                      <tr
                        key={att.attachmentKey}
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                      >
                        <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                          {att.downloadUrl ? (
                            <a
                              href={att.downloadUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {att.attachmentName}
                            </a>
                          ) : (
                            att.attachmentName
                          )}
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
                        Party
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Description
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Date Filed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filing.petitions.map((pet: FilingPetition, idx: number) => (
                      <tr
                        key={`${pet.filingKey}-${idx}`}
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                      >
                        <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                          {pet.partyName ?? 'Unknown'}
                        </td>
                        <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                          {pet.description ?? ''}
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
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
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
          {(filing.relatedSpaceStation != null ||
            filing.relatedEarthStationCallsign != null) && (
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Related Entities
              </h3>
              <dl className="space-y-3 text-sm">
                {filing.relatedSpaceStation != null && (
                  <div>
                    <dt className="text-neutral-500 dark:text-neutral-400">Space Station</dt>
                    <dd>
                      <Link
                        to={`/satellites/${filing.relatedSpaceStation.spaceStationKey}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
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
                        to={`/earth-stations/${filing.relatedEarthStationCallsign}`}
                        className="text-blue-600 hover:underline dark:text-blue-400"
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
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Key Dates
            </h3>
            <dl className="space-y-3 text-sm">
              <DetailRow label="Date Filed" value={formatDate(filing.dateFiled)} />
              <DetailRow label="Date Signed" value={formatDate(filing.dateSigned)} />
              <DetailRow label="Date Granted" value={formatDate(filing.dateGrant)} />
              <DetailRow label="Effective Date" value={formatDate(filing.dateBegin)} />
              <DetailRow label="Expiration Date" value={formatDate(filing.dateExpire)} />
              <DetailRow label="End Date" value={formatDate(filing.dateEnd)} />
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
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
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
