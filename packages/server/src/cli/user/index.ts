import { defineCommand } from 'citty';
import { DuckDBConnection } from '@duckdb/node-api';
import { getLogger } from '../../lib/logger.ts';
import { databaseArg } from '../shared/args.ts';
import { createDb } from '../shared/context.ts';

export const userCommand = defineCommand({
  meta: {
    name: 'user',
    description: 'User account management',
  },
  subCommands: {
    create: defineCommand({
      meta: {
        name: 'create',
        description: 'Create a new user account',
      },
      args: {
        database: databaseArg,
        email: {
          type: 'string',
          description: 'User email address',
          required: true,
        },
        name: {
          type: 'string',
          description: 'User display name',
          required: true,
        },
        password: {
          type: 'string',
          description: 'User password',
          required: true,
        },
        admin: {
          type: 'boolean',
          description: 'Create as admin user',
          default: false,
        },
      },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureAuthTables } = await import('../../user/schema.ts');
          await ensureAuthTables(conn);

          const { SecretValue } = await import('../../lib/encryption.ts');
          const { UserService } = await import('../../user/user-service.ts');
          const service = new UserService(dbInstance);

          const role: string | undefined = args.admin ? 'admin' : undefined;
          const user = await service.createUser(
            args.email,
            args.name,
            new SecretValue(args.password),
            role,
          );

          const log = getLogger();
          log.info('User created:');
          log.info(`  ID:    ${user.id}`);
          log.info(`  Email: ${user.email}`);
          log.info(`  Name:  ${user.name}`);
          log.info(`  Role:  ${user.role}`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    disable: defineCommand({
      meta: {
        name: 'disable',
        description: 'Disable a user account',
      },
      args: {
        database: databaseArg,
        email: {
          type: 'string',
          description: 'User email address',
        },
        id: {
          type: 'string',
          description: 'User ID',
        },
        reason: {
          type: 'string',
          description: 'Reason for disabling',
        },
      },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureAuthTables } = await import('../../user/schema.ts');
          await ensureAuthTables(conn);

          const { UserService } = await import('../../user/user-service.ts');
          const service = new UserService(dbInstance);

          const userId: string | null = await resolveUserId(
            service,
            args.id,
            args.email,
          );
          if (userId == null) {
            getLogger().error('Error: user not found');
            process.exit(1);
          }

          await service.disableUser(userId, args.reason);
          getLogger().info(`User ${userId} disabled.`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    delete: defineCommand({
      meta: {
        name: 'delete',
        description: 'Delete a user account permanently',
      },
      args: {
        database: databaseArg,
        email: {
          type: 'string',
          description: 'User email address',
        },
        id: {
          type: 'string',
          description: 'User ID',
        },
        confirm: {
          type: 'boolean',
          description: 'Skip confirmation prompt',
          default: false,
        },
      },
      async run({ args }) {
        if (!args.confirm) {
          getLogger().error(
            'Error: pass --confirm to permanently delete the user',
          );
          process.exit(1);
        }

        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureAuthTables } = await import('../../user/schema.ts');
          await ensureAuthTables(conn);

          const { UserService } = await import('../../user/user-service.ts');
          const service = new UserService(dbInstance);

          const userId: string | null = await resolveUserId(
            service,
            args.id,
            args.email,
          );
          if (userId == null) {
            getLogger().error('Error: user not found');
            process.exit(1);
          }

          await service.deleteUser(userId);
          getLogger().info(`User ${userId} deleted.`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    'reset-password': defineCommand({
      meta: {
        name: 'reset-password',
        description: "Reset a user's password",
      },
      args: {
        database: databaseArg,
        email: {
          type: 'string',
          description: 'User email address',
        },
        id: {
          type: 'string',
          description: 'User ID',
        },
        password: {
          type: 'string',
          description: 'New password',
          required: true,
        },
      },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureAuthTables } = await import('../../user/schema.ts');
          await ensureAuthTables(conn);

          const { SecretValue } = await import('../../lib/encryption.ts');
          const { UserService } = await import('../../user/user-service.ts');
          const service = new UserService(dbInstance);

          const userId: string | null = await resolveUserId(
            service,
            args.id,
            args.email,
          );
          if (userId == null) {
            getLogger().error('Error: user not found');
            process.exit(1);
          }

          await service.resetPassword(userId, new SecretValue(args.password));
          getLogger().info(`Password reset for user ${userId}.`);
        } finally {
          conn.closeSync();
        }
      },
    }),

    'send-test-email': defineCommand({
      meta: {
        name: 'send-test-email',
        description: 'Send a test email to a user',
      },
      args: {
        database: databaseArg,
        keyFile: {
          type: 'string',
          description: 'Path to encryption key file',
          default: 'data/daily-orbit.key',
        },
        email: {
          type: 'string',
          description: 'User email address',
        },
        id: {
          type: 'string',
          description: 'User ID',
        },
      },
      async run({ args }) {
        const dbInstance = await createDb(args.database);
        const conn: DuckDBConnection =
          await DuckDBConnection.create(dbInstance);

        try {
          const { ensureAuthTables } = await import('../../user/schema.ts');
          await ensureAuthTables(conn);

          const { UserService } = await import('../../user/user-service.ts');
          const { ConfigService } = await import('../../lib/config-service.ts');
          const { readKeyFile } = await import('../../lib/encryption.ts');
          const { resolveFromRoot } = await import('../shared/context.ts');
          const { createEmailService } =
            await import('../../email/email-service.ts');
          const { renderTestEmail } = await import('../../email/test-email.ts');

          const service = new UserService(dbInstance);

          const userId: string | null = await resolveUserId(
            service,
            args.id,
            args.email,
          );
          if (userId == null) {
            getLogger().error('Error: user not found');
            process.exit(1);
          }

          const user = await service.getUser(userId);
          if (user == null) {
            getLogger().error('Error: user not found');
            process.exit(1);
          }

          const encryptionKey: Buffer = readKeyFile(
            resolveFromRoot(args.keyFile),
          );
          const config = new ConfigService(dbInstance, encryptionKey);
          await config.load();

          const emailConfig = {
            transport: config.get('emailTransport') as string as
              | 'ses'
              | 'smtp'
              | 'test',
            region: config.get('emailRegion') as string,
            senderAddress: config.get('emailSenderAddress') as string,
          };
          const emailService = createEmailService(emailConfig);
          const appBaseUrl: string = config.get('appBaseUrl') as string;

          const mail = renderTestEmail({
            recipientName: user.name,
            recipientEmail: user.email,
            appBaseUrl,
          });

          const log = getLogger();
          log.info(
            `Sending test email to ${user.email} via ${emailConfig.transport}...`,
          );
          await emailService.sendMail(mail);
          log.info('Test email sent successfully.');
        } finally {
          conn.closeSync();
        }
      },
    }),
  },
});

async function resolveUserId(
  service: InstanceType<
    typeof import('../../user/user-service.ts').UserService
  >,
  id: string | undefined,
  email: string | undefined,
): Promise<string | null> {
  if (id != null) return id;
  if (email != null) {
    const user = await service.getUserByEmail(email);
    return user?.id ?? null;
  }
  getLogger().error('Error: provide --email or --id');
  process.exit(1);
}
