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
    defaultValue: 'http://localhost:9900',
    encrypted: false,
    description: 'Auth service base URL',
  },
  clientDomain: {
    key: 'clientDomain',
    defaultValue: 'http://localhost:5973',
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
  emailTransport: {
    key: 'emailTransport',
    defaultValue: 'ses',
    encrypted: false,
    description: 'Email transport: ses, smtp, or test',
  },
  emailSenderAddress: {
    key: 'emailSenderAddress',
    defaultValue: 'admin@dailyorbit.org',
    encrypted: false,
    description: 'Default sender (From) address for outgoing email',
  },
  emailRegion: {
    key: 'emailRegion',
    defaultValue: 'us-east-2',
    encrypted: false,
    description: 'AWS region for SES email transport',
  },
  appBaseUrl: {
    key: 'appBaseUrl',
    defaultValue: 'http://localhost:5973',
    encrypted: false,
    description: 'Application base URL for links in emails',
  },
  houseAdDestinationUrl: {
    key: 'houseAdDestinationUrl',
    defaultValue: 'https://dailyorbit.org/',
    encrypted: false,
    description:
      'Base URL used as the click-target for exported house ads (UTM params are appended automatically).',
  },
  snapshotBucket: {
    key: 'snapshotBucket',
    defaultValue: '',
    encrypted: false,
    description: 'S3 bucket for database snapshots (e.g., daily-orbit-data)',
  },
  snapshotPrefix: {
    key: 'snapshotPrefix',
    defaultValue: 'db/',
    encrypted: false,
    description: 'S3 key prefix for snapshot files',
  },
  snapshotRegion: {
    key: 'snapshotRegion',
    defaultValue: 'us-east-2',
    encrypted: false,
    description: 'AWS region for the snapshot S3 bucket',
  },
  snapshotIntervalMinutes: {
    key: 'snapshotIntervalMinutes',
    defaultValue: '120',
    encrypted: false,
    description: 'Automatic snapshot interval in minutes (0 = disabled)',
  },
  tlsCert: {
    key: 'tlsCert',
    defaultValue: '',
    encrypted: true,
    description: 'TLS certificate chain (PEM) for HTTPS termination',
  },
  tlsKey: {
    key: 'tlsKey',
    defaultValue: '',
    encrypted: true,
    description: 'TLS private key (PEM) for HTTPS termination',
  },
  icfsUsername: {
    key: 'icfsUsername',
    defaultValue: '',
    encrypted: true,
    description: 'ICFS/Okta username (email) for headless login',
  },
  icfsPassword: {
    key: 'icfsPassword',
    defaultValue: '',
    encrypted: true,
    description: 'ICFS/Okta password for headless login',
  },
  icfsCookies: {
    key: 'icfsCookies',
    defaultValue: '',
    encrypted: true,
    description: 'Persisted ICFS session cookies (auto-refreshed by pipeline)',
  },
  newspaperCopyModel: {
    key: 'newspaperCopyModel',
    defaultValue: 'us.amazon.nova-pro-v1:0',
    encrypted: false,
    description: 'Bedrock model ID for newspaper article generation',
  },
  newspaperCopySystemPrompt: {
    key: 'newspaperCopySystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for newspaper article generation (blank = built-in default)',
  },
  newspaperCopyUserPrompt: {
    key: 'newspaperCopyUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt template for newspaper article generation (blank = built-in default)',
  },
  newspaperImageModel: {
    key: 'newspaperImageModel',
    defaultValue: 'amazon.nova-canvas-v1:0',
    encrypted: false,
    description:
      'Bedrock model ID for newspaper image generation (Nova Canvas)',
  },
  newspaperEditorialSystemPrompt: {
    key: 'newspaperEditorialSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for editorial generation (blank = shared newspaper prompt)',
  },
  newspaperEditorialUserPrompt: {
    key: 'newspaperEditorialUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for editorial generation (blank = built-in default)',
  },
  newspaperForecastSystemPrompt: {
    key: 'newspaperForecastSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Orbital Forecast column (blank = built-in default)',
  },
  newspaperForecastUserPrompt: {
    key: 'newspaperForecastUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Orbital Forecast column (blank = built-in default)',
  },
  newspaperSpotlightSystemPrompt: {
    key: 'newspaperSpotlightSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Company Spotlight column (blank = built-in default)',
  },
  newspaperSpotlightUserPrompt: {
    key: 'newspaperSpotlightUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Company Spotlight column (blank = built-in default)',
  },
  newspaperClassifiedsSystemPrompt: {
    key: 'newspaperClassifiedsSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description: 'System prompt for Classifieds (blank = built-in default)',
  },
  newspaperClassifiedsUserPrompt: {
    key: 'newspaperClassifiedsUserPrompt',
    defaultValue: '',
    encrypted: false,
    description: 'User prompt for Classifieds (blank = built-in default)',
  },
  newspaperAdSystemPrompt: {
    key: 'newspaperAdSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description: 'System prompt for Fake Ad (blank = built-in default)',
  },
  newspaperAdUserPrompt: {
    key: 'newspaperAdUserPrompt',
    defaultValue: '',
    encrypted: false,
    description: 'User prompt for Fake Ad (blank = built-in default)',
  },
  newspaperDocketSystemPrompt: {
    key: 'newspaperDocketSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for The Docket column (blank = built-in default)',
  },
  newspaperDocketUserPrompt: {
    key: 'newspaperDocketUserPrompt',
    defaultValue: '',
    encrypted: false,
    description: 'User prompt for The Docket column (blank = built-in default)',
  },
  newspaperSpectrumWatchSystemPrompt: {
    key: 'newspaperSpectrumWatchSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Spectrum Watch column (blank = built-in default)',
  },
  newspaperSpectrumWatchUserPrompt: {
    key: 'newspaperSpectrumWatchUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Spectrum Watch column (blank = built-in default)',
  },
  newspaperCompetitiveIntelSystemPrompt: {
    key: 'newspaperCompetitiveIntelSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Competitive Intelligence column (blank = built-in default)',
  },
  newspaperCompetitiveIntelUserPrompt: {
    key: 'newspaperCompetitiveIntelUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Competitive Intelligence column (blank = built-in default)',
  },
  newspaperFilingInFocusSystemPrompt: {
    key: 'newspaperFilingInFocusSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Filing in Focus column (blank = built-in default)',
  },
  newspaperFilingInFocusUserPrompt: {
    key: 'newspaperFilingInFocusUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Filing in Focus column (blank = built-in default)',
  },
  newspaperApplicantSystemPrompt: {
    key: 'newspaperApplicantSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for The Applicant column (blank = built-in default)',
  },
  newspaperApplicantUserPrompt: {
    key: 'newspaperApplicantUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for The Applicant column (blank = built-in default)',
  },
  newspaperTechSpotlightSystemPrompt: {
    key: 'newspaperTechSpotlightSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Technology Spotlight column (blank = built-in default)',
  },
  newspaperTechSpotlightUserPrompt: {
    key: 'newspaperTechSpotlightUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Technology Spotlight column (blank = built-in default)',
  },
  newspaperArchivesSystemPrompt: {
    key: 'newspaperArchivesSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for From the Archives column (blank = built-in default)',
  },
  newspaperArchivesUserPrompt: {
    key: 'newspaperArchivesUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for From the Archives column (blank = built-in default)',
  },
  newspaperCounselsBriefSystemPrompt: {
    key: 'newspaperCounselsBriefSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      "System prompt for Counsel's Brief column (blank = built-in default)",
  },
  newspaperCounselsBriefUserPrompt: {
    key: 'newspaperCounselsBriefUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      "User prompt for Counsel's Brief column (blank = built-in default)",
  },
  newspaperLettersSystemPrompt: {
    key: 'newspaperLettersSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Letters to the Editor column (blank = built-in default)',
  },
  newspaperLettersUserPrompt: {
    key: 'newspaperLettersUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Letters to the Editor column (blank = built-in default)',
  },
  newspaperMarketSignalsSystemPrompt: {
    key: 'newspaperMarketSignalsSystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Market Signals column (blank = built-in default)',
  },
  newspaperMarketSignalsUserPrompt: {
    key: 'newspaperMarketSignalsUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Market Signals column (blank = built-in default)',
  },
  newspaperPressGallerySystemPrompt: {
    key: 'newspaperPressGallerySystemPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'System prompt for Press Gallery column (blank = built-in default)',
  },
  newspaperPressGalleryUserPrompt: {
    key: 'newspaperPressGalleryUserPrompt',
    defaultValue: '',
    encrypted: false,
    description:
      'User prompt for Press Gallery column (blank = built-in default)',
  },
  newspaperImagesBucket: {
    key: 'newspaperImagesBucket',
    defaultValue: '',
    encrypted: false,
    description:
      'S3 bucket for newspaper image CDN (empty = local-only, no upload)',
  },
  storageBackend: {
    key: 'storageBackend',
    defaultValue: 'fs',
    encrypted: false,
    description: "Attachment storage backend: 'fs' (local) or 's3'",
  },
  storageBucket: {
    key: 'storageBucket',
    defaultValue: '',
    encrypted: false,
    description: 'S3 bucket name for attachment storage',
  },
  storagePrefix: {
    key: 'storagePrefix',
    defaultValue: 'attachments/',
    encrypted: false,
    description: 'S3 key prefix for attachment storage',
  },
  storageRegion: {
    key: 'storageRegion',
    defaultValue: 'us-east-2',
    encrypted: false,
    description: 'AWS region for attachment S3 storage',
  },
  storageFsRoot: {
    key: 'storageFsRoot',
    defaultValue: 'data/attachments',
    encrypted: false,
    description: "Local root directory for 'fs' storage backend",
  },
  schedulerAutoStart: {
    key: 'schedulerAutoStart',
    defaultValue: 'false',
    encrypted: false,
    description:
      'Start the pipeline scheduler automatically when the API server starts',
  },
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMA;

export const CONFIG_KEYS: ConfigKey[] = Object.keys(CONFIG_SCHEMA);
