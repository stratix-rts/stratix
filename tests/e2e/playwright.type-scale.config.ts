/**
 * 排版 / 字阶专用 Playwright 配置（@since v3.8，task_137）。
 *
 * why 单独一张配置（而不是并进 playwright.hud.config.ts）：
 *   那张配置是 task_121 / task_135 的在途文件（图标验收），本任务不去碰它，
 *   避免并行任务互相改配置。口径完全一致：**不挂 globalSetup / 不管 webServer**，
 *   只复用已经在跑的 7523（vite HMR）—— 网关（7524）必须保持运行。
 *
 * 用法：
 *   npx playwright test --config=tests/e2e/playwright.type-scale.config.ts
 *   PHASE=before npx playwright test --config=tests/e2e/playwright.type-scale.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/type-scale.spec.ts'],
  // 单文件、单 worker —— e2e 起浏览器是 CPU 大户，别并发。
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
