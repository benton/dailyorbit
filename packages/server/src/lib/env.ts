import defineEnv from '@nkzw/define-env';

const env = defineEnv([
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'CLIENT_DOMAIN',
  'DATABASE_URL',
]);

export const BETTER_AUTH_SECRET = env('BETTER_AUTH_SECRET');
export const BETTER_AUTH_URL = env('BETTER_AUTH_URL');
export const CLIENT_DOMAIN = env('CLIENT_DOMAIN');
export const DATABASE_URL = env('DATABASE_URL');
