import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, apiFetch } from '../lib/api.ts';

type CompanyAlias = {
  companyId: number;
  aliasName: string;
  aliasType: string;
};

type CompanyListItem = {
  id: number;
  name: string;
  parentName: string | null;
  filingCount: number;
};

type OwnershipEvent = {
  eventId: number;
  filingFileNumber: string;
  transferorCompanyId: number | null;
  transfereeCompanyId: number | null;
  effectiveDate: string | null;
  eventType: string;
  status: string;
  description: string | null;
};

type Company = {
  id: number;
  name: string;
  parentCompanyId: number | null;
  stockTicker: string | null;
  stockExchange: string | null;
  industry: string | null;
  logoUrl: string | null;
  website: string | null;
  description: string | null;
  gleifLei: string | null;
  wikidataId: string | null;
  createdAt: string;
  updatedAt: string;
};

type CompanyDetail = {
  company: Company;
  aliases: CompanyAlias[];
  subsidiaries: CompanyListItem[];
  parent: CompanyListItem | null;
  filingCount: number;
  ownershipEvents: OwnershipEvent[];
};

function formatDate(iso: string | null): string {
  if (iso == null) return '';
  return new Date(iso).toLocaleDateString();
}

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [detail, setDetail] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<boolean>(false);

  useEffect(() => {
    let cancelled: boolean = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

    apiFetch<CompanyDetail>(`/api/companies/${id}`)
      .then((data: CompanyDetail) => {
        if (cancelled) return;
        setDetail(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          const message: string = err instanceof Error ? err.message : 'Failed to load company';
          setError(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-neutral-500 dark:text-neutral-400">
        Loading company data...
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-2">
        <span className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Company not found
        </span>
      </div>
    );
  }

  if (error != null || detail == null) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-red-600 dark:text-red-400">
        {error ?? 'An unexpected error occurred'}
      </div>
    );
  }

  const { company, aliases, subsidiaries, parent, filingCount, ownershipEvents } = detail;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {company.name}
        </h1>
        <div className="flex flex-wrap items-center gap-4 text-sm text-neutral-500 dark:text-neutral-400">
          {company.stockTicker != null && (
            <span>
              {company.stockExchange ?? ''}: {company.stockTicker}
            </span>
          )}
          {company.industry != null && <span>{company.industry}</span>}
          <span>{filingCount.toLocaleString()} filings</span>
        </div>
        {company.description != null && (
          <p className="text-sm text-neutral-700 dark:text-neutral-300">{company.description}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Subsidiaries */}
          {subsidiaries.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Subsidiaries
              </h2>
              <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700">
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Name
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-neutral-500 dark:text-neutral-400">
                        Filings
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {subsidiaries.map((sub: CompanyListItem) => (
                      <tr
                        key={sub.id}
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                      >
                        <td className="px-4 py-2 font-medium">
                          <Link
                            to={`/companies/${sub.id}`}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {sub.name}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-right text-neutral-500 dark:text-neutral-400">
                          {sub.filingCount.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Ownership Events */}
          {ownershipEvents.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                Ownership Events
              </h2>
              <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700">
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Filing
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Type
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Status
                      </th>
                      <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownershipEvents.map((event: OwnershipEvent) => (
                      <tr
                        key={event.eventId}
                        className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                      >
                        <td className="px-4 py-2">
                          <Link
                            to={`/filings/${event.filingFileNumber}`}
                            className="text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {event.filingFileNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                          {event.eventType === 'transfer_of_control'
                            ? 'Transfer of Control'
                            : 'Assignment'}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                              event.status === 'granted'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : event.status === 'pending'
                                  ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                                  : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400'
                            }`}
                          >
                            {event.status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-neutral-500 dark:text-neutral-400">
                          {formatDate(event.effectiveDate)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Right sidebar */}
        <div className="space-y-6">
          {/* Company info card */}
          <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
              Company Details
            </h3>
            <dl className="space-y-3 text-sm">
              {parent != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Parent Company</dt>
                  <dd>
                    <Link
                      to={`/companies/${parent.id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {parent.name}
                    </Link>
                  </dd>
                </div>
              )}
              {company.website != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Website</dt>
                  <dd>
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {company.website}
                    </a>
                  </dd>
                </div>
              )}
              {company.gleifLei != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">GLEIF LEI</dt>
                  <dd className="font-mono text-xs text-neutral-900 dark:text-neutral-100">
                    {company.gleifLei}
                  </dd>
                </div>
              )}
              {company.wikidataId != null && (
                <div>
                  <dt className="text-neutral-500 dark:text-neutral-400">Wikidata</dt>
                  <dd>
                    <a
                      href={`https://www.wikidata.org/wiki/${company.wikidataId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {company.wikidataId}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Aliases card */}
          {aliases.length > 0 && (
            <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
              <h3 className="mb-3 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
                Known Aliases ({aliases.length})
              </h3>
              <ul className="space-y-1 text-sm">
                {aliases.map((alias: CompanyAlias) => (
                  <li key={alias.aliasName} className="text-neutral-700 dark:text-neutral-300">
                    {alias.aliasName}
                    <span className="ml-1 text-xs text-neutral-400 dark:text-neutral-500">
                      ({alias.aliasType})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
