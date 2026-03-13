import { defineConfig } from 'oxlint';

export default defineConfig({
  ignorePatterns: ['dist/'],
  rules: {
    'no-unused-vars': 'error',
    'no-console': 'off',
  },
});
