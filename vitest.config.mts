import { defineConfig } from 'vitest/config';

// A fixed field-encryption key for every test run; production uses DATA_KEYS from the environment.
const DATA_KEYS = process.env.DATA_KEYS ?? 'k1:test-only-data-key-at-least-32-characters-long';
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/handshake_test';

export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { 'server-only': './tests/stubs/empty.ts' } },
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], env: { DATA_KEYS } } },
      {
        test: {
          name: 'int',
          include: ['tests/int/**/*.int.test.ts'],
          globalSetup: ['tests/int/global-setup.ts'],
          env: { DATABASE_URL: TEST_DB, DATA_KEYS },
          testTimeout: 20_000,
        },
      },
    ],
  },
});
