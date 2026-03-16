import type { ColumnDef } from '@tanstack/react-table';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { apiFetch } from '../lib/api.ts';
import { cn } from '../lib/cn.ts';
import { APP_TYPE_CODES, SUBSYSTEM_OPTIONS } from '../lib/subsystems.ts';
import { Button } from '../ui/button.tsx';
import { DataTable, type DataTableFetchParams, type PaginatedResponse } from '../ui/DataTable.tsx';
import { Input } from '../ui/input.tsx';
import { Label } from '../ui/label.tsx';
import { SummaryTooltip } from '../ui/SummaryTooltip.tsx';

// ── Types mirroring server-side search result shapes ─────────────────

type FilingSearchResult = {
  address_attention: string | null;
  app_type_code: string;
  callsign: string | null;
  company_name: string | null;
  date_filed: string | null;
  file_number: string;
  status_code: string | null;
  subsystem_code: string;
  summary: string | null;
};

type SatelliteSearchResult = {
  company_name: string | null;
  inactive_date: string | null;
  itu_name: string | null;
  orbit_location: string | null;
  space_station_key: number;
  us_name: string;
};

type EarthStationSearchResult = {
  address_attention: string | null;
  callsign: string;
  company_name: string | null;
  filing_count: number;
  most_recent_filing: string | null;
};

type SearchTab = 'filings' | 'satellites' | 'earth-stations';

const TABS: ReadonlyArray<{ key: SearchTab; label: string }> = [
  { key: 'filings', label: 'Filings' },
  { key: 'satellites', label: 'Satellites' },
  { key: 'earth-stations', label: 'Earth Stations' },
];

// ── Autocomplete hook ────────────────────────────────────────────────

function useAutocomplete(
  entity: string,
  field: string,
): {
  clearSuggestions: () => void;
  query: string;
  setQuery: (value: string) => void;
  suggestions: Array<string>;
} {
  const [query, setQuery] = useState<string>('');
  const [suggestions, setSuggestions] = useState<Array<string>>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.length < 2) {
      // eslint-disable-next-line react-hooks-js/set-state-in-effect
      setSuggestions([]);
      return;
    }
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      apiFetch<Array<string>>(
        `/api/autocomplete/${entity}/${field}?q=${encodeURIComponent(query)}&limit=10`,
      )
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);

    return () => {
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, entity, field]);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  return { clearSuggestions, query, setQuery, suggestions };
}

// ── AutocompleteInput component ──────────────────────────────────────

type AutocompleteInputProps = {
  entity: string;
  field: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
};

function AutocompleteInput({
  entity,
  field,
  label,
  onChange,
  placeholder,
  value,
}: AutocompleteInputProps) {
  const { clearSuggestions, setQuery, suggestions } = useAutocomplete(entity, field);
  const [showDropdown, setShowDropdown] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleInput = useCallback(
    (newValue: string) => {
      onChange(newValue);
      setQuery(newValue);
      setShowDropdown(true);
    },
    [onChange, setQuery],
  );

  const handleSelect = useCallback(
    (suggestion: string) => {
      onChange(suggestion);
      setShowDropdown(false);
      clearSuggestions();
    },
    [onChange, clearSuggestions],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current != null && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <Label className="mb-1 block text-neutral-700 dark:text-neutral-300">{label}</Label>
      <Input
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0) {
            setShowDropdown(true);
          }
        }}
        placeholder={placeholder ?? `Search ${label.toLowerCase()}...`}
        value={value}
      />
      {showDropdown && suggestions.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          {suggestions.map((s: string) => (
            <li
              className="cursor-pointer px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
              key={s}
              onMouseDown={() => handleSelect(s)}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── MultiSelect component ────────────────────────────────────────────

type MultiSelectProps = {
  label: string;
  onChange: (values: Array<string>) => void;
  options: ReadonlyArray<{ code: string; label: string }>;
  selected: Array<string>;
};

function MultiSelect({ label, onChange, options, selected }: MultiSelectProps) {
  const [open, setOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(
    (code: string) => {
      const next: Array<string> = selected.includes(code)
        ? selected.filter((s: string) => s !== code)
        : [...selected, code];
      onChange(next);
    },
    [selected, onChange],
  );

  const clearAll = useCallback(() => onChange([]), [onChange]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current != null && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayText: string =
    selected.length === 0
      ? 'Any'
      : selected.length <= 3
        ? selected.join(', ')
        : `${selected.length} selected`;

  return (
    <div className="relative" ref={containerRef}>
      <Label className="mb-1 block text-neutral-700 dark:text-neutral-300">{label}</Label>
      <button
        className="flex h-9 w-full items-center justify-between rounded-md border border-neutral-200 bg-transparent px-3 text-left text-sm shadow-sm dark:border-neutral-700"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="truncate text-neutral-700 dark:text-neutral-300">{displayText}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          {selected.length > 0 && (
            <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
              <button
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                onClick={clearAll}
                type="button"
              >
                Clear all
              </button>
            </div>
          )}
          {options.map((opt) => (
            <label
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
              key={opt.code}
            >
              <input
                checked={selected.includes(opt.code)}
                className="rounded"
                onChange={() => toggle(opt.code)}
                type="checkbox"
              />
              <span className="font-mono text-xs text-neutral-500">{opt.code}</span>
              <span className="text-neutral-700 dark:text-neutral-300">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AutocompleteMultiSelect: fetches options from autocomplete endpoint ───

type AutocompleteMultiSelectProps = {
  entity: string;
  field: string;
  label: string;
  onChange: (values: Array<string>) => void;
  selected: Array<string>;
};

function AutocompleteMultiSelect({
  entity,
  field,
  label,
  onChange,
  selected,
}: AutocompleteMultiSelectProps) {
  const [query, setQuery] = useState<string>('');
  const [suggestions, setSuggestions] = useState<Array<string>>([]);
  const [open, setOpen] = useState<boolean>(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 1) {
      // eslint-disable-next-line react-hooks-js/set-state-in-effect
      setSuggestions([]);
      return;
    }
    if (debounceRef.current != null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      apiFetch<Array<string>>(
        `/api/autocomplete/${entity}/${field}?q=${encodeURIComponent(query)}&limit=20`,
      )
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 250);
    return () => {
      if (debounceRef.current != null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, entity, field]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current != null && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = useCallback(
    (value: string) => {
      const next: Array<string> = selected.includes(value)
        ? selected.filter((s: string) => s !== value)
        : [...selected, value];
      onChange(next);
    },
    [selected, onChange],
  );

  const displayText: string =
    selected.length === 0
      ? 'Any'
      : selected.length <= 3
        ? selected.join(', ')
        : `${selected.length} selected`;

  return (
    <div className="relative" ref={containerRef}>
      <Label className="mb-1 block text-neutral-700 dark:text-neutral-300">{label}</Label>
      <button
        className="flex h-9 w-full items-center justify-between rounded-md border border-neutral-200 bg-transparent px-3 text-left text-sm shadow-sm dark:border-neutral-700"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span className="truncate text-neutral-700 dark:text-neutral-300">{displayText}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-neutral-500" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
            <Input
              className="h-7 text-xs"
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Type to search ${label.toLowerCase()}...`}
              value={query}
            />
          </div>
          {selected.length > 0 && (
            <div className="border-b border-neutral-200 p-2 dark:border-neutral-700">
              <div className="flex flex-wrap gap-1">
                {selected.map((s: string) => (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-neutral-100 px-2 py-0.5 text-xs dark:bg-neutral-700"
                    key={s}
                  >
                    {s}
                    <button
                      className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                      onClick={() => toggle(s)}
                      type="button"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <ul className="max-h-48 overflow-y-auto">
            {suggestions
              .filter((s: string) => !selected.includes(s))
              .map((s: string) => (
                <li
                  className="cursor-pointer px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                  key={s}
                  onMouseDown={() => toggle(s)}
                >
                  {s}
                </li>
              ))}
            {suggestions.length === 0 && query.length > 0 && (
              <li className="px-3 py-2 text-xs text-neutral-500">No results</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Column definitions ───────────────────────────────────────────────

const filingColumns: Array<ColumnDef<FilingSearchResult, unknown>> = [
  {
    accessorKey: 'file_number',
    cell: ({ row }) => (
      <SummaryTooltip summary={row.original.summary}>
        <span className="font-mono text-sm">{row.original.file_number}</span>
      </SummaryTooltip>
    ),
    header: 'File Number',
    size: 240,
  },
  {
    accessorKey: 'subsystem_code',
    header: 'Subsystem',
    size: 80,
  },
  {
    accessorKey: 'app_type_code',
    header: 'App Type',
    size: 80,
  },
  {
    accessorKey: 'address_attention',
    header: 'Applicant',
    size: 180,
  },
  {
    accessorKey: 'company_name',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Company',
    size: 180,
  },
  {
    accessorKey: 'callsign',
    header: 'Callsign',
    size: 100,
  },
  {
    accessorKey: 'status_code',
    header: 'Status',
    size: 100,
  },
  {
    accessorKey: 'date_filed',
    cell: ({ getValue }) => {
      const value: string | null = getValue() as string | null;
      return value != null ? new Date(value).toLocaleDateString() : '';
    },
    header: 'Date Filed',
    size: 120,
  },
];

const satelliteColumns: Array<ColumnDef<SatelliteSearchResult, unknown>> = [
  {
    accessorKey: 'us_name',
    header: 'US Name',
    size: 200,
  },
  {
    accessorKey: 'itu_name',
    header: 'ITU Name',
    size: 200,
  },
  {
    accessorKey: 'company_name',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Company',
    size: 180,
  },
  {
    accessorKey: 'orbit_location',
    header: 'Orbital Position',
    size: 150,
  },
  {
    accessorKey: 'inactive_date',
    cell: ({ getValue }) => {
      const value: string | null = getValue() as string | null;
      return value == null ? 'Active' : 'Inactive';
    },
    header: 'Status',
    size: 100,
  },
];

const earthStationColumns: Array<ColumnDef<EarthStationSearchResult, unknown>> = [
  {
    accessorKey: 'callsign',
    header: 'Callsign',
    size: 120,
  },
  {
    accessorKey: 'address_attention',
    header: 'Applicant',
    size: 200,
  },
  {
    accessorKey: 'company_name',
    cell: ({ getValue }) => (getValue() as string | null) ?? '',
    header: 'Company',
    size: 180,
  },
  {
    accessorKey: 'filing_count',
    header: 'Filings',
    size: 80,
  },
  {
    accessorKey: 'most_recent_filing',
    cell: ({ getValue }) => {
      const value: string | null = getValue() as string | null;
      return value != null ? new Date(value).toLocaleDateString() : '';
    },
    header: 'Most Recent',
    size: 120,
  },
];

// ── Filter forms ─────────────────────────────────────────────────────

type FilingFilters = {
  app_type_code: Array<string>;
  applicant: string;
  callsign: string;
  company: string;
  date_filed_from: string;
  date_filed_to: string;
  file_number: string;
  status_code: Array<string>;
  subsystem_code: Array<string>;
};

function emptyFilingFilters(): FilingFilters {
  return {
    app_type_code: [],
    applicant: '',
    callsign: '',
    company: '',
    date_filed_from: '',
    date_filed_to: '',
    file_number: '',
    status_code: [],
    subsystem_code: [],
  };
}

type SatelliteFilters = {
  active: 'any' | 'true' | 'false';
  company: string;
  itu_name: string;
  orbit_location: string;
  us_name: string;
};

function emptySatelliteFilters(): SatelliteFilters {
  return { active: 'any', company: '', itu_name: '', orbit_location: '', us_name: '' };
}

type EarthStationFilters = {
  applicant: string;
  callsign: string;
  city: string;
  company: string;
  state: Array<string>;
};

function emptyEarthStationFilters(): EarthStationFilters {
  return { applicant: '', callsign: '', city: '', company: '', state: [] };
}

// ── Filing filter form ───────────────────────────────────────────────

function FilingFilterForm({
  filters,
  onChange,
}: {
  filters: FilingFilters;
  onChange: (filters: FilingFilters) => void;
}) {
  const update = useCallback(
    <K extends keyof FilingFilters>(key: K, value: FilingFilters[K]) => {
      onChange({ ...filters, [key]: value });
    },
    [filters, onChange],
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <Label className="mb-1 block text-neutral-700 dark:text-neutral-300">File Number</Label>
        <Input
          onChange={(e) => update('file_number', e.target.value)}
          placeholder="e.g. SAT-LOA-2024..."
          value={filters.file_number}
        />
      </div>
      <AutocompleteInput
        entity="filings"
        field="callsign"
        label="Callsign"
        onChange={(v: string) => update('callsign', v)}
        value={filters.callsign}
      />
      <AutocompleteInput
        entity="filings"
        field="address_attention"
        label="Applicant"
        onChange={(v: string) => update('applicant', v)}
        value={filters.applicant}
      />
      <AutocompleteInput
        entity="companies"
        field="name"
        label="Company"
        onChange={(v: string) => update('company', v)}
        value={filters.company}
      />
      <MultiSelect
        label="Subsystem"
        onChange={(v: Array<string>) => update('subsystem_code', v)}
        options={SUBSYSTEM_OPTIONS}
        selected={filters.subsystem_code}
      />
      <MultiSelect
        label="App Type"
        onChange={(v: Array<string>) => update('app_type_code', v)}
        options={APP_TYPE_CODES}
        selected={filters.app_type_code}
      />
      <AutocompleteMultiSelect
        entity="filings"
        field="status_code"
        label="Status"
        onChange={(v: Array<string>) => update('status_code', v)}
        selected={filters.status_code}
      />
      <div>
        <Label className="mb-1 block text-neutral-700 dark:text-neutral-300">Date Filed From</Label>
        <Input
          onChange={(e) => update('date_filed_from', e.target.value)}
          type="date"
          value={filters.date_filed_from}
        />
      </div>
      <div>
        <Label className="mb-1 block text-neutral-700 dark:text-neutral-300">Date Filed To</Label>
        <Input
          onChange={(e) => update('date_filed_to', e.target.value)}
          type="date"
          value={filters.date_filed_to}
        />
      </div>
    </div>
  );
}

// ── Satellite filter form ────────────────────────────────────────────

function SatelliteFilterForm({
  filters,
  onChange,
}: {
  filters: SatelliteFilters;
  onChange: (filters: SatelliteFilters) => void;
}) {
  const update = useCallback(
    <K extends keyof SatelliteFilters>(key: K, value: SatelliteFilters[K]) => {
      onChange({ ...filters, [key]: value });
    },
    [filters, onChange],
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <AutocompleteInput
        entity="satellites"
        field="us_name"
        label="US Name"
        onChange={(v: string) => update('us_name', v)}
        value={filters.us_name}
      />
      <AutocompleteInput
        entity="satellites"
        field="itu_name"
        label="ITU Name"
        onChange={(v: string) => update('itu_name', v)}
        value={filters.itu_name}
      />
      <AutocompleteInput
        entity="satellites"
        field="orbit_location"
        label="Orbital Position"
        onChange={(v: string) => update('orbit_location', v)}
        value={filters.orbit_location}
      />
      <AutocompleteInput
        entity="companies"
        field="name"
        label="Company"
        onChange={(v: string) => update('company', v)}
        value={filters.company}
      />
      <div>
        <Label className="mb-1 block text-neutral-700 dark:text-neutral-300">Status</Label>
        <div className="flex h-9 items-center gap-4">
          {(['any', 'true', 'false'] as const).map((val) => (
            <label className="flex items-center gap-1.5 text-sm" key={val}>
              <input
                checked={filters.active === val}
                name="satellite-active"
                onChange={() => update('active', val)}
                type="radio"
              />
              <span className="text-neutral-700 dark:text-neutral-300">
                {val === 'any' ? 'Any' : val === 'true' ? 'Active' : 'Inactive'}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Earth station filter form ────────────────────────────────────────

function EarthStationFilterForm({
  filters,
  onChange,
}: {
  filters: EarthStationFilters;
  onChange: (filters: EarthStationFilters) => void;
}) {
  const update = useCallback(
    <K extends keyof EarthStationFilters>(key: K, value: EarthStationFilters[K]) => {
      onChange({ ...filters, [key]: value });
    },
    [filters, onChange],
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <AutocompleteInput
        entity="earth-stations"
        field="callsign"
        label="Callsign"
        onChange={(v: string) => update('callsign', v)}
        value={filters.callsign}
      />
      <AutocompleteInput
        entity="earth-stations"
        field="address_attention"
        label="Applicant"
        onChange={(v: string) => update('applicant', v)}
        value={filters.applicant}
      />
      <AutocompleteMultiSelect
        entity="earth-stations"
        field="state"
        label="State"
        onChange={(v: Array<string>) => update('state', v)}
        selected={filters.state}
      />
      <AutocompleteInput
        entity="earth-stations"
        field="city"
        label="City"
        onChange={(v: string) => update('city', v)}
        value={filters.city}
      />
      <AutocompleteInput
        entity="companies"
        field="name"
        label="Company"
        onChange={(v: string) => update('company', v)}
        value={filters.company}
      />
    </div>
  );
}

// ── Query string builders ────────────────────────────────────────────

function buildFilingQueryString(filters: FilingFilters, params: DataTableFetchParams): string {
  const parts: Array<string> = [`page=${params.page}`, `pageSize=${params.pageSize}`];
  if (params.sort != null) {
    parts.push(`sort=${params.sort}`);
  }
  if (params.order != null) {
    parts.push(`order=${params.order}`);
  }
  if (filters.file_number.trim() !== '') {
    parts.push(`file_number=${encodeURIComponent(filters.file_number.trim())}`);
  }
  if (filters.callsign.trim() !== '') {
    parts.push(`callsign=${encodeURIComponent(filters.callsign.trim())}`);
  }
  if (filters.applicant.trim() !== '') {
    parts.push(`applicant=${encodeURIComponent(filters.applicant.trim())}`);
  }
  if (filters.company.trim() !== '') {
    parts.push(`company=${encodeURIComponent(filters.company.trim())}`);
  }
  if (filters.subsystem_code.length > 0) {
    parts.push(`subsystem_code=${filters.subsystem_code.join(',')}`);
  }
  if (filters.app_type_code.length > 0) {
    parts.push(`app_type_code=${filters.app_type_code.join(',')}`);
  }
  if (filters.status_code.length > 0) {
    parts.push(`status_code=${filters.status_code.join(',')}`);
  }
  if (filters.date_filed_from !== '') {
    parts.push(`date_filed_from=${filters.date_filed_from}`);
  }
  if (filters.date_filed_to !== '') {
    parts.push(`date_filed_to=${filters.date_filed_to}`);
  }
  return parts.join('&');
}

function buildSatelliteQueryString(
  filters: SatelliteFilters,
  params: DataTableFetchParams,
): string {
  const parts: Array<string> = [`page=${params.page}`, `pageSize=${params.pageSize}`];
  if (params.sort != null) {
    parts.push(`sort=${params.sort}`);
  }
  if (params.order != null) {
    parts.push(`order=${params.order}`);
  }
  if (filters.us_name.trim() !== '') {
    parts.push(`us_name=${encodeURIComponent(filters.us_name.trim())}`);
  }
  if (filters.itu_name.trim() !== '') {
    parts.push(`itu_name=${encodeURIComponent(filters.itu_name.trim())}`);
  }
  if (filters.orbit_location.trim() !== '') {
    parts.push(`orbit_location=${encodeURIComponent(filters.orbit_location.trim())}`);
  }
  if (filters.active !== 'any') {
    parts.push(`active=${filters.active}`);
  }
  if (filters.company.trim() !== '') {
    parts.push(`company=${encodeURIComponent(filters.company.trim())}`);
  }
  return parts.join('&');
}

function buildEarthStationQueryString(
  filters: EarthStationFilters,
  params: DataTableFetchParams,
): string {
  const parts: Array<string> = [`page=${params.page}`, `pageSize=${params.pageSize}`];
  if (params.sort != null) {
    parts.push(`sort=${params.sort}`);
  }
  if (params.order != null) {
    parts.push(`order=${params.order}`);
  }
  if (filters.callsign.trim() !== '') {
    parts.push(`callsign=${encodeURIComponent(filters.callsign.trim())}`);
  }
  if (filters.applicant.trim() !== '') {
    parts.push(`applicant=${encodeURIComponent(filters.applicant.trim())}`);
  }
  if (filters.state.length > 0) {
    parts.push(`state=${filters.state.join(',')}`);
  }
  if (filters.city.trim() !== '') {
    parts.push(`city=${encodeURIComponent(filters.city.trim())}`);
  }
  if (filters.company.trim() !== '') {
    parts.push(`company=${encodeURIComponent(filters.company.trim())}`);
  }
  return parts.join('&');
}

// ── Main SearchPage component ────────────────────────────────────────

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Active tab from URL or default
  const activeTab: SearchTab = (searchParams.get('tab') as SearchTab) ?? 'filings';

  // Filter panel collapsed state
  const [filtersOpen, setFiltersOpen] = useState<boolean>(true);

  // Filter state per tab
  const [filingFilters, setFilingFilters] = useState<FilingFilters>(emptyFilingFilters);
  const [satelliteFilters, setSatelliteFilters] = useState<SatelliteFilters>(emptySatelliteFilters);
  const [earthStationFilters, setEarthStationFilters] =
    useState<EarthStationFilters>(emptyEarthStationFilters);

  // Trigger counter to force DataTable refetch when filters change on search
  const [searchTrigger, setSearchTrigger] = useState<number>(0);

  const switchTab = useCallback(
    (tab: SearchTab) => {
      setSearchParams((prev: URLSearchParams) => {
        const next: URLSearchParams = new URLSearchParams(prev);
        next.set('tab', tab);
        // Reset page when switching tabs
        next.delete('page');
        return next;
      });
    },
    [setSearchParams],
  );

  const handleSearch = useCallback(() => {
    // Reset to page 1 and trigger refetch
    setSearchParams((prev: URLSearchParams) => {
      const next: URLSearchParams = new URLSearchParams(prev);
      next.delete('page');
      return next;
    });
    setSearchTrigger((prev: number) => prev + 1);
  }, [setSearchParams]);

  const handleClear = useCallback(() => {
    if (activeTab === 'filings') {
      setFilingFilters(emptyFilingFilters());
    } else if (activeTab === 'satellites') {
      setSatelliteFilters(emptySatelliteFilters());
    } else {
      setEarthStationFilters(emptyEarthStationFilters());
    }
    setSearchTrigger((prev: number) => prev + 1);
  }, [activeTab]);

  // Fetch functions for each tab
  const fetchFilings = useCallback(
    (params: DataTableFetchParams): Promise<PaginatedResponse<FilingSearchResult>> => {
      const qs: string = buildFilingQueryString(filingFilters, params);
      return apiFetch<PaginatedResponse<FilingSearchResult>>(`/api/search/filings?${qs}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filingFilters, searchTrigger],
  );

  const fetchSatellites = useCallback(
    (params: DataTableFetchParams): Promise<PaginatedResponse<SatelliteSearchResult>> => {
      const qs: string = buildSatelliteQueryString(satelliteFilters, params);
      return apiFetch<PaginatedResponse<SatelliteSearchResult>>(`/api/search/satellites?${qs}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [satelliteFilters, searchTrigger],
  );

  const fetchEarthStations = useCallback(
    (params: DataTableFetchParams): Promise<PaginatedResponse<EarthStationSearchResult>> => {
      const qs: string = buildEarthStationQueryString(earthStationFilters, params);
      return apiFetch<PaginatedResponse<EarthStationSearchResult>>(
        `/api/search/earth-stations?${qs}`,
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [earthStationFilters, searchTrigger],
  );

  // Row click handlers
  const onFilingClick = useCallback(
    (row: FilingSearchResult) => {
      void navigate(`/filings/${encodeURIComponent(row.file_number)}`);
    },
    [navigate],
  );

  const onSatelliteClick = useCallback(
    (row: SatelliteSearchResult) => {
      void navigate(`/satellites/${row.space_station_key}`);
    },
    [navigate],
  );

  const onEarthStationClick = useCallback(
    (row: EarthStationSearchResult) => {
      void navigate(`/earth-stations/${row.callsign}`);
    },
    [navigate],
  );

  // Memoize stable column refs
  const filingCols = useMemo(() => filingColumns, []);
  const satelliteCols = useMemo(() => satelliteColumns, []);
  const earthStationCols = useMemo(() => earthStationColumns, []);

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      {/* Page heading */}
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Search</h1>

      {/* Tab bar */}
      <div className="flex border-b border-neutral-200 dark:border-neutral-700">
        {TABS.map((tab) => (
          <button
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors',
              activeTab === tab.key
                ? 'border-b-2 border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100',
            )}
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Collapsible filter panel */}
      <div className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
        <button
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-neutral-700 dark:text-neutral-300"
          onClick={() => setFiltersOpen(!filtersOpen)}
          type="button"
        >
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            Filters
          </span>
          {filtersOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {filtersOpen && (
          <div className="space-y-4 border-t border-neutral-200 px-4 pt-3 pb-4 dark:border-neutral-700">
            {activeTab === 'filings' && (
              <FilingFilterForm filters={filingFilters} onChange={setFilingFilters} />
            )}
            {activeTab === 'satellites' && (
              <SatelliteFilterForm filters={satelliteFilters} onChange={setSatelliteFilters} />
            )}
            {activeTab === 'earth-stations' && (
              <EarthStationFilterForm
                filters={earthStationFilters}
                onChange={setEarthStationFilters}
              />
            )}
            <div className="flex gap-2">
              <Button onClick={handleSearch} size="sm">
                Search
              </Button>
              <Button onClick={handleClear} size="sm" variant="outline">
                Clear
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Results table */}
      {activeTab === 'filings' && (
        <DataTable<FilingSearchResult>
          columns={filingCols}
          defaultOrder="desc"
          defaultSort="date_filed"
          fetchData={fetchFilings}
          onRowClick={onFilingClick}
          paramPrefix="f_"
        />
      )}
      {activeTab === 'satellites' && (
        <DataTable<SatelliteSearchResult>
          columns={satelliteCols}
          defaultOrder="asc"
          defaultSort="us_name"
          fetchData={fetchSatellites}
          onRowClick={onSatelliteClick}
          paramPrefix="s_"
        />
      )}
      {activeTab === 'earth-stations' && (
        <DataTable<EarthStationSearchResult>
          columns={earthStationCols}
          defaultOrder="asc"
          defaultSort="callsign"
          fetchData={fetchEarthStations}
          onRowClick={onEarthStationClick}
          paramPrefix="e_"
        />
      )}
    </div>
  );
}
