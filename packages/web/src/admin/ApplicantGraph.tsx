import { Cosmograph } from '@cosmograph/react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type ApplicantNode = {
  filing_count: number;
  id: string;
  name: string;
};

type ApplicantFiling = {
  app_type_code: string;
  applicant_name: string;
  date_filed: string | null;
  file_number: string;
  status_code: string | null;
  subsystem_code: string;
};

type ApplicantGraphResponse = {
  applicants: Array<ApplicantNode>;
  filings: Array<ApplicantFiling>;
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

function transformData(data: ApplicantGraphResponse): {
  links: Array<GraphLink>;
  points: Array<GraphPoint>;
} {
  const applicantCount: number = data.applicants.length;

  const nameToId: Map<string, string> = new Map();
  const nameToIdx: Map<string, number> = new Map();

  const applicantPoints: Array<GraphPoint> = data.applicants.map(
    (applicant: ApplicantNode, i: number): GraphPoint => {
      const id: string = `applicant-${i}`;
      nameToId.set(applicant.name, id);
      nameToIdx.set(applicant.name, i);
      return {
        id,
        idx: i,
        label: applicant.name,
        size: applicant.filing_count,
        type: 'applicant',
      };
    },
  );

  const filingPoints: Array<GraphPoint> = data.filings.map(
    (filing: ApplicantFiling, i: number): GraphPoint => ({
      id: filing.file_number,
      idx: applicantCount + i,
      label: filing.file_number,
      size: 1,
      type: 'filing',
    }),
  );

  const links: Array<GraphLink> = data.filings.reduce(
    (acc: Array<GraphLink>, filing: ApplicantFiling, i: number): Array<GraphLink> => {
      const sourceId: string | undefined = nameToId.get(filing.applicant_name);
      const sourceIdx: number | undefined = nameToIdx.get(filing.applicant_name);
      if (sourceId !== undefined && sourceIdx !== undefined) {
        acc.push({
          source: sourceId,
          sourceIdx,
          target: filing.file_number,
          targetIdx: applicantCount + i,
        });
      }
      return acc;
    },
    [],
  );

  return { links, points: [...applicantPoints, ...filingPoints] };
}

export default function ApplicantGraph(): React.ReactElement {
  const [points, setPoints] = useState<Array<GraphPoint>>([]);
  const [links, setLinks] = useState<Array<GraphLink>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect((): void => {
    apiFetch<ApplicantGraphResponse>('/api/admin/stats/applicant-graph')
      .then((data: ApplicantGraphResponse): void => {
        const result: { links: Array<GraphLink>; points: Array<GraphPoint> } = transformData(data);
        setPoints(result.points);
        setLinks(result.links);
        setLoading(false);
      })
      .catch((error: unknown): void => {
        const message: string =
          error instanceof Error ? error.message : 'Failed to load graph data';
        setError(message);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-neutral-500 dark:text-neutral-400">Loading graph data...</p>
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
        Applicant Network Graph
      </h2>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
        Visualizes the relationships between applicants and their IBFS filings. Larger nodes
        represent applicants with more filings.
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
