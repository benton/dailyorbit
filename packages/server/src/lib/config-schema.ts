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
  newsSummarizationModel: {
    key: 'newsSummarizationModel',
    defaultValue: 'us.amazon.nova-pro-v1:0',
    encrypted: false,
    description: 'Bedrock model ID used for news article summarization',
  },
  newsSummarizationSystemPrompt: {
    key: 'newsSummarizationSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for news summarization (blank = built-in default)',
  },
  newsSummarizationUserPrompt: {
    key: 'newsSummarizationUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt template for news summarization (blank = built-in default)',
  },
  embeddingModel: {
    key: 'embeddingModel',
    defaultValue: 'amazon.titan-embed-text-v2:0',
    encrypted: false,
    description: 'Bedrock model ID for text embeddings',
  },
  embeddingDimensions: {
    key: 'embeddingDimensions',
    defaultValue: '512',
    encrypted: false,
    description: 'Embedding vector dimensions (Titan V2 supports 256/512/1024)',
  },
  embeddingNormalize: {
    key: 'embeddingNormalize',
    defaultValue: 'true',
    encrypted: false,
    description: 'Whether to L2-normalize embeddings (for cosine similarity)',
  },
  queryRewriteModel: {
    key: 'queryRewriteModel',
    defaultValue: 'us.amazon.nova-micro-v1:0',
    encrypted: false,
    description: 'Bedrock model ID for RAG query rewriting',
  },
  queryGenerateModel: {
    key: 'queryGenerateModel',
    defaultValue: 'us.amazon.nova-pro-v1:0',
    encrypted: false,
    description: 'Bedrock model ID for RAG answer generation',
  },
  queryMaxQuestionLength: {
    key: 'queryMaxQuestionLength',
    defaultValue: '1024',
    encrypted: false,
    description: 'Maximum character length for RAG questions',
  },
  queryRewriteSystemPrompt: {
    key: 'queryRewriteSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for RAG query rewriting (blank = built-in default)',
  },
  queryGenerateSystemPrompt: {
    key: 'queryGenerateSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for RAG answer generation (blank = built-in default)',
  },
  queryGenerateUserPrompt: {
    key: 'queryGenerateUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt template for RAG answer generation (blank = built-in default)',
  },
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;

export const CONFIG_KEYS: ConfigKey[] = Object.keys(CONFIG_SCHEMA);
