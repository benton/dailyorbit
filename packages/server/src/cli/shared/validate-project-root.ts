import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sentinel files/dirs that MUST exist in the project root.
 * If cwd is wrong (e.g. packages/server/), these won't be found.
 *
 * Only includes paths that exist in BOTH the dev monorepo and the
 * production Docker image (which strips build-only files like
 * pnpm-workspace.yaml and packages/web/package.json).
 */
const SENTINELS: string[] = ['daily-orbit', 'packages/server/package.json'];

/**
 * Validate that the current working directory is the project root.
 *
 * The application uses relative paths (e.g. `data/daily-orbit.duckdb`)
 * that resolve against cwd. If the server is accidentally launched from
 * a subdirectory (e.g. `packages/server/`), it will silently create or
 * open the wrong database file — a catastrophic data-integrity bug.
 *
 * @throws Error if cwd does not look like the project root.
 */
export function validateProjectRoot(): void {
  const cwd: string = process.cwd();
  const missing: string[] = SENTINELS.filter(
    (s) => !existsSync(resolve(cwd, s)),
  );
  if (missing.length > 0) {
    throw new Error(
      `Working directory "${cwd}" is not the project root.\n` +
        `Missing: ${missing.join(', ')}\n` +
        `The server must be started from the monorepo root so that ` +
        `relative paths (data/, .env, etc.) resolve correctly.\n` +
        `Use ./daily-orbit serve api or ensure cwd is the project root.`,
    );
  }
}
