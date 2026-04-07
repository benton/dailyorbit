import { Play, Loader2, CheckCircle2, XCircle, Circle, RotateCcw } from 'lucide-react';
import { Badge } from '../../ui/badge.tsx';
import { Button } from '../../ui/button.tsx';

export type StageStatus = 'idle' | 'running' | 'success' | 'failed';

type PipelineStepProps = {
  concurrency: number;
  description: string;
  disabled: boolean;
  id: string;
  name: string;
  onConcurrencyChange: (stageId: string, value: number) => void;
  onReset?: (stageId: string) => void;
  onRun: (stageId: string) => void;
  parallelizable: boolean;
  resettable: boolean;
  status: StageStatus;
};

const STATUS_CONFIG: Record<
  StageStatus,
  {
    icon: React.ReactNode;
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
  }
> = {
  failed: {
    icon: <XCircle className="h-3.5 w-3.5 text-red-500" />,
    label: 'Failed',
    variant: 'destructive',
  },
  idle: {
    icon: <Circle className="h-3.5 w-3.5 text-on-surface-muted" />,
    label: 'Idle',
    variant: 'outline',
  },
  running: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
    label: 'Running',
    variant: 'secondary',
  },
  success: {
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />,
    label: 'Success',
    variant: 'default',
  },
};

export default function PipelineStep({
  concurrency,
  description,
  disabled,
  id,
  name,
  onConcurrencyChange,
  onReset,
  onRun,
  parallelizable,
  resettable,
  status,
}: PipelineStepProps) {
  const cfg = STATUS_CONFIG[status];

  return (
    <div className="flex items-center gap-3 rounded-theme border border-border-theme bg-surface-card px-3 py-2">
      {/* Status icon */}
      <div className="shrink-0">{cfg.icon}</div>

      {/* Name + description */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-on-surface">{name}</p>
        <p className="truncate text-xs text-on-surface-muted">{description}</p>
      </div>

      {/* Status badge */}
      <Badge className="shrink-0" variant={cfg.variant}>
        {cfg.label}
      </Badge>

      {/* Reset failed matches button (visible when not running) */}
      {resettable && status !== 'running' && onReset != null && (
        <Button
          disabled={disabled}
          onClick={() => onReset(id)}
          size="sm"
          title="Clear previously-failed match attempts so next run retries them"
          type="button"
          variant="ghost"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          Reset failed
        </Button>
      )}

      {/* Per-stage concurrency input (only for parallelizable stages) */}
      {parallelizable && (
        <input
          aria-label={`Concurrency for ${name}`}
          className="w-14 rounded-theme border border-border-theme bg-surface-card px-1.5 py-1 text-center text-xs"
          disabled={disabled}
          max={100}
          min={1}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onConcurrencyChange(id, Number.parseInt(e.target.value, 10) || 1)
          }
          title={`Concurrency for ${name}`}
          type="number"
          value={concurrency}
        />
      )}

      {/* Run button */}
      <Button
        disabled={disabled}
        onClick={() => onRun(id)}
        size="sm"
        title={`Run ${name}`}
        type="button"
        variant="outline"
      >
        <Play className="mr-1 h-3 w-3" />
        Run
      </Button>
    </div>
  );
}
