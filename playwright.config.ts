import { defineConfig, devices } from '@playwright/test';
import os from 'os';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',  // Only run Playwright tests (not Jest)
  globalSetup: require('./tests/e2e/global-setup'),
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
      command: 'npm run dev:backend',
      url: 'http://localhost:7524/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'npm run dev:frontend',
      url: 'http://localhost:7523',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
