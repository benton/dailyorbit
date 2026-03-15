import { Cosmograph } from '@cosmograph/react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import CosmographWrapper from '../ui/CosmographWrapper.tsx';

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
  color: string;
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
  // Build parent name set and child-of-parent set to filter out isolates
  const parentNames: Set<string> = new Set();
  const childNames: Set<string> = new Set();
  for (const c of companies) {
    if (c.parentName != null) {
      parentNames.add(c.parentName);
      childNames.add(c.name);
    }
  }

  // Only include companies that are a parent or a child
  const relevant: CompanyListItem[] = companies.filter(
    (c) => parentNames.has(c.name) || childNames.has(c.name),
  );

  const idToIdx: Map<number, number> = new Map();

  const points: Array<GraphPoint> = relevant.map(
    (company: CompanyListItem, i: number): GraphPoint => {
      idToIdx.set(company.id, i);
      return {
        id: `company-${company.id}`,
        idx: i,
        label: company.name,
        size: Math.max(3, Math.sqrt(company.filingCount) * 2),
        color: company.parentName != null ? '#3b82f6' : '#f59e0b',
      };
    },
  );

  const links: Array<GraphLink> = [];
  for (const company of relevant) {
    if (company.parentName != null) {
      const parentCompany: CompanyListItem | undefined = relevant.find(
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
      <div className="flex h-32 items-center justify-center">
        <p className="text-neutral-500 dark:text-neutral-400">Loading company graph...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-32 items-center justify-center">
        <p className="text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        No parent-subsidiary relationships found.
      </p>
    );
  }

  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Company Hierarchy
      </h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Parent-subsidiary relationships. Node size reflects filing count.
      </p>
      <CosmographWrapper>
        <div className="h-[400px] w-full" style={{ backgroundColor: '#000000' }}>
          <Cosmograph
            links={links}
            linkSourceBy="source"
            linkSourceIndexBy="sourceIdx"
            linkTargetBy="target"
            linkTargetIndexBy="targetIdx"
            linkWidth={3}
            pointColorBy="color"
            pointIdBy="id"
            pointIndexBy="idx"
            pointLabelBy="label"
            points={points}
            pointSizeBy="size"
          />
        </div>
      </CosmographWrapper>
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#f59e0b]" />
          <dt className="inline">Parent company</dt>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#3b82f6]" />
          <dt className="inline">Subsidiary</dt>
        </div>
        <div className="flex items-center gap-2">
          <dd>Node size = filing count</dd>
        </div>
      </dl>
    </div>
  );
}
