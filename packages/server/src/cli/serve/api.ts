import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineCommand } from 'citty';
import { resolveFromRoot } from '../shared/context.ts';

const DEFAULT_DATABASE: string = 'data/daily-orbit.duckdb';
const DEFAULT_KEY_FILE: string = 'data/daily-orbit.key';

export const serveApiCommand = defineCommand({
  meta: {
    name: 'api',
    description: 'Start the backend API server',
  },
  args: {
    database: {
      type: 'positional',
      description: 'Path to DuckDB database file',
      default: DEFAULT_DATABASE,
      required: false,
    },
    keyFile: {
      type: 'positional',
      description: 'Path to database encryption key file',
      default: DEFAULT_KEY_FILE,
      required: false,
    },
    port: {
      type: 'string',
      alias: 'p',
      description: 'Port to listen on',
      default: '9000',
    },
  },
  async run({ args }) {
    const dbPath: string = resolveFromRoot(args.database);
    const keyPath: string = resolveFromRoot(args.keyFile);
    const port: number = Number(args.port);

    const dbExists: boolean = existsSync(dbPath);
    const keyExists: boolean = existsSync(keyPath);

    if (dbExists && !keyExists) {
      console.error(
        `Error: database exists at ${dbPath} but key file is missing at ${keyPath}\n` +
          'Both files must be present, or neither (for fresh initialization).',
      );
      process.exit(1);
    }

    if (!dbExists && keyExists) {
      console.error(
        `Error: key file exists at ${keyPath} but database is missing at ${dbPath}\n` +
          'Both files must be present, or neither (for fresh initialization).',
      );
      process.exit(1);
    }

    const { setDbPath, getDb } = await import('../../lib/db.ts');
    setDbPath(dbPath);

    let encryptionKey: Buffer;

    if (!dbExists && !keyExists) {
      console.warn(
        'Warning: neither database nor key file found — initializing clean system.',
      );

      const { mkdirSync } = await import('node:fs');
      mkdirSync(dirname(dbPath), { recursive: true });
      mkdirSync(dirname(keyPath), { recursive: true });

      const { generateKeyFile } = await import('../../lib/encryption.ts');
      encryptionKey = generateKeyFile(keyPath);
      console.log(`  Generated encryption key: ${keyPath}`);

      const db = await getDb();
      const { initializeDatabase } = await import('../../lib/db-init.ts');
      await initializeDatabase(db);
      console.log(`  Initialized database:     ${dbPath}`);

      const { ConfigService } = await import('../../lib/config-service.ts');
      const config = new ConfigService(db, encryptionKey);
      await config.seedDefaults();
      console.log('  Seeded default config');
    } else {
      const { readKeyFile } = await import('../../lib/encryption.ts');
      encryptionKey = readKeyFile(keyPath);
      const db = await getDb();
      // Ensure schema is up to date for existing databases
      const { initializeDatabase } = await import('../../lib/db-init.ts');
      await initializeDatabase(db);
      console.log(`Database: ${dbPath}`);
    }

    // Initialize config service
    const { ConfigService } = await import('../../lib/config-service.ts');
    const db = await getDb();
    const config = new ConfigService(db, encryptionKey);
    await config.load();

    const { setConfigService } = await import('../../lib/config.ts');
    setConfigService(config);

    const { initializeAuth } = await import('../../lib/auth.ts');
    initializeAuth(config);

    const { serve } = await import('@hono/node-server');
    const { default: app } = await import('../../app.ts');
    serve({ fetch: app.fetch, port }, () => {
      console.log(`Server running at http://localhost:${String(port)}`);
    });
  },
});
