import { defineCommand } from 'citty';
import { CONFIG_SCHEMA, type ConfigKey } from '../../lib/config-schema.ts';
import { getLogger } from '../../lib/logger.ts';
import { ConfigService } from '../../lib/config-service.ts';
import { readKeyFile } from '../../lib/encryption.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

/**
 * Config overrides to apply when localizing a production database.
 * - string values are set directly
 * - null means unset (delete row, revert to schema default)
 */
const LOCAL_OVERRIDES: Record<string, string | null> = {
  appBaseUrl: 'http://localhost:5173',
  betterAuthUrl: 'http://localhost:9000',
  clientDomain: 'http://localhost:5173',
  tlsCert: null,
  tlsKey: null,
  snapshotBucket: null,
  schedulerAutoStart: 'false',
};

export const localizeCommand = defineCommand({
  meta: {
    name: 'localize',
    description: 'Reconfigure a production DB copy for local development',
  },
  args: {
    database: databaseArg,
    keyFile: {
      type: 'string',
      description: 'Path to encryption key file',
      default: 'data/daily-orbit.key',
    },
  },
  async run({ args }) {
    const log = getLogger();
    const { resolveFromRoot } = await import('../shared/context.ts');
    const db = await createDb(args.database);
    const key: Buffer = readKeyFile(resolveFromRoot(args.keyFile));
    const config: ConfigService = new ConfigService(db, key);
    await config.load();

    for (const [k, v] of Object.entries(LOCAL_OVERRIDES)) {
      const configKey: ConfigKey = k as ConfigKey;
      if (CONFIG_SCHEMA[configKey] == null) {
        log.warn(`Skipping unknown config key: ${k}`);
        continue;
      }
      if (v === null) {
        await config.unset(configKey);
        log.info(
          `Unset ${k} → default: ${CONFIG_SCHEMA[configKey].defaultValue || '(empty)'}`,
        );
      } else {
        await config.set(configKey, v);
        log.info(`Set ${k} = ${v}`);
      }
    }

    log.info('Database localized for development');
  },
});
