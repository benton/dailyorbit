import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api.ts';

type CompanyListItem = {
  id: number;
  name: string;
  parentName: string | null;
  filingCount: number;
};

type PaginatedCompanies = {
  data: CompanyListItem[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
};

type AttributionStats = {
  totalFilings: number;
  attributedFilings: number;
  unattributedFilings: number;
  coveragePercent: number;
  topUnattributedNames: Array<{ name: string; count: number }>;
};

export default function Companies() {
  const [companies, setCompanies] = useState<PaginatedCompanies | null>(null);
  const [stats, setStats] = useState<AttributionStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    try {
      const [companiesData, statsData] = await Promise.all([
        apiFetch<PaginatedCompanies>('/api/companies?pageSize=100&sort=name&order=asc'),
        apiFetch<AttributionStats>('/api/admin/companies/attribution'),
      ]);
      setCompanies(companiesData);
      setStats(statsData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const runAction = useCallback(
    async (endpoint: string, label: string) => {
      setActionLoading(true);
      setActionMessage(null);
      try {
        const result = await apiFetch<Record<string, unknown>>(endpoint, {
          method: 'POST',
        });
        setActionMessage(`${label}: ${JSON.stringify(result)}`);
        void fetchData();
      } catch (err: unknown) {
        setActionMessage(
          `${label} failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      } finally {
        setActionLoading(false);
      }
    },
    [fetchData],
  );

  if (loading) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading...</p>;
  }

  if (error != null) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Companies</h1>
      </div>

      {/* Attribution coverage banner */}
      {stats != null && (
        <div className="mb-6 rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
          <h2 className="mb-2 text-sm font-semibold tracking-wider text-neutral-500 uppercase dark:text-neutral-400">
            Attribution Coverage
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.coveragePercent}%
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Coverage</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.attributedFilings.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Attributed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.unattributedFilings.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Unattributed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
                {stats.totalFilings.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Total Filings</div>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/seed', 'Seed')}
        >
          Seed Companies
        </button>
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/attribute', 'Attribution')}
        >
          Run Attribution
        </button>
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() =>
            void runAction('/api/admin/companies/extract-ownership', 'Ownership Extraction')
          }
        >
          Extract Ownership
        </button>
        <button
          className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          disabled={actionLoading}
          onClick={() => void runAction('/api/admin/companies/enrich', 'Enrichment')}
        >
          Enrich (GLEIF/Wikidata)
        </button>
      </div>

      {/* Action feedback */}
      {actionMessage != null && (
        <div className="mb-6 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
          {actionMessage}
        </div>
      )}

      {/* Companies table */}
      {companies != null && companies.data.length > 0 && (
        <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                  Name
                </th>
                <th className="px-4 py-2 text-left font-medium text-neutral-500 dark:text-neutral-400">
                  Parent
                </th>
                <th className="px-4 py-2 text-right font-medium text-neutral-500 dark:text-neutral-400">
                  Filings
                </th>
              </tr>
            </thead>
            <tbody>
              {companies.data.map((company: CompanyListItem) => (
                <tr
                  key={company.id}
                  className="border-b border-neutral-100 last:border-0 dark:border-neutral-800"
                >
                  <td className="px-4 py-2 font-medium text-neutral-900 dark:text-neutral-100">
                    <Link
                      to={`/companies/${company.id}`}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {company.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-neutral-600 dark:text-neutral-400">
                    {company.parentName ?? ''}
                  </td>
                  <td className="px-4 py-2 text-right text-neutral-500 dark:text-neutral-400">
                    {company.filingCount.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {companies != null && companies.data.length === 0 && (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No companies found. Click "Seed Companies" to load satellite industry data.
        </p>
      )}
    </>
  );
}
