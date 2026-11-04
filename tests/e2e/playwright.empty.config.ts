/**
 * 空态验收专用 Playwright 配置（@since v3.8，task_136）。
 *
 * why 单独一份配置：仓库默认配置会 `ProcessManager.fullCleanup()` ——
 *   它按 7523 / 7524 把 dev vite 与**网关**一起杀掉再起。
 *   本任务期间网关（7524）必须保持运行（任务书：勿动网关），故这里不挂 globalSetup /
 *   globalTeardown、也不管 webServer，只复用已经在跑的 7523（vite HMR）。
 *
 * 用法：npx playwright test --config=tests/e2e/playwright.empty.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/empty-state.spec.ts'],
  // 单文件、单 worker —— e2e 起浏览器是 CPU 大户，别并发（见 PERFORMANCE_GUIDELINES）。
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 90_000,
  use: {
    baseURL: 'http://localhost:7523',
    ...devices['Desktop Chrome'],
  },
});
