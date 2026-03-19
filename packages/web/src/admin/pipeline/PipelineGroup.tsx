import { ChevronDown, ChevronRight, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import type { StageStatus } from './PipelineStep.tsx';
import { Button } from '../../ui/button.tsx';
import PipelineStep from './PipelineStep.tsx';

type StageInfo = {
  description: string;
  id: string;
  name: string;
  status: StageStatus;
};

type PipelineGroupProps = {
  disabled: boolean;
  isLast: boolean;
  name: string;
  onRunAll: (stageIds: Array<string>) => void;
  onRunStage: (stageId: string) => void;
  stages: Array<StageInfo>;
};

export default function PipelineGroup({
  disabled,
  isLast,
  name,
  onRunAll,
  onRunStage,
  stages,
}: PipelineGroupProps) {
  const [expanded, setExpanded] = useState<boolean>(true);

  const stageIds: Array<string> = stages.map((s: StageInfo) => s.id);

  return (
    <div className="relative">
      {/* Group header */}
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-neutral-900 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-neutral-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-neutral-400" />
          )}
          {name}
          <span className="ml-1 text-xs font-normal text-neutral-400">
            ({String(stages.length)} steps)
          </span>
        </button>

        <Button
          disabled={disabled}
          onClick={() => onRunAll(stageIds)}
          size="sm"
          title={`Run all ${name} steps`}
          type="button"
          variant="ghost"
        >
          <PlayCircle className="mr-1 h-3.5 w-3.5" />
          Run All
        </Button>
      </div>

      {/* Stages */}
      {expanded && (
        <div className="mt-1 ml-3 space-y-1 border-l-2 border-neutral-200 pl-4 dark:border-neutral-700">
          {stages.map((stage: StageInfo) => (
            <PipelineStep
              description={stage.description}
              disabled={disabled}
              id={stage.id}
              key={stage.id}
              name={stage.name}
              onRun={onRunStage}
              status={stage.status}
            />
          ))}
        </div>
      )}

      {/* Flow connector to next group */}
      {!isLast && (
        <div className="ml-5 flex h-4 justify-center">
          <div className="w-0.5 bg-neutral-300 dark:bg-neutral-600" />
        </div>
      )}
    </div>
  );
}
