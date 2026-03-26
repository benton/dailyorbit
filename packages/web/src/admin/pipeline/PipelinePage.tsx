import { PlayCircle, StopCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogLine } from './LogPanel.tsx';
import type { StageStatus } from './PipelineStep.tsx';
import { apiFetch } from '../../lib/api.ts';
import env from '../../lib/env.tsx';
import { Button } from '../../ui/button.tsx';
import LogPanel from './LogPanel.tsx';
import PipelineGroup from './PipelineGroup.tsx';
import SchedulerPanel from './SchedulerPanel.tsx';

// ── API response types ──────────────────────────────────────────────

type GroupInfo = {
  id: string;
  name: string;
  stageIds: Array<string>;
};

type StageInfo = {
  defaultConcurrency: number;
  description: string;
  group: string;
  id: string;
  name: string;
  parallelizable: boolean;
  resettable: boolean;
  status: StageStatus;
};

type StatusResponse = {
  currentStageId: string | null;
  groups: Array<GroupInfo>;
  runId: string | null;
  running: boolean;
  stages: Array<StageInfo>;
};

type RunResponse = {
  runId: string;
};

// ── Component ───────────────────────────────────────────────────────

export default function PipelinePage() {
  const [groups, setGroups] = useState<Array<GroupInfo>>([]);
  const [stages, setStages] = useState<Array<StageInfo>>([]);
  const [running, setRunning] = useState<boolean>(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<Array<LogLine>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [concurrencyOverrides, setConcurrencyOverrides] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // ── Fetch status ────────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const data: StatusResponse = await apiFetch<StatusResponse>('/api/admin/pipeline/status');
      setGroups(data.groups);
      setStages(data.stages);
      setRunning(data.running);
      if (data.running && data.runId != null) {
        setActiveRunId(data.runId);
      }
      // Initialize concurrency overrides from server defaults (only on first load)
      setConcurrencyOverrides((prev: Record<string, number>) => {
        if (Object.keys(prev).length > 0) {
          return prev;
        }
        const defaults: Record<string, number> = {};
        for (const s of data.stages) {
          defaults[s.id] = s.defaultConcurrency;
        }
        return defaults;
      });
      setError(null);
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Failed to load pipeline status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  // ── SSE connection ──────────────────────────────────────────────

  const connectSSE = useCallback(
    (runId: string) => {
      // Close any existing connection
      if (eventSourceRef.current != null) {
        eventSourceRef.current.close();
      }

      const baseUrl: string = env('SERVER_URL');
      const es = new EventSource(`${baseUrl}/api/admin/pipeline/logs/${runId}`, {
        withCredentials: true,
      });
      eventSourceRef.current = es;

      es.addEventListener('log', (event: MessageEvent) => {
        const line: LogLine = JSON.parse(event.data as string) as LogLine;
        setLogLines((prev: Array<LogLine>) => [...prev, line]);

        // Update stage status from log events
        setStages((prev: Array<StageInfo>) =>
          prev.map((s: StageInfo) => {
            if (s.id === line.stage && line.level !== 'progress') {
              return { ...s, status: 'running' as StageStatus };
            }
            return s;
          }),
        );
      });

      es.addEventListener('done', (_event: MessageEvent) => {
        es.close();
        eventSourceRef.current = null;
        setRunning(false);
        setActiveRunId(null);
        // Refresh status to get final stage states
        void fetchStatus();
      });

      es.addEventListener('error', () => {
        es.close();
        eventSourceRef.current = null;
      });
    },
    [fetchStatus],
  );

  // Auto-connect to active run on mount
  useEffect(() => {
    if (activeRunId != null && running) {
      connectSSE(activeRunId);
    }
    return () => {
      eventSourceRef.current?.close();
    };
  }, [activeRunId, running, connectSSE]);

  // ── Run handler ─────────────────────────────────────────────────

  const runStages = useCallback(
    async (stageIds: Array<string>) => {
      if (running) {
        return;
      }

      try {
        setRunning(true);
        // Optimistically set stages to running
        setStages((prev: Array<StageInfo>) =>
          prev.map((s: StageInfo) =>
            stageIds.includes(s.id) ? { ...s, status: 'idle' as StageStatus } : s,
          ),
        );

        // Build per-stage overrides for just the stages being run
        const overrides: Record<string, number> = {};
        for (const id of stageIds) {
          if (concurrencyOverrides[id] != null) {
            overrides[id] = concurrencyOverrides[id];
          }
        }

        const resp: RunResponse = await apiFetch<RunResponse>('/api/admin/pipeline/run', {
          body: JSON.stringify({ concurrencyOverrides: overrides, stages: stageIds }),
          method: 'POST',
        });

        setActiveRunId(resp.runId);
        connectSSE(resp.runId);
      } catch (error_: unknown) {
        setRunning(false);
        setError(error_ instanceof Error ? error_.message : 'Failed to start pipeline run');
      }
    },
    [running, connectSSE, concurrencyOverrides],
  );

  // ── Stop handler ──────────────────────────────────────────────

  const handleStop = useCallback(async () => {
    try {
      await apiFetch('/api/admin/pipeline/stop', { method: 'POST' });
    } catch {
      // best-effort
    }
  }, []);

  const handleRunStage = useCallback(
    (stageId: string) => {
      void runStages([stageId]);
    },
    [runStages],
  );

  const handleRunAll = useCallback(
    (stageIds: Array<string>) => {
      void runStages(stageIds);
    },
    [runStages],
  );

  const handleConcurrencyChange = useCallback((stageId: string, value: number) => {
    setConcurrencyOverrides((prev: Record<string, number>) => ({
      ...prev,
      [stageId]: Math.max(1, value),
    }));
  }, []);

  const handleReset = useCallback(async (stageId: string) => {
    try {
      const resp = await apiFetch<{ reset: number; stageId: string }>(
        `/api/admin/pipeline/reset-matches/${stageId}`,
        { method: 'POST' },
      );
      setLogLines((prev: Array<LogLine>) => [
        ...prev,
        {
          level: 'info' as const,
          message: `Reset ${String(resp.reset)} failed match attempts — next run will retry them`,
          runId: 'reset',
          stage: stageId,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Reset failed');
    }
  }, []);

  const handleClearLog = useCallback(() => {
    setLogLines([]);
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return <p className="text-sm text-on-surface-muted">Loading pipeline status...</p>;
  }

  if (error != null && groups.length === 0) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-on-surface">Pipeline</h1>
          <p className="mt-1 text-sm text-on-surface-muted">
            Data ingestion pipeline stages. Run steps individually or by group.
          </p>
          {error != null && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex items-center gap-2">
          {!running && (
            <Button
              disabled={stages.length === 0}
              onClick={() => void runStages(stages.map((s: StageInfo) => s.id))}
              size="sm"
              title="Run all pipeline stages in order"
              type="button"
              variant="default"
            >
              <PlayCircle className="mr-1.5 h-4 w-4" />
              Run All
            </Button>
          )}
          {running && (
            <Button
              onClick={() => void handleStop()}
              size="sm"
              title="Stop all pipeline stages"
              type="button"
              variant="destructive"
            >
              <StopCircle className="mr-1.5 h-4 w-4" />
              Stop All
            </Button>
          )}
        </div>
      </div>

      {/* Scheduler control panel */}
      <SchedulerPanel />

      {/* Pipeline stages */}
      <div className="space-y-1">
        {groups.map((group: GroupInfo, i: number) => {
          const groupStages = stages
            .filter((s: StageInfo) => group.stageIds.includes(s.id))
            .map((s: StageInfo) => ({
              concurrency: concurrencyOverrides[s.id] ?? s.defaultConcurrency,
              description: s.description,
              id: s.id,
              name: s.name,
              parallelizable: s.parallelizable,
              resettable: s.resettable,
              status: s.status,
            }));

          return (
            <PipelineGroup
              disabled={running}
              isLast={i === groups.length - 1}
              key={group.id}
              name={group.name}
              onConcurrencyChange={handleConcurrencyChange}
              onReset={(stageId: string) => void handleReset(stageId)}
              onRunAll={handleRunAll}
              onRunStage={handleRunStage}
              stages={groupStages}
            />
          );
        })}
      </div>

      {/* Log panel */}
      <div className="mt-6">
        <LogPanel lines={logLines} onClear={handleClearLog} />
      </div>
    </>
  );
}
