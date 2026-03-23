import { Clock, Pause, Play, RefreshCw, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api.ts';
import { Button } from '../../ui/button.tsx';

// ── Types ───────────────────────────────────────────────────────────

type SchedulerStatus = {
  lastProbeAt: string | null;
  lastProbeResult: {
    stagesCompleted: number;
    stagesFailed: number;
    totalDurationMs: number;
  } | null;
  lastRefreshAt: string | null;
  lastRefreshResult: {
    stagesCompleted: number;
    stagesFailed: number;
    totalDurationMs: number;
  } | null;
  nextProbeAt: string | null;
  nextRefreshAt: string | null;
  probeIntervalMs: number;
  refreshInProgress: boolean;
  refreshIntervalMs: number;
  running: boolean;
};

// ── Helpers ──────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }
  const seconds: number = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes: number = Math.round(seconds / 60);
  return `${String(minutes)}m`;
}

function formatTime(iso: string | null): string {
  if (iso == null) {
    return '—';
  }
  const d = new Date(iso);
  return d.toLocaleTimeString();
}

function formatInterval(ms: number): string {
  const seconds: number = ms / 1000;
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes: number = seconds / 60;
  return `${String(minutes)} min`;
}

// ── Component ───────────────────────────────────────────────────────

export default function SchedulerPanel() {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [probeInterval, setProbeInterval] = useState<number>(60);
  const [refreshInterval, setRefreshInterval] = useState<number>(15);
  const [autoStart, setAutoStart] = useState<boolean>(false);

  const fetchSchedulerStatus = useCallback(async () => {
    try {
      const data: SchedulerStatus = await apiFetch<SchedulerStatus>(
        '/api/admin/pipeline/scheduler',
      );
      setStatus(data);
      setProbeInterval(data.probeIntervalMs / 1000);
      setRefreshInterval(data.refreshIntervalMs / 60_000);
    } catch {
      // Scheduler endpoint may not exist yet
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch auto-start config
  useEffect(() => {
    void (async () => {
      try {
        const entries = await apiFetch<Array<{ key: string; value: string }>>('/api/admin/config');
        const entry = entries.find((e) => e.key === 'schedulerAutoStart');
        if (entry != null) {
          setAutoStart(entry.value === 'true');
        }
      } catch {
        // best-effort
      }
    })();
  }, []);

  useEffect(() => {
    void fetchSchedulerStatus();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void fetchSchedulerStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [fetchSchedulerStatus]);

  const handleStart = useCallback(async () => {
    try {
      const data: SchedulerStatus = await apiFetch<SchedulerStatus>(
        '/api/admin/pipeline/scheduler/start',
        {
          body: JSON.stringify({
            probeIntervalMs: probeInterval * 1000,
            refreshIntervalMs: refreshInterval * 60_000,
          }),
          method: 'POST',
        },
      );
      setStatus(data);
    } catch {
      // best-effort
    }
  }, [probeInterval, refreshInterval]);

  const handleStop = useCallback(async () => {
    try {
      const data: SchedulerStatus = await apiFetch<SchedulerStatus>(
        '/api/admin/pipeline/scheduler/stop',
        { method: 'POST' },
      );
      setStatus(data);
    } catch {
      // best-effort
    }
  }, []);

  const handleAutoStartToggle = useCallback(async (checked: boolean) => {
    setAutoStart(checked);
    try {
      await apiFetch('/api/admin/config/schedulerAutoStart', {
        body: JSON.stringify({ value: checked ? 'true' : 'false' }),
        method: 'PUT',
      });
    } catch {
      setAutoStart(!checked); // revert on failure
    }
  }, []);

  if (loading) {
    return null;
  }
  if (status == null) {
    return null;
  }

  const isRunning: boolean = status.running;

  return (
    <div className="mb-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Pipeline Scheduler
          </h2>
          {isRunning ? (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
              Active
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              Stopped
            </span>
          )}
          {status.refreshInProgress && (
            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
              Refreshing
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!isRunning ? (
            <Button
              onClick={() => void handleStart()}
              size="sm"
              title="Start scheduler"
              type="button"
              variant="default"
            >
              <Play className="mr-1 h-3.5 w-3.5" />
              Start
            </Button>
          ) : (
            <Button
              onClick={() => void handleStop()}
              size="sm"
              title="Stop scheduler"
              type="button"
              variant="outline"
            >
              <Pause className="mr-1 h-3.5 w-3.5" />
              Stop
            </Button>
          )}
        </div>
      </div>

      {/* Interval config */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-neutral-600 dark:text-neutral-400">
        <label className="flex items-center gap-1.5">
          <input
            checked={autoStart}
            className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600"
            onChange={(e) => void handleAutoStartToggle(e.target.checked)}
            type="checkbox"
          />
          Start on boot
        </label>
        <label className="flex items-center gap-1.5">
          <Zap className="h-3 w-3" />
          Probe every
          <input
            className="w-14 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
            disabled={isRunning}
            min={5}
            onChange={(e) => setProbeInterval(Number(e.target.value))}
            type="number"
            value={probeInterval}
          />
          sec
        </label>
        <label className="flex items-center gap-1.5">
          <RefreshCw className="h-3 w-3" />
          Full refresh every
          <input
            className="w-14 rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200"
            disabled={isRunning}
            min={1}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            type="number"
            value={refreshInterval}
          />
          min
        </label>
      </div>

      {/* Status summary */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <Zap className="h-3 w-3" />
            Last Probe
          </div>
          <div className="mt-1 text-neutral-900 dark:text-neutral-100">
            {formatTime(status.lastProbeAt)}
            {status.lastProbeResult != null && (
              <span className="ml-1 text-neutral-400">
                ({formatMs(status.lastProbeResult.totalDurationMs)},{' '}
                {String(status.lastProbeResult.stagesCompleted)} stages)
              </span>
            )}
          </div>
          {status.nextProbeAt != null && (
            <div className="mt-0.5 text-neutral-400">Next: {formatTime(status.nextProbeAt)}</div>
          )}
        </div>

        <div className="rounded border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-800">
          <div className="flex items-center gap-1 text-neutral-500 dark:text-neutral-400">
            <RefreshCw className="h-3 w-3" />
            Last Refresh
          </div>
          <div className="mt-1 text-neutral-900 dark:text-neutral-100">
            {formatTime(status.lastRefreshAt)}
            {status.lastRefreshResult != null && (
              <span className="ml-1 text-neutral-400">
                ({formatMs(status.lastRefreshResult.totalDurationMs)},{' '}
                {String(status.lastRefreshResult.stagesCompleted)} stages)
              </span>
            )}
          </div>
          {status.nextRefreshAt != null && (
            <div className="mt-0.5 text-neutral-400">Next: {formatTime(status.nextRefreshAt)}</div>
          )}
        </div>
      </div>

      {/* Intervals display when running */}
      {isRunning && (
        <div className="mt-2 text-xs text-neutral-400">
          Probe: {formatInterval(status.probeIntervalMs)} · Refresh:{' '}
          {formatInterval(status.refreshIntervalMs)}
        </div>
      )}
    </div>
  );
}
