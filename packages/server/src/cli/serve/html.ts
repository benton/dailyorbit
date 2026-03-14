import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { defineCommand } from 'citty';

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
    const webDir: string = resolve(import.meta.dirname, '../../../web');
    const port: string = args.port;

    console.log(`Starting Vite dev server on http://localhost:${port}`);

    const child = spawn('pnpm', ['dev', '--port', port], {
      cwd: webDir,
      stdio: 'inherit',
    });

    child.on('error', (error: Error) => {
      console.error(`Failed to start Vite: ${error.message}`);
      process.exit(1);
    });

    child.on('exit', (code: number | null) => {
      process.exit(code ?? 0);
    });
  },
});
