type ConfigFieldDef = {
  readonly key: string;
  readonly defaultValue: string;
  readonly encrypted: boolean;
  readonly description: string;
};

export const CONFIG_SCHEMA: Record<string, ConfigFieldDef> = {
  betterAuthSecret: {
    key: 'betterAuthSecret',
    defaultValue: '',
    encrypted: true,
    description: 'Auth secret (auto-generated on first start)',
  },
  betterAuthUrl: {
    key: 'betterAuthUrl',
    defaultValue: 'http://localhost:9000',
    encrypted: false,
    description: 'Auth service base URL',
  },
  clientDomain: {
    key: 'clientDomain',
    defaultValue: 'http://localhost:5173',
    encrypted: false,
    description: 'Frontend domain for CORS',
  },
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;

export const CONFIG_KEYS: ConfigKey[] = Object.keys(CONFIG_SCHEMA);
