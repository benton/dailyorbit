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
  bedrockRegion: {
    key: 'bedrockRegion',
    defaultValue: 'us-east-2',
    encrypted: false,
    description: 'AWS region for Bedrock inference',
  },
  bedrockDefaultModel: {
    key: 'bedrockDefaultModel',
    defaultValue: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    encrypted: false,
    description: 'Default Bedrock model ID for inference',
  },
  summarizationModel: {
    key: 'summarizationModel',
    defaultValue: 'us.amazon.nova-pro-v1:0',
    encrypted: false,
    description: 'Bedrock model ID used for attachment summarization',
  },
  summarizationSystemPrompt: {
    key: 'summarizationSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for attachment summarization (blank = built-in default)',
  },
  summarizationUserPrompt: {
    key: 'summarizationUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt template for attachment summarization (blank = built-in default)',
  },
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;

export const CONFIG_KEYS: ConfigKey[] = Object.keys(CONFIG_SCHEMA);
