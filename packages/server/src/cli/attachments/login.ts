import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineCommand } from 'citty';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb, resolveFromRoot } from '../shared/context.ts';
import { headlessLogin } from '../../icfs/headless-login.ts';
import { ConfigService } from '../../lib/config-service.ts';
import { SecretValue, readKeyFile } from '../../lib/encryption.ts';

export const loginCommand = defineCommand({
  meta: {
    name: 'login',
    description: 'Headless ICFS login — extract session cookies automatically',
  },
  args: {
    database: databaseArg,
    username: {
      type: 'string',
      description:
        'ICFS/Okta username (email). Falls back to stored config value.',
    },
    password: {
      type: 'string',
      description: 'ICFS/Okta password. Falls back to stored config value.',
    },
    output: {
      type: 'string',
      description: 'Output path for cookies JSON file',
      default: 'data/icfs-cookies.json',
    },
    headed: {
      type: 'boolean',
      description: 'Run browser in headed (visible) mode',
      default: false,
    },
    'save-credentials': {
      type: 'boolean',
      description: 'Store username/password in encrypted config for future use',
      default: false,
    },
    'key-file': {
      type: 'string',
      description: 'Path to encryption key file',
      default: 'data/daily-orbit.key',
    },
  },
  async run({ args }) {
    const log = getLogger();
    let username: string = args.username ?? '';
    let password: string = args.password ?? '';

    // Fall back to stored config if not provided on CLI
    if (!username || !password) {
      const db = await createDb(args.database);
      const key: Buffer = readKeyFile(resolveFromRoot(args['key-file']));
      const config: ConfigService = new ConfigService(db, key);
      await config.load();
      if (!username) {
        const val: string | SecretValue = config.get('icfsUsername');
        username = val instanceof SecretValue ? val.unwrap() : val;
      }
      if (!password) {
        const val: string | SecretValue = config.get('icfsPassword');
        password = val instanceof SecretValue ? val.unwrap() : val;
      }
    }

    if (!username || !password) {
      log.error(
        'ICFS credentials required. Provide --username and --password, or store via:',
      );
      log.error('  ./daily-orbit config set icfsUsername <email>');
      log.error('  ./daily-orbit config set icfsPassword <password>');
      process.exit(1);
    }

    // Optionally persist credentials
    if (args['save-credentials']) {
      const db = await createDb(args.database);
      const key: Buffer = readKeyFile(resolveFromRoot(args['key-file']));
      const config: ConfigService = new ConfigService(db, key);
      await config.load();
      await config.set('icfsUsername', username);
      await config.set('icfsPassword', password);
      log.info('Credentials saved to encrypted config.');
    }

    const result = await headlessLogin({
      username,
      password,
      headless: !args.headed,
      onStatus: (msg: string) => log.info(`  ${msg}`),
    });

    if (!result.ok) {
      log.error(`Login failed: ${result.message}`);
      if (result.reason === 'tfa_required') {
        log.error('Falling back to manual extraction...');
      }
      process.exit(1);
    }

    const outputPath: string = resolveFromRoot(args.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(result.output, null, 2) + '\n');

    log.info(`\nExtracted ${String(result.output.cookieCount)} cookies`);
    log.info(`Written to ${outputPath}`);
    log.info(`Estimated expiry: ${result.output.expiresAt}`);
  },
});
