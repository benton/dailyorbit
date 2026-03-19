import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogLine } from './LogPanel.tsx';
import type { StageStatus } from './PipelineStep.tsx';
import { apiFetch } from '../../lib/api.ts';
import env from '../../lib/env.tsx';
import LogPanel from './LogPanel.tsx';
import PipelineGroup from './PipelineGroup.tsx';

// ── API response types ──────────────────────────────────────────────

type GroupInfo = {
  id: string;
  name: string;
  stageIds: Array<string>;
};

type StageInfo = {
  description: string;
  group: string;
  id: string;
  name: string;
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

        const resp: RunResponse = await apiFetch<RunResponse>('/api/admin/pipeline/run', {
          body: JSON.stringify({ stages: stageIds }),
          method: 'POST',
        });

        setActiveRunId(resp.runId);
        connectSSE(resp.runId);
      } catch (error_: unknown) {
        setRunning(false);
        setError(error_ instanceof Error ? error_.message : 'Failed to start pipeline run');
      }
    },
    [running, connectSSE],
  );

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

  const handleClearLog = useCallback(() => {
    setLogLines([]);
  }, []);

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading pipeline status...</p>;
  }

  if (error != null && groups.length === 0) {
    return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Pipeline</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Data ingestion pipeline stages. Run steps individually or by group.
        </p>
        {error != null && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {/* Pipeline stages */}
      <div className="space-y-1">
        {groups.map((group: GroupInfo, i: number) => {
          const groupStages = stages
            .filter((s: StageInfo) => group.stageIds.includes(s.id))
            .map((s: StageInfo) => ({
              description: s.description,
              id: s.id,
              name: s.name,
              status: s.status,
            }));

          return (
            <PipelineGroup
              disabled={running}
              isLast={i === groups.length - 1}
              key={group.id}
              name={group.name}
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
