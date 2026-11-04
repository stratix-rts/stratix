/**
 * 新建任务对话框专用 Playwright 配置（@since v3.10，task_154：底部双框合一后对话框的入口改了）。
 *
 * why 不挂 globalSetup：默认配置会杀掉并重起 7523 / 7524 —— 本任务期间网关（7524）必须保持运行。
 *
 * 用法：npx playwright test --config=tests/e2e/playwright.new-task-dialog.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/new-task-dialog.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:7523',
    ...devices['Desktop Chrome'],
  },
});
