import { Cosmograph } from '@cosmograph/react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import CosmographWrapper from '../ui/CosmographWrapper.tsx';

type CompanyGraphNode = {
  id: number;
  name: string;
  filingCount: number;
};

type CompanyGraphFiling = {
  fileNumber: string;
  companyId: number;
  subsystemCode: string;
  appTypeCode: string;
};

type CompanyFilingGraphResponse = {
  companies: CompanyGraphNode[];
  filings: CompanyGraphFiling[];
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

function transformData(data: CompanyFilingGraphResponse): {
  links: Array<GraphLink>;
  points: Array<GraphPoint>;
} {
  const companyCount: number = data.companies.length;

  const idToIdx: Map<number, number> = new Map();
  const idToPointId: Map<number, string> = new Map();

  const companyPoints: Array<GraphPoint> = data.companies.map(
    (company: CompanyGraphNode, i: number): GraphPoint => {
      const pointId: string = `company-${company.id}`;
      idToIdx.set(company.id, i);
      idToPointId.set(company.id, pointId);
      return {
        id: pointId,
        idx: i,
        label: company.name,
        size: Math.max(3, Math.sqrt(company.filingCount) * 2),
        type: 'company',
      };
    },
  );

  const filingPoints: Array<GraphPoint> = data.filings.map(
    (filing: CompanyGraphFiling, i: number): GraphPoint => ({
      id: filing.fileNumber,
      idx: companyCount + i,
      label: filing.fileNumber,
      size: 1,
      type: 'filing',
    }),
  );

  const links: Array<GraphLink> = data.filings.reduce(
    (acc: Array<GraphLink>, filing: CompanyGraphFiling, i: number): Array<GraphLink> => {
      const sourceId: string | undefined = idToPointId.get(filing.companyId);
      const sourceIdx: number | undefined = idToIdx.get(filing.companyId);
      if (sourceId !== undefined && sourceIdx !== undefined) {
        acc.push({
          source: sourceId,
          sourceIdx,
          target: filing.fileNumber,
          targetIdx: companyCount + i,
        });
      }
      return acc;
    },
    [],
  );

  return { links, points: [...companyPoints, ...filingPoints] };
}

export default function CompanyFilingGraph(): React.ReactElement {
  const [points, setPoints] = useState<Array<GraphPoint>>([]);
  const [links, setLinks] = useState<Array<GraphLink>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect((): void => {
    apiFetch<CompanyFilingGraphResponse>('/api/companies/graph')
      .then((data: CompanyFilingGraphResponse): void => {
        const result = transformData(data);
        setPoints(result.points);
        setLinks(result.links);
        setLoading(false);
      })
      .catch((err: unknown): void => {
        const message: string = err instanceof Error ? err.message : 'Failed to load graph data';
        setError(message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-neutral-500 dark:text-neutral-400">Loading company filing network...</p>
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
    <div className="p-4">
      <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        Company Filing Network
      </h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Visualizes relationships between companies and their FCC filings. Larger nodes represent
        companies with more filings.
      </p>
      <CosmographWrapper>
        <div className="h-[calc(100vh-200px)] w-full">
          <Cosmograph
            links={links}
            linkSourceBy="source"
            linkSourceIndexBy="sourceIdx"
            linkTargetBy="target"
            linkTargetIndexBy="targetIdx"
            linkWidth={2}
            pointColorBy="type"
            pointIdBy="id"
            pointIndexBy="idx"
            pointLabelBy="label"
            points={points}
            pointSizeBy="size"
          />
        </div>
      </CosmographWrapper>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-neutral-600 dark:text-neutral-400">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#6b7280]" />
          <dt className="inline">Company</dt>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-[#3b82f6]" />
          <dt className="inline">Filing</dt>
        </div>
        <div className="flex items-center gap-2">
          <dd>Node size = filing count</dd>
        </div>
      </dl>
    </div>
  );
}
