/**
 * PipelineScheduler — manages two recurring timers for probe and full refresh runs.
 *
 * - Probe timer: fires every probeIntervalMs, runs pipeline in 'probe' mode
 * - Refresh timer: fires every refreshIntervalMs, runs pipeline in 'full' mode
 * - If a run is already in progress, the tick is skipped
 * - The probe timer pauses while a full refresh is running
 */

import { getAllStages } from './registry.ts';
import { getRunner } from './runner.ts';
import type { RunSummary } from './runner.ts';

export type SchedulerConfig = {
  probeIntervalMs: number; // default: 60_000
  refreshIntervalMs: number; // default: 900_000 (15 min)
};

export type SchedulerStatus = {
  running: boolean;
  probeIntervalMs: number;
  refreshIntervalMs: number;
  lastProbeAt: string | null;
  lastProbeResult: RunSummary | null;
  lastRefreshAt: string | null;
  lastRefreshResult: RunSummary | null;
  nextProbeAt: string | null;
  nextRefreshAt: string | null;
  refreshInProgress: boolean;
};

const DEFAULT_CONFIG: SchedulerConfig = {
  probeIntervalMs: 60_000,
  refreshIntervalMs: 900_000,
};

export class PipelineScheduler {
  private config: SchedulerConfig;
  private probeTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _running: boolean = false;
  private refreshInProgress: boolean = false;
  private startedAt: number = 0;

  private lastProbeAt: string | null = null;
  private lastProbeResult: RunSummary | null = null;
  private lastRefreshAt: string | null = null;
  private lastRefreshResult: RunSummary | null = null;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start both probe and refresh timers. */
  start(): void {
    if (this._running) return;
    this._running = true;
    this.startedAt = Date.now();

    this.probeTimer = setInterval(() => {
      void this.runProbe();
    }, this.config.probeIntervalMs);

    this.refreshTimer = setInterval(() => {
      void this.runRefresh();
    }, this.config.refreshIntervalMs);
  }

  /** Stop both timers. Does not cancel an in-flight run. */
  stop(): void {
    if (!this._running) return;
    this._running = false;
    if (this.probeTimer != null) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    if (this.refreshTimer != null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Current scheduler status. */
  status(): SchedulerStatus {
    const now: number = Date.now();
    return {
      running: this._running,
      probeIntervalMs: this.config.probeIntervalMs,
      refreshIntervalMs: this.config.refreshIntervalMs,
      lastProbeAt: this.lastProbeAt,
      lastProbeResult: this.lastProbeResult,
      lastRefreshAt: this.lastRefreshAt,
      lastRefreshResult: this.lastRefreshResult,
      nextProbeAt:
        this._running && !this.refreshInProgress
          ? new Date(
              now +
                this.config.probeIntervalMs -
                ((now - this.startedAt) % this.config.probeIntervalMs),
            ).toISOString()
          : null,
      nextRefreshAt: this._running
        ? new Date(
            now +
              this.config.refreshIntervalMs -
              ((now - this.startedAt) % this.config.refreshIntervalMs),
          ).toISOString()
        : null,
      refreshInProgress: this.refreshInProgress,
    };
  }

  /** Run a probe (fast check). Skips if any run is in progress. */
  async runProbe(): Promise<RunSummary | null> {
    const runner = getRunner();
    if (runner.isRunning() || this.refreshInProgress) return null;

    const stageIds: string[] = getAllStages().map((s) => s.id);
    try {
      const runId: string = await runner.start(
        stageIds,
        {},
        'scheduler-probe',
        'probe',
      );
      const summary: RunSummary = await this.waitForDone(runId);
      this.lastProbeAt = new Date().toISOString();
      this.lastProbeResult = summary;
      return summary;
    } catch {
      return null;
    }
  }

  /** Run a full refresh. Skips if any run is in progress. */
  async runRefresh(): Promise<RunSummary | null> {
    const runner = getRunner();
    if (runner.isRunning()) return null;

    this.refreshInProgress = true;
    const stageIds: string[] = getAllStages().map((s) => s.id);
    try {
      const runId: string = await runner.start(
        stageIds,
        {},
        'scheduler-refresh',
        'full',
      );
      const summary: RunSummary = await this.waitForDone(runId);
      this.lastRefreshAt = new Date().toISOString();
      this.lastRefreshResult = summary;
      return summary;
    } catch {
      return null;
    } finally {
      this.refreshInProgress = false;
    }
  }

  private waitForDone(runId: string): Promise<RunSummary> {
    const runner = getRunner();
    return new Promise<RunSummary>((resolve) => {
      const handler = (summary: RunSummary): void => {
        if (summary.runId === runId) {
          runner.emitter.removeListener('done', handler);
          resolve(summary);
        }
      };
      runner.emitter.on('done', handler);
    });
  }
}

// ── Singleton ──────────────────────────────────────────────────────

let _scheduler: PipelineScheduler | null = null;

export function getScheduler(
  config?: Partial<SchedulerConfig>,
): PipelineScheduler {
  if (_scheduler == null) {
    _scheduler = new PipelineScheduler(config);
  }
  return _scheduler;
}

/** Reset the singleton — test-only. */
export function resetScheduler(): void {
  if (_scheduler != null) {
    _scheduler.stop();
  }
  _scheduler = null;
}
