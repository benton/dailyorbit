import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface SeedConfig {
  stackName: string;
  domainName: string;
  apiDomainName: string;
  certificateArn: string;
  apiCertificateArn: string;
  cloudfrontCertificateArn: string;
  vpcId: string | null;
  instanceType: string;
  keyPairName: string | null;
  dbSnapshotBucket: string;
  dbSnapshotKey: string;
  ecrRepositoryName: string;
  containerTag: string;
  snapshotIntervalMinutes: number;
  healthCheckPath: string;
  tags: Record<string, string>;
}

const DEFAULTS: Partial<SeedConfig> = {
  vpcId: null,
  instanceType: 'r6gd.xlarge',
  keyPairName: null,
  dbSnapshotKey: 'db/latest.duckdb',
  ecrRepositoryName: 'daily-orbit',
  containerTag: 'latest',
  snapshotIntervalMinutes: 60,
  healthCheckPath: '/api/health',
  tags: {
    Project: 'daily-orbit',
  },
};

const REQUIRED_FIELDS: (keyof SeedConfig)[] = [
  'stackName',
  'domainName',
  'certificateArn',
  'dbSnapshotBucket',
];

export function loadSeedConfig(): SeedConfig {
  const configPath: string = resolveConfigPath();
  const raw: string = readFileSync(configPath, 'utf-8');
  const parsed: Partial<SeedConfig> = JSON.parse(raw) as Partial<SeedConfig>;

  const config: SeedConfig = { ...DEFAULTS, ...parsed } as SeedConfig;

  const missing: string[] = REQUIRED_FIELDS.filter(
    (field) => config[field] === undefined || config[field] === null || config[field] === '',
  );

  if (missing.length > 0) {
    throw new Error(
      `Seed config at ${configPath} is missing required fields: ${missing.join(', ')}`,
    );
  }

  return config;
}

function resolveConfigPath(): string {
  const explicit: string | undefined = process.env.DEPLOY_CONFIG;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new Error(`DEPLOY_CONFIG points to non-existent file: ${explicit}`);
    }
    return explicit;
  }

  const account: string | undefined = process.env.CDK_DEFAULT_ACCOUNT;
  const region: string | undefined = process.env.CDK_DEFAULT_REGION;

  if (!account || !region) {
    throw new Error(
      'Set DEPLOY_CONFIG or both CDK_DEFAULT_ACCOUNT and CDK_DEFAULT_REGION to auto-resolve seed config',
    );
  }

  const __dirname: string = dirname(fileURLToPath(import.meta.url));
  const autoPath: string = resolve(__dirname, '..', 'config', `aws-${account}-${region}-seed.json`);

  if (!existsSync(autoPath)) {
    throw new Error(
      `No seed config found at ${autoPath}. Create it or set DEPLOY_CONFIG explicitly.`,
    );
  }

  return autoPath;
}
