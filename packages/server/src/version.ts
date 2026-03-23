import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const APP_VERSION: string = JSON.parse(
  readFileSync(resolve(import.meta.dirname ?? '.', '../package.json'), 'utf-8'),
).version;
