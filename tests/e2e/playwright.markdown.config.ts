/**
 * markdown 管线专用 Playwright 配置（@since v3.9，task_145）。
 *
 * 口径与 playwright.type-scale.config.ts 一致：**不挂 globalSetup / 不管 webServer**，
 * 只复用已经在跑的 7523（vite HMR）—— 网关（7524）必须保持运行（勿动网关）。
 *
 * 用法：npx playwright test --config=tests/e2e/playwright.markdown.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/markdown-pipeline.spec.ts'],
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
