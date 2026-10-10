import { defineConfig } from '@playwright/test';
const base = process.env.PLAYWRIGHT_BASE_URL;
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 240_000,
  retries: 1,
  workers: 1,
  use: { baseURL: base ?? 'http://localhost:3000', trace: 'retain-on-failure', video: 'retain-on-failure' },
  webServer: base ? undefined : {
    command: 'npm run build && npm run start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
