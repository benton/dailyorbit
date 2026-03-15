import { Cosmograph } from '@cosmograph/react';
import { useEffect, useState } from 'react';
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

type GraphPoint = {
  id: string;
  idx: number;
  label: string;
  size: number;
  type: string;
};

type GraphLink = {
  source: string;
  sourceIdx: number;
  target: string;
  targetIdx: number;
};

function transformData(companies: CompanyListItem[]): {
  links: Array<GraphLink>;
  points: Array<GraphPoint>;
} {
  const idToIdx: Map<number, number> = new Map();

  const points: Array<GraphPoint> = companies.map(
    (company: CompanyListItem, i: number): GraphPoint => {
      idToIdx.set(company.id, i);
      return {
        id: `company-${company.id}`,
        idx: i,
        label: company.name,
        size: Math.max(1, Math.log2(company.filingCount + 1) * 3),
        type: company.parentName != null ? 'subsidiary' : 'parent',
      };
    },
  );

  const links: Array<GraphLink> = [];
  for (const company of companies) {
    if (company.parentName != null) {
      // Find parent by name match
      const parentCompany: CompanyListItem | undefined = companies.find(
        (c) => c.name === company.parentName,
      );
      if (parentCompany != null) {
        const sourceIdx: number | undefined = idToIdx.get(parentCompany.id);
        const targetIdx: number | undefined = idToIdx.get(company.id);
        if (sourceIdx !== undefined && targetIdx !== undefined) {
          links.push({
            source: `company-${parentCompany.id}`,
            sourceIdx,
            target: `company-${company.id}`,
            targetIdx,
          });
        }
      }
    }
  }

  return { links, points };
}

export default function CompanyGraph(): React.ReactElement {
  const [points, setPoints] = useState<Array<GraphPoint>>([]);
  const [links, setLinks] = useState<Array<GraphLink>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect((): void => {
    apiFetch<PaginatedCompanies>('/api/companies?pageSize=100&sort=name&order=asc')
      .then((data: PaginatedCompanies): void => {
        const result = transformData(data.data);
        setPoints(result.points);
        setLinks(result.links);
        setLoading(false);
      })
      .catch((err: unknown): void => {
        const message: string = err instanceof Error ? err.message : 'Failed to load company data';
        setError(message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-neutral-500 dark:text-neutral-400">Loading company graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Company Hierarchy Graph
      </h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Visualizes parent-subsidiary relationships between satellite companies. Node size reflects
        filing count.
      </p>
      <div className="h-[600px] w-full rounded border border-neutral-300 dark:border-neutral-700">
        <Cosmograph
          links={links}
          linkSourceBy="source"
          linkSourceIndexBy="sourceIdx"
          linkTargetBy="target"
          linkTargetIndexBy="targetIdx"
          pointColorBy="type"
          pointIdBy="id"
          pointIndexBy="idx"
          pointLabelBy="label"
          points={points}
          pointSizeBy="size"
        />
      </div>
    </div>
  );
}
