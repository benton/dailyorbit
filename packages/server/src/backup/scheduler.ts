import { getLogger } from '../lib/logger.ts';
import type { BackupService } from './backup-service.ts';

export type BackupScheduler = {
  start: (intervalMinutes: number) => void;
  stop: () => void;
  isActive: () => boolean;
};

export function createBackupScheduler(service: BackupService): BackupScheduler {
  const log = getLogger();
  let timer: ReturnType<typeof setInterval> | null = null;

  function start(intervalMinutes: number): void {
    if (timer != null) {
      stop();
    }
    if (intervalMinutes <= 0) {
      log.info('[backup-scheduler] Interval is 0 — automatic backups disabled');
      return;
    }
    const ms: number = intervalMinutes * 60 * 1000;
    log.info(`[backup-scheduler] Starting with interval ${intervalMinutes}m`);
    timer = setInterval(() => {
      if (!service.isRunning()) {
        void service.runBackup('scheduled');
      }
    }, ms);
  }

  function stop(): void {
    if (timer != null) {
      clearInterval(timer);
      timer = null;
      log.info('[backup-scheduler] Stopped');
    }
  }

  function isActive(): boolean {
    return timer != null;
  }

  return { start, stop, isActive };
}
