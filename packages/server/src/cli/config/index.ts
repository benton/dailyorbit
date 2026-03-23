import { defineCommand } from 'citty';
import { CONFIG_SCHEMA, type ConfigKey } from '../../lib/config-schema.ts';
import { getLogger } from '../../lib/logger.ts';
import { ConfigService } from '../../lib/config-service.ts';
import { SecretValue, readKeyFile } from '../../lib/encryption.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

const keyFileArg = {
  type: 'string',
  description: 'Path to encryption key file',
  default: 'data/daily-orbit.key',
} as const;

async function createConfigService(
  database: string,
  keyFile: string,
): Promise<ConfigService> {
  const { resolveFromRoot } = await import('../shared/context.ts');
  const db = await createDb(database);
  const key: Buffer = readKeyFile(resolveFromRoot(keyFile));
  const service: ConfigService = new ConfigService(db, key);
  await service.load();
  return service;
}

const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'List all config keys and values',
  },
  args: {
    database: databaseArg,
    keyFile: keyFileArg,
  },
  async run({ args }) {
    const config = await createConfigService(args.database, args.keyFile);
    const rows: Array<Record<string, string>> = [];
    for (const [key, def] of Object.entries(CONFIG_SCHEMA)) {
      const raw = config.get(key as ConfigKey);
      const display: string =
        raw instanceof SecretValue ? '[ENCRYPTED]' : (raw as string);
      rows.push({
        key,
        value: display,
        default: def.defaultValue || '(generated)',
        encrypted: def.encrypted ? 'yes' : 'no',
        description: def.description,
      });
    }
    console.table(rows);
  },
});

const getCommand = defineCommand({
  meta: {
    name: 'get',
    description: 'Get a single config value',
  },
  args: {
    database: databaseArg,
    keyFile: keyFileArg,
    key: {
      type: 'positional',
      description: 'Config key name',
      required: true,
    },
  },
  async run({ args }) {
    const config = await createConfigService(args.database, args.keyFile);
    const schema = CONFIG_SCHEMA[args.key as ConfigKey];
    if (schema == null) {
      getLogger().error(`Unknown config key: ${args.key}`);
      process.exit(1);
    }
    const raw = config.get(args.key as ConfigKey);
    const display: string =
      raw instanceof SecretValue ? raw.unwrap() : (raw as string);
    getLogger().info(display);
  },
});

const setCommand = defineCommand({
  meta: {
    name: 'set',
    description: 'Set a config value',
  },
  args: {
    database: databaseArg,
    keyFile: keyFileArg,
    key: {
      type: 'positional',
      description: 'Config key name',
      required: true,
    },
    value: {
      type: 'positional',
      description: 'New value (omit if using --from-file)',
      required: false,
    },
    fromFile: {
      type: 'string',
      description: 'Read value from file instead of positional argument',
    },
  },
  async run({ args }) {
    const { readFileSync } = await import('node:fs');
    let value: string;
    if (args.fromFile) {
      const { resolveFromRoot } = await import('../shared/context.ts');
      value = readFileSync(resolveFromRoot(args.fromFile), 'utf-8');
    } else if (args.value) {
      value = args.value;
    } else {
      getLogger().error('Provide a value or --from-file');
      process.exit(1);
    }
    const config = await createConfigService(args.database, args.keyFile);
    await config.set(args.key as ConfigKey, value);
    getLogger().info(
      `Set ${args.key} = ${CONFIG_SCHEMA[args.key as ConfigKey]?.encrypted ? '[ENCRYPTED]' : value}`,
    );
  },
});

export const configCommand = defineCommand({
  meta: {
    name: 'config',
    description: 'Manage application configuration',
  },
  subCommands: {
    list: listCommand,
    get: getCommand,
    set: setCommand,
  },
});
