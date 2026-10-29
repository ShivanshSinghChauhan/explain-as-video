import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/prepare.mjs',
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  webServer: {
    command: 'node tests/e2e/server.mjs',
    port: 4610,
    reuseExistingServer: true,
  },
});
