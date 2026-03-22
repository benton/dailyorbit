import { ChevronDown } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Consultant } from './types.ts';

type Props = {
  compact?: boolean;
  consultants: Array<Consultant>;
  onSelect: (consultant: Consultant) => void;
  selected: Consultant | null;
};

export default function ConsultantSelector({
  compact = false,
  consultants,
  onSelect,
  selected,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState<boolean>(false);

  const handleSelect = useCallback(
    (consultant: Consultant) => {
      onSelect(consultant);
      setDropdownOpen(false);
    },
    [onSelect],
  );

  // Full grid mode — for new conversation start
  if (!compact) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {consultants.map((c: Consultant) => (
          <button
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              selected?.id === c.id
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600'
            }`}
            key={c.id}
            onClick={() => handleSelect(c)}
            type="button"
          >
            <div className="mb-1 flex items-center gap-2">
              {c.icon != null && <span className="text-lg">{c.icon}</span>}
              <span className="font-medium text-neutral-800 dark:text-neutral-200">{c.name}</span>
            </div>
            {c.description != null && <p className="text-sm text-neutral-500">{c.description}</p>}
          </button>
        ))}
      </div>
    );
  }

  // Compact chip mode — during conversation
  return (
    <div className="relative">
      <button
        className="flex items-center gap-1.5 rounded-full border border-neutral-200 px-3 py-1 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        onClick={() => setDropdownOpen(!dropdownOpen)}
        type="button"
      >
        {selected?.icon != null && <span>{selected.icon}</span>}
        <span className="text-neutral-700 dark:text-neutral-300">
          {selected?.name ?? 'Select consultant'}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-neutral-400" />
      </button>

      {dropdownOpen && (
        <div className="absolute bottom-full left-0 z-10 mb-1 w-64 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
          {consultants.map((c: Consultant) => (
            <button
              className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 ${
                selected?.id === c.id ? 'bg-neutral-100 dark:bg-neutral-700' : ''
              }`}
              key={c.id}
              onClick={() => handleSelect(c)}
              type="button"
            >
              {c.icon != null && <span>{c.icon}</span>}
              <div>
                <div className="font-medium text-neutral-800 dark:text-neutral-200">{c.name}</div>
                {c.description != null && (
                  <div className="text-xs text-neutral-500">{c.description}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
