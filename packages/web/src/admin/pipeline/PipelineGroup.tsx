import { ChevronDown, ChevronRight, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import type { StageStatus } from './PipelineStep.tsx';
import { Button } from '../../ui/button.tsx';
import PipelineStep from './PipelineStep.tsx';

type StageInfo = {
  concurrency: number;
  description: string;
  id: string;
  name: string;
  parallelizable: boolean;
  resettable: boolean;
  status: StageStatus;
};

type PipelineGroupProps = {
  disabled: boolean;
  isLast: boolean;
  name: string;
  onConcurrencyChange: (stageId: string, value: number) => void;
  onReset: (stageId: string) => void;
  onRunAll: (stageIds: Array<string>) => void;
  onRunStage: (stageId: string) => void;
  stages: Array<StageInfo>;
};

export default function PipelineGroup({
  disabled,
  isLast,
  name,
  onConcurrencyChange,
  onReset,
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
          className="flex items-center gap-1.5 rounded-theme px-2 py-1 text-sm font-semibold text-on-surface hover:bg-on-surface/10 dark:text-on-surface dark:hover:bg-on-surface/10"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-on-surface-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-on-surface-muted" />
          )}
          {name}
          <span className="ml-1 text-xs font-normal text-on-surface-muted">
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
        <div className="mt-1 ml-3 space-y-1 border-l-2 border-border-theme pl-4 dark:border-border-theme">
          {stages.map((stage: StageInfo) => (
            <PipelineStep
              concurrency={stage.concurrency}
              description={stage.description}
              disabled={disabled}
              id={stage.id}
              key={stage.id}
              name={stage.name}
              onConcurrencyChange={onConcurrencyChange}
              onReset={onReset}
              onRun={onRunStage}
              parallelizable={stage.parallelizable}
              resettable={stage.resettable}
              status={stage.status}
            />
          ))}
        </div>
      )}

      {/* Flow connector to next group */}
      {!isLast && (
        <div className="ml-5 flex h-4 justify-center">
          <div className="w-0.5 bg-border-theme" />
        </div>
      )}
    </div>
  );
}
