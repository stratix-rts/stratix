import { defineConfig, devices } from '@playwright/test';
import os from 'os';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',  // Only run Playwright tests (not Jest)
  globalSetup: require('./tests/e2e/global-setup'),
  globalTeardown: require('./tests/e2e/global-teardown'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : Math.max(Math.ceil(os.cpus().length / 4), 2),
  reporter: 'html',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:7523',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: './tests/e2e/scripts/start-backend.sh',
      url: 'http://localhost:7524/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: './tests/e2e/scripts/start-frontend.sh',
      url: 'http://localhost:7523',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
