import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/handshake_test';

export default defineConfig({
  resolve: { tsconfigPaths: true, alias: { 'server-only': './tests/stubs/empty.ts' } },
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'int',
          include: ['tests/int/**/*.int.test.ts'],
          globalSetup: ['tests/int/global-setup.ts'],
          env: { DATABASE_URL: TEST_DB },
          testTimeout: 20_000,
        },
      },
    ],
  },
});
