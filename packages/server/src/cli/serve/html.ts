import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';
import { getLogger } from '../../lib/logger.ts';

export const serveHtmlCommand = defineCommand({
  meta: {
    name: 'html',
    description: 'Start the Vite frontend dev server',
  },
  args: {
    port: {
      alias: 'p',
      default: '5173',
      description: 'Port for the Vite dev server',
      type: 'string',
    },
  },
  run({ args }) {
    const webDir: string = resolve(process.cwd(), 'packages/web');
    const vite: string = resolve(webDir, 'node_modules/.bin/vite');
    const port: string = args.port;

    getLogger().info(`Starting Vite dev server on http://localhost:${port}`);

    execFileSync(vite, ['dev', '--port', port], {
      cwd: webDir,
      stdio: 'inherit',
    });
  },
});
