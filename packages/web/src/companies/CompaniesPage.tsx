import type { ColumnDef } from '@tanstack/react-table';
import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';

type CompanyListItem = {
  filingCount: number;
  id: number;
  name: string;
  parentName: string | null;
};

const companyColumns: Array<ColumnDef<CompanyListItem, unknown>> = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 300,
  },
  {
    accessorKey: 'parentName',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Parent Company',
    size: 250,
  },
  {
    accessorKey: 'filingCount',
    cell: ({ getValue }) => (getValue() as number).toLocaleString(),
    header: 'Filings',
    size: 100,
  },
];

export default function CompaniesPage() {
  const navigate = useNavigate();

  const fetchCompanies = useCallback(
    (params: DataTableFetchParams): Promise<PaginatedResponse<CompanyListItem>> => {
      const parts: Array<string> = [`page=${params.page}`, `pageSize=${params.pageSize}`];
      if (params.sort != null) {
        parts.push(`sort=${params.sort}`);
      }
      if (params.order != null) {
        parts.push(`order=${params.order}`);
      }
      return apiFetch<PaginatedResponse<CompanyListItem>>(`/api/companies?${parts.join('&')}`);
    },
    [],
  );

  const onRowClick = useCallback(
    (row: CompanyListItem) => {
      void navigate(`/companies/${row.id}`);
    },
    [navigate],
  );

  const cols = useMemo(() => companyColumns, []);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Companies</h1>
      <DataTable<CompanyListItem>
        columns={cols}
        defaultOrder="asc"
        defaultSort="name"
        fetchData={fetchCompanies}
        onRowClick={onRowClick}
      />
    </div>
  );
}
